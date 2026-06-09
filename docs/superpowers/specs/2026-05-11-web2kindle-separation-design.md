# Web2Kindle — Pipeline Separation Design

## Goal

Remove all PDF/paper2kindle dependencies from the web2kindle workspace so that
web2kindle is a self-contained article-to-Kindle pipeline with zero references
to PDF processing.

## Background

The codebase had `server.py` (article pipeline) importing 9 functions from
`paper2kindle_reflow.py` (PDF pipeline) for shared EPUB formatting utilities.
This created a cross-pipeline dependency and brought PDF/paper terminology into
the web2kindle workspace.

## Plan

### 1. Create `w2k_epub.py` — web2kindle-owned EPUB utilities

Extract these functions from `paper2kindle_reflow.py` into a new module owned
by web2kindle (not shared with any other project):

| Function | Source | Purpose |
|---|---|---|
| `_escape()` | p2k:2153 | HTML escaping for details page |
| `_get_image_size()` | p2k:1288 | Image dimension detection for rotation |
| `_should_rotate_image()` | p2k:1315 | Landscape image detection |
| `_rotate_image_bytes()` | p2k:1346 | Image rotation via PIL |
| `_create_rotated_image_page()` | p2k:1356 | XHTML page for standalone rotated image |
| `_add_standalone_image_pages()` | p2k:1412 | Add rotated image pages to EPUB spine |
| `generate_cover_image()` | p2k:2266 | 600x800 PNG cover with title/author |
| `generate_details_page_html()` | p2k:2436 | details.xhtml metadata table |

No modifications to function signatures or behavior. The module is
web2kindle-internal — not a shared library.

### 2. Update `server.py`

- Replace `from paper2kindle_reflow import ...` with `from w2k_epub import ...`
- Remove 4 dead imports: `_cover_author_text`, `_format_inline_body_html`,
  `_normalize_spaced_heading`, `_split_body_paragraphs`

### 3. Remove `paper2kindle_reflow.py` from workspace

The PDF pipeline belongs in its own `pdf2kindle` project/repo. No PDF or paper
references remain in web2kindle code.

### 4. Clean up test files

- `tests/test_cover_image.py`: Update imports from `paper2kindle_reflow` to
  `w2k_epub`. Remove tests that use PDF-only types (`ExtractedImage`,
  `select_cover_image`, `_create_rotated_image_page`).
- `tests/test_details_page.py`: Remove tests that use `reflow_pdf`,
  `generate_epub`, `ExtractedImage`, `PageLayout`, `TextBlock` (PDF-only).
  Remove tests for non-existent PDF routes (`/pdf/generate-preview`,
  `/pdf/send-to-kindle`). Remove references to `PDF_PRODUCT_NAME`,
  `_pdf_bytes_to_epub`, etc.
- `tests/test_toggles.py`: Remove PDF pipeline tests (all use `reflow_pdf`).
- Remove `tests/fixtures/sample.pdf` if present (PDF test fixture).

### 5. Update `AGENTS.md`

Replace references to `paper2kindle_reflow.py` with `w2k_epub.py`. Update
command and structure documentation.

## Files Changed

- `w2k_epub.py` — new file
- `server.py` — update import
- `tests/test_cover_image.py` — update imports, remove PDF-only tests
- `tests/test_details_page.py` — remove PDF tests
- `tests/test_toggles.py` — remove PDF tests (file may be deleted)
- `paper2kindle_reflow.py` — deleted
- `AGENTS.md` — updated
