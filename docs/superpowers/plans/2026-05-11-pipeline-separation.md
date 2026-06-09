# Pipeline Separation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove all PDF/paper2kindle references from web2kindle by extracting shared EPUB utilities into `w2k_epub.py` and deleting `paper2kindle_reflow.py`.

**Architecture:** A new `w2k_epub.py` module owns 8 EPUB-building functions (cover generation, details page, image rotation). Server.py imports from `w2k_epub` instead of `paper2kindle_reflow`. PDF pipeline (`paper2kindle_reflow.py`) is removed from the workspace — it belongs in its own project.

**Tech Stack:** Python 3, Pillow, ebooklib

---

### Task 1: Create `w2k_epub.py`

**Files:**
- Create: `w2k_epub.py`

- [ ] **Step 1: Write the new file**

```python
"""EPUB-building utilities for the web2kindle article pipeline.

Owned by web2kindle — not shared with any other project.
Contains EPUB formatting helpers extracted from the now-removed
paper2kindle_reflow.py (PDF pipeline).
"""
import io
import re


def _escape(text: str) -> str:
    return (text
            .replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
            .replace('"', "&quot;"))


def _get_image_size(image_bytes: bytes) -> tuple[int, int] | None:
    from PIL import Image
    try:
        img = Image.open(io.BytesIO(image_bytes))
        return img.size
    except Exception:
        return None


def _should_rotate_image(image_bytes: bytes) -> bool:
    size = _get_image_size(image_bytes)
    if not size:
        return False
    width, height = size
    if width <= 400 or height <= 0:
        return False
    if min(width, height) < 120:
        return False
    return (width / height) > 1.3


def _rotate_image_bytes(img_bytes: bytes, angle: int = 90) -> bytes:
    from PIL import Image
    img = Image.open(io.BytesIO(img_bytes))
    rotated = img.rotate(angle, expand=True)
    buf = io.BytesIO()
    rotated.save(buf, format="PNG")
    return buf.getvalue()


def _create_rotated_image_page(img_src: str, title: str = "", orig_fname: str = "") -> str:
    orig_attr = f' data-orig="images/{orig_fname}"' if orig_fname else ""
    return f"""<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>{title}</title><style>
body {{ margin: 0; padding: 0; text-align: center; }}
.imgwrap {{ display: flex; align-items: center; justify-content: center; height: 100%; }}
img {{ max-width: 100%; max-height: 100%; }}
</style></head>
<body><div class="imgwrap"><img src="images/{img_src}" alt="{title}"{orig_attr}/></div></body>
</html>"""


def _add_standalone_image_pages(book, specs: list[dict], css) -> dict[int, list]:
    from ebooklib import epub
    pages_by_num: dict[int, list] = {}
    for idx, spec in enumerate(specs, start=1):
        rotated_name = f"images/rotated_{idx:03d}.png"
        original_ext = (spec["source_ext"] or "png").lower()
        if original_ext == "jpeg":
            original_ext = "jpg"
        original_name = f"images/rotated_orig_{idx:03d}.{original_ext}"
        original_media_type = "image/png" if original_ext == "png" else f"image/{original_ext}"

        book.add_item(epub.EpubItem(
            uid=f"rotated_{idx}",
            file_name=rotated_name,
            media_type="image/png",
            content=_rotate_image_bytes(spec["source_bytes"]),
        ))
        book.add_item(epub.EpubItem(
            uid=f"rotated_orig_{idx}",
            file_name=original_name,
            media_type=original_media_type,
            content=spec["source_bytes"],
        ))

        page = epub.EpubHtml(title="", file_name=f"rotimg_{idx:03d}.xhtml", lang="en")
        page.content = _create_rotated_image_page(
            rotated_name.split("/", 1)[1],
            title=spec["title"],
            orig_fname=original_name.split("/", 1)[1],
        ).encode("utf-8")
        page.add_item(css)
        book.add_item(page)
        pages_by_num.setdefault(spec["page_num"], []).append(page)

    return pages_by_num


def generate_cover_image(title: str, authors: str,
                          source_image: bytes | None = None) -> bytes:
    from PIL import Image, ImageDraw, ImageFont

    WIDTH, HEIGHT = 600, 800
    ACCENT = (220, 80, 60)
    BG = (248, 246, 242)
    IMG_ZONE_H = 440

    img = Image.new("RGB", (WIDTH, HEIGHT), BG)
    draw = ImageDraw.Draw(img)

    if source_image:
        try:
            from io import BytesIO as _BytesIO
            src = Image.open(_BytesIO(source_image)).convert("RGB")
            scale = WIDTH / src.width
            new_h = int(src.height * scale)
            src = src.resize((WIDTH, max(new_h, IMG_ZONE_H)), Image.LANCZOS)
            top = max(0, (src.height - IMG_ZONE_H) // 2)
            src = src.crop((0, top, WIDTH, top + IMG_ZONE_H))
            img.paste(src, (0, 0))

            overlay = Image.new("RGBA", (WIDTH, IMG_ZONE_H), (0, 0, 0, 0))
            odraw = ImageDraw.Draw(overlay)
            for y in range(IMG_ZONE_H - 80, IMG_ZONE_H):
                alpha = int(255 * (y - (IMG_ZONE_H - 80)) / 80)
                odraw.line([(0, y), (WIDTH - 1, y)], fill=(20, 20, 26, alpha))
            img_rgba = img.convert("RGBA")
            img_rgba.alpha_composite(overlay)
            img = img_rgba.convert("RGB")

            TEXT_BG = (22, 22, 30)
            draw = ImageDraw.Draw(img)
            draw.rectangle([(0, IMG_ZONE_H), (WIDTH, HEIGHT)], fill=TEXT_BG)
        except Exception:
            source_image = None
            img = Image.new("RGB", (WIDTH, HEIGHT), BG)
            draw = ImageDraw.Draw(img)

    def _load_font(size):
        for path in (
            "/System/Library/Fonts/Helvetica.ttc",
            "/System/Library/Fonts/SFNSText.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
            "C:\\Windows\\Fonts\\arial.ttf",
        ):
            try:
                return ImageFont.truetype(path, size)
            except (OSError, IOError):
                continue
        return ImageFont.load_default(size=size)

    font_author = _load_font(52)
    margin_l, margin_r = 35, 40
    max_width = WIDTH - margin_l - margin_r - 8

    def _wrap(text, font):
        words = text.split()
        lines, line = [], ""
        for word in words:
            test = f"{line} {word}".strip()
            if draw.textbbox((0, 0), test, font=font)[2] <= max_width:
                line = test
            else:
                if line:
                    lines.append(line)
                line = word
        if line:
            lines.append(line)
        return lines

    if source_image:
        title_fill = (255, 255, 255)
        authors_fill = (200, 195, 190)
        y_start = IMG_ZONE_H + 30
        text_zone_h = HEIGHT - IMG_ZONE_H - 30
    else:
        title_fill = (22, 22, 26)
        authors_fill = (100, 95, 90)
        y_start = 80
        text_zone_h = int(HEIGHT * 0.68)

    font_title = _load_font(72)
    for size in (72, 60, 50, 42, 36, 30):
        font_title = _load_font(size)
        wrapped = _wrap(title, font_title)
        line_h = draw.textbbox((0, 0), "Ag", font=font_title)[3] + 14
        if line_h * len(wrapped) <= text_zone_h:
            break

    y_pos = y_start
    for line in _wrap(title, font_title):
        draw.text((margin_l, y_pos), line, fill=title_fill, font=font_title)
        y_pos += draw.textbbox((0, 0), line, font=font_title)[3] + 14

    y_pos += 22
    draw.rectangle([(margin_l, y_pos), (margin_l + 80, y_pos + 4)], fill=ACCENT)
    y_pos += 28

    if authors:
        for line in _wrap(authors, font_author):
            draw.text((margin_l, y_pos), line, fill=authors_fill, font=font_author)
            y_pos += draw.textbbox((0, 0), line, font=font_author)[3] + 10

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def generate_details_page_html(
    title: str,
    authors: str,
    pub_date: str,
    place: str,
    url: str,
    sent_date: str,
    scientific_metadata: dict | None = None,
    keep_links: bool = True,
    read_time: int | None = None,
) -> str:
    from datetime import date as _date
    if not sent_date:
        sent_date = _date.today().isoformat()
    scientific_metadata = scientific_metadata or {}

    def row(label, value):
        if not value or value.strip() in ("", "Unknown", "Untitled"):
            return ""
        return (f'<tr><td class="label">{_escape(label)}</td>'
                f'<td class="value">{_escape(value)}</td></tr>')

    resolved_pub_date = (scientific_metadata.get("published") or pub_date or "").strip()
    resolved_place = (scientific_metadata.get("citation") or scientific_metadata.get("journal") or place or "").strip()
    doi = (scientific_metadata.get("doi") or "").strip()
    source_url = (
        scientific_metadata.get("pubmed_url")
        or scientific_metadata.get("source_url")
        or url
        or (f"https://doi.org/{doi}" if doi else "")
    )

    url_row = ""
    if source_url:
        url_cell = (f'<a href="{_escape(source_url)}">{_escape(source_url)}</a>'
                    if keep_links else _escape(source_url))
        url_row = (f'<tr><td class="label">Source</td>'
                   f'<td class="value">{url_cell}</td></tr>')

    doi_row = ""
    if doi:
        doi_value = f"https://doi.org/{doi}"
        doi_cell = (f'<a href="{_escape(doi_value)}">{_escape(doi)}</a>'
                    if keep_links else _escape(doi))
        doi_row = (f'<tr><td class="label">DOI</td>'
                   f'<td class="value">{doi_cell}</td></tr>')

    read_time_row = row("Reading time", f"{read_time} min") if (read_time and read_time > 0) else ""

    rows = "".join(filter(None, [
        row("Title", title),
        row("Author", authors),
        row("Published", resolved_pub_date),
        row("In", resolved_place),
        read_time_row,
        doi_row,
        url_row,
        row("Sent to Kindle", sent_date),
    ]))

    return (
        '<?xml version="1.0" encoding="utf-8"?>\n'
        '<html xmlns="http://www.w3.org/1999/xhtml">\n'
        '<head><title>Details</title></head>\n'
        '<body>\n'
        '<div class="details-page">\n'
        '  <table class="details-table"><tbody>\n'
        f'    {rows}\n'
        '  </tbody></table>\n'
        '</div>\n'
        '</body>\n'
        '</html>'
    )
```

- [ ] **Step 2: Verify the file parses**

Run: `python3 -c "import ast; ast.parse(open('w2k_epub.py').read()); print('OK')"`
Expected: `OK`


### Task 2: Update `server.py` import

**Files:**
- Modify: `server.py` (lines 32-42 import, and any remaining paper2kindle_reflow references)

- [ ] **Step 1: Replace the import block**

Current code (server.py lines 32-42):
```python
from paper2kindle_reflow import (
    _cover_author_text,
    _format_inline_body_html,
    _normalize_spaced_heading,
    _split_body_paragraphs,
    _add_standalone_image_pages,
    _rotate_image_bytes,
    _should_rotate_image,
    generate_details_page_html,
    generate_cover_image,
)
```

Replace with:
```python
from w2k_epub import (
    _add_standalone_image_pages,
    _rotate_image_bytes,
    _should_rotate_image,
    generate_details_page_html,
    generate_cover_image,
)
```

- [ ] **Step 2: Run existing article tests to verify the import change works**

Run: `python -m pytest tests/test_details_page.py -v -k "not pdf" --timeout=30 2>&1 | tail -20`
Expected: Tests pass (4 failures from pre-existing issues are OK)


### Task 3: Clean up `test_toggles.py`

**Files:**
- Modify: `tests/test_toggles.py`

- [ ] **Step 1: Remove PDF-only tests and the SAMPLE_PDF constant**

Delete lines 1-81 (the entire "PDF path" section including imports that reference `paper2kindle_reflow`). The article tests (lines 83-211) remain untouched.

- [ ] **Step 2: Verify article tests still pass**

Run: `python -m pytest tests/test_toggles.py -v --timeout=30`
Expected: All remaining tests pass


### Task 4: Clean up `test_cover_image.py`

**Files:**
- Modify: `tests/test_cover_image.py`

- [ ] **Step 1: Update import in test_cover_with_image_has_dark_text_zone (line 8)**

Change `from paper2kindle_reflow import generate_cover_image` to `from w2k_epub import generate_cover_image`

- [ ] **Step 2: Update import in test_cover_without_image_uses_light_background (line 31)**

Same change.

- [ ] **Step 3: Update import in test_article_epub_cover_uses_hero_image**

Line 83 `from server import _generate_article_epub` stays (articles are web2kindle).

- [ ] **Step 4: Delete PDF-only tests**

Delete:
- `test_select_cover_image_prefers_large_images_from_page_zero` (lines 43-62)
- `test_select_cover_image_returns_none_when_all_too_small` (lines 65-77)
- `test_wide_image_detected` (lines 113-124)
- `test_narrow_image_not_detected` (lines 127-138)
- `test_rotated_image_page_structure` (lines 141-147)

These all use `ExtractedImage`, `select_cover_image`, or `_create_rotated_image_page` from paper2kindle_reflow — PDF-only types/functions.

- [ ] **Step 5: Verify remaining tests pass**

Run: `python -m pytest tests/test_cover_image.py -v --timeout=30 2>&1`
Expected: Only `test_cover_with_image_has_dark_text_zone` and `test_cover_without_image_uses_light_background` and `test_article_epub_cover_uses_hero_image` remain and pass


### Task 5: Clean up `test_details_page.py`

**Files:**
- Modify: `tests/test_details_page.py`

- [ ] **Step 1: Delete PDF-only tests**

Delete these functions and their helper:
- `_make_minimal_epub` (lines 15-25) — only used by PDF tests
- `test_pdf_epub_has_details_page` (lines 28-47) — uses `reflow_pdf`
- `test_pdf_details_page_content` (lines 50-67) — uses `reflow_pdf`
- `test_article_epub_details_page_spine` (lines 150-179) — keeps running `_generate_article_epub` from server, should keep but it's article test. Actually wait, this test only uses `server` and `ebooklib`, no paper2kindle. Keep it.
- `test_generate_preview_multipart_pdf_stays_on_pdf_path` (lines 182-215) — references `_pdf_bytes_to_epub` and `PDF_PRODUCT_NAME` which don't exist
- `test_preview_views_refresh_stale_or_missing_cached_html` (lines 218-312) — references `PDF_PRODUCT_NAME`, should be kept but the `workspace` entry with `PDF_PRODUCT_NAME` needs to be removed. But it calls `_make_minimal_epub` which calls `server._generate_article_epub` — let me check.
- `test_generate_preview_json_local_file_returns_clear_error` (lines 315-327) — tests `/pdf/generate-preview` route
- `test_multipart_html_still_uses_article_extraction` (lines 329-353) — references non-existent `_multipart_content_to_epub`
- `test_pdf_generate_preview_rejects_html_input` (lines 422-439) — tests `/pdf/generate-preview`
- `test_article_send_to_kindle_rejects_pdf_url` (lines 441-451) — tests article pipeline rejecting PDF URL. Actually this uses server client, not paper2kindle. Let me check.
- `test_pdf_send_to_kindle_rejects_html_url` (lines 454-471) — tests `/pdf/send-to-kindle`
- `test_pdf_wide_image_adds_rotated_page_in_spine` (lines 474-514) — uses `generate_epub`, `PageLayout`, `TextBlock`, `ExtractedImage` from paper2kindle_reflow

And the functions from paper2kindle_reflow used in non-PDF tests:
- `generate_details_page_html` — used in `test_article_details_page_has_metadata` and `test_details_page_handles_missing_fields`. Need to update imports to `from w2k_epub import generate_details_page_html`

- [ ] **Step 2: Update imports for `generate_details_page_html`**

Change `from paper2kindle_reflow import generate_details_page_html` to `from w2k_epub import generate_details_page_html` in:
- `test_article_details_page_has_metadata` (line 72)
- `test_details_page_handles_missing_fields` (line 135)


### Task 6: Remove `paper2kindle_reflow.py` and test fixture

- [ ] **Step 1: Delete the file and fixture**

Run: `rm paper2kindle_reflow.py tests/fixtures/sample.pdf`

- [ ] **Step 2: Run full test suite to verify nothing broke**

Run: `python -m pytest tests/ -v --timeout=60 2>&1 | tail -30`
Expected: All non-PDF tests pass (some pre-existing failures in PDF-route tests should now be gone since those tests are removed)


### Task 7: Update `AGENTS.md`

**Files:**
- Modify: `AGENTS.md`

- [ ] **Step 1: Update references**

Changes needed:
- Remove references to `paper2kindle_reflow.py`
- Add `w2k_epub.py` description
- Remove "PDF pipeline" section (it belongs in a separate project)
- Remove CLI reflow command
- Update "Two independent pipelines" to reflect only the article pipeline
- Update "Key routes" table (remove PDF route references)
- Remove `paper2kindle_reflow.py` from "Important gotchas" and "Testing conventions"
- Remove PDF-related testing commands



### Task 8: Run full check

- [ ] **Step 1: Final test run**

Run: `python -m pytest tests/ -v --timeout=60 2>&1`
Expected: All tests pass

- [ ] **Step 2: Verify no remaining paper2kindle references**

Run: `grep -rn "paper2kindle\|pdf2kindle\|reflow_pdf\|sample\.pdf" --include="*.py" --include="*.md" . 2>/dev/null | grep -v ".pyc" | grep -v "docs/superpowers" | head -20`
Expected: Empty (zero references except in design docs)

- [ ] **Step 3: Verify Flask server starts**

Run: `timeout 3 python3 server.py 2>&1 || true`
Expected: Server starts without ImportError (will time out waiting for requests)
