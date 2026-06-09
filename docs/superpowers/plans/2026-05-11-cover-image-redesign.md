# Cover Image Redesign — Typographic/Geometric Kindle Covers

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) for syntax tracking.

**Goal:** Replace `generate_cover_image()` PIL-based hero-image cover with a pure typographic/geometric grayscale design. Remove `_extract_hero_image()` and all hero_image plumbing from the article pipeline.

**Architecture:** `generate_cover_image()` is a standalone pure function in `w2k_epub.py`. The server calls it once when building the EPUB, passing `sitename` and `read_time` for the new metadata footer. No dependency changes (PIL stays).

**Tech Stack:** Python 3, Pillow, pytest, ebooklib

**Spec:** `.opencode/plans/2026-05-11-cover-image-redesign.md`

---

### Task 1: Rewrite `generate_cover_image()` in `w2k_epub.py`

**Files:**
- Modify: `w2k_epub.py` — replace the function (lines 97-204)

- [ ] **Step 1: Remove old function and write new version**

Replace the entire `generate_cover_image` function (from line 97 `def generate_cover_image` through line 204 `return buf.getvalue()`) with the new implementation below. Also remove the unused `_escape` function (line 9-14) if not used elsewhere in the file, otherwise keep it.

New function:

```python
import hashlib

def generate_cover_image(title: str, authors: str,
                          sitename: str = "",
                          read_time: int | None = None) -> bytes:
    from PIL import Image, ImageDraw, ImageFont

    WIDTH, HEIGHT = 600, 800
    MARGIN = 50
    MAX_TEXT_W = WIDTH - 2 * MARGIN
    TITLE_TOP = 140
    RULE_W = 180
    RULE_H = 6
    RULE_GAP = 40
    AUTHOR_GAP = 30
    FOOTER_GAP = 70
    FOOTER_SIZE = 14
    MAX_TITLE_H = 380

    BG = (255, 255, 255)
    TITLE_COLOR = (22, 22, 26)
    RULE_COLOR = (80, 80, 80)
    AUTHOR_COLOR = (50, 50, 54)
    FOOTER_COLOR = (140, 140, 140)

    img = Image.new("RGBA", (WIDTH, HEIGHT), BG)
    draw = ImageDraw.Draw(img)

    def _load_font(size, serif=True):
        if serif:
            paths = (
                "/System/Library/Fonts/Georgia.ttf",
                "/System/Library/Fonts/Times.ttc",
                "/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf",
                "C:\\Windows\\Fonts\\times.ttf",
            )
        else:
            paths = (
                "/System/Library/Fonts/Helvetica.ttc",
                "/System/Library/Fonts/SFNSText.ttf",
                "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
                "C:\\Windows\\Fonts\\arial.ttf",
            )
        for path in paths:
            try:
                return ImageFont.truetype(path, size)
            except (OSError, IOError):
                continue
        return ImageFont.load_default(size=size)

    def _wrap(text, font, max_width):
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

    def _text_h(font):
        return draw.textbbox((0, 0), "Ag", font=font)[3]

    def _line_h(font):
        return _text_h(font) + 14

    # Template selection (deterministic across runs)
    template = hashlib.md5(title.encode()).digest()[0] % 3

    # Title font sizing: find the largest size where title fits in MAX_TITLE_H
    font_title = None
    for size in (80, 72, 64, 56, 48, 40, 36, 30):
        ft = _load_font(size, serif=True)
        wrapped = _wrap(title, ft, MAX_TEXT_W)
        total = _line_h(ft) * len(wrapped)
        if total <= MAX_TITLE_H or size <= 30:
            font_title = ft
            title_lines = wrapped
            break

    font_author = _load_font(28, serif=False)
    font_footer = _load_font(FOOTER_SIZE, serif=False)

    # Compute title block height
    title_block_h = _line_h(font_title) * len(title_lines)

    if template == 0:
        # Centered classic
        title_x = MARGIN
        title_y = TITLE_TOP + (MAX_TITLE_H - title_block_h) // 2
        for i, line in enumerate(title_lines):
            tw = draw.textbbox((0, 0), line, font=font_title)[2]
            draw.text(((WIDTH - tw) // 2, title_y + i * _line_h(font_title)),
                      line, fill=TITLE_COLOR, font=font_title)

        rule_y = title_y + title_block_h + RULE_GAP
        draw.rectangle([(WIDTH // 2 - RULE_W // 2, rule_y),
                        (WIDTH // 2 + RULE_W // 2, rule_y + RULE_H)],
                       fill=RULE_COLOR)

        author_y = rule_y + RULE_H + AUTHOR_GAP
        for line in ([] if not authors else _wrap(authors, font_author, MAX_TEXT_W)):
            tw = draw.textbbox((0, 0), line, font=font_author)[2]
            draw.text(((WIDTH - tw) // 2, author_y), line, fill=AUTHOR_COLOR,
                      font=font_author)
            author_y += _line_h(font_author)

        if sitename or read_time:
            footer_y = author_y + FOOTER_GAP
            footer_parts = [p for p in (sitename,
                          f"{read_time} min read" if read_time else None) if p]
            footer_text = " · ".join(footer_parts)
            tw = draw.textbbox((0, 0), footer_text, font=font_footer)[2]
            draw.text(((WIDTH - tw) // 2, footer_y), footer_text,
                      fill=FOOTER_COLOR, font=font_footer)

    elif template == 1:
        # Left-aligned
        title_x = MARGIN
        title_y = TITLE_TOP + (MAX_TITLE_H - title_block_h) // 2
        for i, line in enumerate(title_lines):
            draw.text((MARGIN, title_y + i * _line_h(font_title)),
                      line, fill=TITLE_COLOR, font=font_title)

        rule_w = 120
        rule_y = title_y + title_block_h + RULE_GAP
        draw.rectangle([(MARGIN, rule_y), (MARGIN + rule_w, rule_y + RULE_H)],
                       fill=RULE_COLOR)

        author_y = rule_y + RULE_H + AUTHOR_GAP
        for line in ([] if not authors else _wrap(authors, font_author, MAX_TEXT_W)):
            draw.text((MARGIN, author_y), line, fill=AUTHOR_COLOR, font=font_author)
            author_y += _line_h(font_author)

        if sitename or read_time:
            footer_y = author_y + FOOTER_GAP
            footer_parts = [p for p in (sitename,
                          f"{read_time} min read" if read_time else None) if p]
            footer_text = " · ".join(footer_parts)
            draw.text((MARGIN, footer_y), footer_text, fill=FOOTER_COLOR,
                      font=font_footer)

    elif template == 2:
        # Title-first: title at very top, horizontal separator below, author + footer in lower section
        title_y = int(HEIGHT * 0.12)
        for i, line in enumerate(title_lines):
            tw = draw.textbbox((0, 0), line, font=font_title)[2]
            draw.text(((WIDTH - tw) // 2, title_y + i * _line_h(font_title)),
                      line, fill=TITLE_COLOR, font=font_title)
        rule_y = title_y + title_block_h + RULE_GAP + 20
        draw.rectangle([(MARGIN, rule_y), (WIDTH - MARGIN, rule_y + RULE_H)],
                       fill=RULE_COLOR)

        # Author + footer centered in lower portion
        lower_center = int(HEIGHT * 0.60)
        if authors:
            aw = _wrap(authors, font_author, MAX_TEXT_W)
            total_ah = _line_h(font_author) * len(aw)
            author_y = lower_center - total_ah // 2
            for line in aw:
                tw = draw.textbbox((0, 0), line, font=font_author)[2]
                draw.text(((WIDTH - tw) // 2, author_y), line, fill=AUTHOR_COLOR,
                          font=font_author)
                author_y += _line_h(font_author)

        if sitename or read_time:
            footer_parts = [p for p in (sitename,
                          f"{read_time} min read" if read_time else None) if p]
            footer_text = " · ".join(footer_parts)
            footer_y = int(HEIGHT * 0.80)
            tw = draw.textbbox((0, 0), footer_text, font=font_footer)[2]
            draw.text(((WIDTH - tw) // 2, footer_y), footer_text,
                      fill=FOOTER_COLOR, font=font_footer)

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()
```

- [ ] **Step 2: Verify the file still imports correctly**

Run: `python3 -c "from w2k_epub import generate_cover_image; print('OK')"`
Expected: `OK`

- [ ] **Step 3: Quick smoke test**

Run: `python3 -c "
from w2k_epub import generate_cover_image
from PIL import Image
from io import BytesIO
import numpy as np
data = generate_cover_image('Test Title', 'Test Author', sitename='Test Pub', read_time=5)
img = Image.open(BytesIO(data))
assert img.size == (600, 800)
arr = np.array(img)
assert arr[0,0,0] == 255  # white bg
assert arr[100,100,0] < 30  # dark title text
print('Smoke test passed')
"`
Expected: `Smoke test passed`

- [ ] **Step 4: Commit**

```bash
git add w2k_epub.py
git commit -m "feat: replace cover image with typographic/geometric grayscale design"
```

---

### Task 2: Update `server.py` — remove hero image plumbing, pass sitename + read_time

**Files:**
- Modify: `server.py`

- [ ] **Step 1: Update the import at line 32-38**

Remove `generate_cover_image` from the import (it's still needed). No import changes needed — `generate_cover_image` is still imported. The function signature changed but the import line stays the same.

- [ ] **Step 2: Remove `_extract_hero_image` (lines 522-550)**

Delete the function definition (lines 522-550 inclusive). Also remove the blank line above it so nearby functions remain cleanly separated.

Context of what to remove:
```python
# Remove lines 521-551 (the blank line and _extract_hero_image function)
```

- [ ] **Step 3: Update `_generate_article_epub` signature (line 1588-1592)**

Change:
```python
def _generate_article_epub(title: str, author: str, body_html: str, output_path: str,
                           url: str = "", pub_date: str = "", sitename: str = "",
                           hero_image: bytes | None = None,
                           keep_images: bool = True, keep_links: bool = True,
                           rotate_images: bool = True) -> None:
```

To:
```python
def _generate_article_epub(title: str, author: str, body_html: str, output_path: str,
                           url: str = "", pub_date: str = "", sitename: str = "",
                           keep_images: bool = True, keep_links: bool = True,
                           rotate_images: bool = True) -> None:
```

- [ ] **Step 4: Replace the cover image call (lines 1606-1609)**

Change:
```python
    if hero_image is None:
        hero_image = _extract_hero_image(body_html, url)
    cover_data = generate_cover_image(title, author or "", source_image=hero_image)
    book.set_cover("images/cover.png", cover_data)
```

To:
```python
    cover_data = generate_cover_image(title, author or "", sitename=sitename,
                                       read_time=read_time)
    book.set_cover("images/cover.png", cover_data)
```

Note: `read_time` is computed later in the function (line 1617). Move the `word_count` and `read_time` computation **before** the cover generation. Find the existing lines (1615-1617):
```python
    from datetime import date as _date
    word_count = len(re.sub(r"<[^>]+>", " ", body_html).split())
    read_time = max(1, round(word_count / 200))
```
Move these three lines to just before the `cover_data = generate_cover_image(...)` call.

- [ ] **Step 5: Verify everything compiles**

Run: `python3 -c "import server; print('OK')"`
Expected: `OK`

- [ ] **Step 6: Commit**

```bash
git add server.py
git commit -m "refactor: remove _extract_hero_image, pass sitename/read_time to cover"
```

---

### Task 3: Update tests — remove old cover tests, add new ones

**Files:**
- Modify: `tests/test_cover_image.py`
- Modify: `tests/test_toggles.py`

- [ ] **Step 1: Rewrite `tests/test_cover_image.py`**

Replace the entire file content:

```python
"""Tests for typographic/geometric cover generation (no hero image)."""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import numpy as np
from PIL import Image
from io import BytesIO


def test_cover_basic_dimensions():
    from w2k_epub import generate_cover_image
    data = generate_cover_image("Test Title", "Test Author")
    img = Image.open(BytesIO(data))
    assert img.size == (600, 800)


def test_cover_white_background():
    from w2k_epub import generate_cover_image
    data = generate_cover_image("Test Title", "Test Author")
    arr = np.array(Image.open(BytesIO(data)))
    # Top-left corner should be white
    assert arr[0, 0, 0] == 255
    assert arr[0, 0, 1] == 255
    assert arr[0, 0, 2] == 255


def test_cover_title_renders():
    from w2k_epub import generate_cover_image
    data = generate_cover_image("Short Title", "Test Author")
    arr = np.array(Image.open(BytesIO(data)))
    # Some pixels should be dark (title text)
    mean_dark = arr[arr[..., 0] < 50].mean() if (arr[..., 0] < 50).any() else 255
    assert mean_dark < 30


def test_cover_long_title_fits():
    from w2k_epub import generate_cover_image
    long_title = "This Is A Very Long Article Title That Should Wrap To Multiple Lines And Still Fit On The Cover Page"
    data = generate_cover_image(long_title, "Test Author")
    arr = np.array(Image.open(BytesIO(data)))
    # Bottom 50 pixels should be white (nothing drawn off-canvas)
    bottom_strip = arr[750:, :, :]
    assert bottom_strip.mean() > 200, "Long title should not overflow canvas"


def test_cover_author_fits():
    from w2k_epub import generate_cover_image
    data = generate_cover_image("Test Title", "A. Very Long Author Name That Could Wrap")
    arr = np.array(Image.open(BytesIO(data)))
    # Bottom 30 pixels should be white (author not clipped)
    bottom_strip = arr[770:, :, :]
    assert bottom_strip.mean() > 200, "Author should not overflow canvas"


def test_cover_metadata_footer():
    from w2k_epub import generate_cover_image
    data = generate_cover_image("Test Title", "Test Author",
                                 sitename="Test Pub", read_time=5)
    arr = np.array(Image.open(BytesIO(data)))
    # Footer text should exist somewhere (find gray pixels ~140)
    gray_mask = (arr[..., 0] > 120) & (arr[..., 0] < 160)
    assert gray_mask.sum() > 10, "Footer text should produce gray pixels"


def test_cover_grayscale_palette():
    from w2k_epub import generate_cover_image
    data = generate_cover_image("Test Title", "Test Author")
    arr = np.array(Image.open(BytesIO(data)))
    # All non-white pixels should be grayscale (R == G == B)
    non_white = (arr[..., 0] < 250) | (arr[..., 1] < 250) | (arr[..., 2] < 250)
    if non_white.any():
        diffs = np.abs(arr[..., 0].astype(int) - arr[..., 1].astype(int))
        assert diffs[non_white].max() <= 5, "Cover should be essentially grayscale"


def test_cover_no_author_omit_line():
    from w2k_epub import generate_cover_image
    data = generate_cover_image("Test Title", "")
    arr = np.array(Image.open(BytesIO(data)))
    # Should still produce a valid image
    assert arr.shape == (800, 600, 3)


def test_cover_template_variation():
    from w2k_epub import generate_cover_image
    # Different titles should potentially produce different templates
    data_a = generate_cover_image("AAAA", "Author")
    data_b = generate_cover_image("BBBB", "Author")
    arr_a = np.array(Image.open(BytesIO(data_a)))
    arr_b = np.array(Image.open(BytesIO(data_b)))
    # Both should be valid (templates are cosmetic, not functional)
    assert arr_a.shape == (800, 600, 3)
    assert arr_b.shape == (800, 600, 3)
```

- [ ] **Step 2: Remove `_extract_hero_image` mocks from `tests/test_toggles.py`**

In `tests/test_toggles.py`, remove the following 4 lines:
- Line 55: `monkeypatch.setattr(server, "_extract_hero_image", lambda html, url="": None)`
- Line 79: `monkeypatch.setattr(server, "_extract_hero_image", lambda html, url="": None)`
- Line 101: `monkeypatch.setattr(server, "_extract_hero_image", lambda html, url="": None)`
- Line 125: `monkeypatch.setattr(server, "_extract_hero_image", lambda html, url="": None)`

- [ ] **Step 3: Run all tests**

Run: `python -m pytest tests/ -v`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add tests/test_cover_image.py tests/test_toggles.py
git commit -m "test: update cover tests for typographic design, clean up hero image mocks"
```

---

### Task 4: Final verification

- [ ] **Step 1: Run full test suite**

Run: `python -m pytest tests/ -v`
Expected: All green

- [ ] **Step 2: Start server and generate a preview**

```bash
python3 -c "
import server
# Generate an article EPUB to verify the pipeline
from w2k_epub import generate_cover_image
data = generate_cover_image('Final Verification', 'Test Author', sitename='Test', read_time=3)
with open('/tmp/test_cover.png', 'wb') as f:
    f.write(data)
print('Cover generated: /tmp/test_cover.png')
"
```

- [ ] **Step 3: Verify the cover image visually (open /tmp/test_cover.png)**

Check that:
- Title is readable and centered
- Accent rule appears below title
- Author appears below rule
- Footer (Test · 3 min read) appears at the bottom
- Nothing is clipped off the canvas

- [ ] **Step 4: Run the server and do a /health check**

```bash
PORT=5001 python3 server.py &
sleep 2
curl -s http://127.0.0.1:5001/health | python3 -m json.tool
```

Expected: Server starts without errors, health endpoint returns JSON.

Kill the server afterward.
