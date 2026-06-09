"""EPUB-building utilities for the web2kindle article pipeline.

Owned by web2kindle -- not shared with any other project.
"""
import hashlib
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
    if width <= 500 or height <= 0:
        return False
    if min(width, height) < 120:
        return False
    return (width / height) > 1.2


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
        doi_row,
        url_row,
        row("Sent to Kindle", sent_date),
        read_time_row,
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
