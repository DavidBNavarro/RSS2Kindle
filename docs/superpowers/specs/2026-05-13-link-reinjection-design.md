# Link Reinjection for Clickable Kindle Hyperlinks

## Problem

The `keep_links` toggle is non-functional for article body links. Trafilatura's
`extract(output_format="html")` strips nearly all `<a>` tags during extraction,
so even with `keep_links=True` (default), the article content in the EPUB has
zero clickable hyperlinks. The toggle only affects the details page (Source URL
and DOI rows in `w2k_epub.py:312-321`).

## Solution

Add a `_reinject_links()` function following the same save-and-restore pattern
as `_reinject_images()`: extract link data from the original HTML before
trafilatura, then restore matching links into the extracted output.

## Pipeline Change

In `server.py:_html_to_article_epub()`, the current dead code:

```python
if not keep_links:
    content_html = re.sub(r'<a\b[^>]*>(.*?)</a>', r'\1', content_html, flags=re.DOTALL)
```

Becomes an active toggle:

```python
if keep_links:
    content_html = _reinject_links(content_html, cleaned_html, url)
else:
    content_html = re.sub(r'<a\b[^>]*>(.*?)</a>', r'\1', content_html, flags=re.DOTALL)
```

This runs after all post-extraction restorations and image reinjection (same
pipeline slot as the current code).

## `_reinject_links()` Design

### Phase 1 — Extraction (from original HTML)

1. Parse `cleaned_html` with BeautifulSoup
2. Find the article image container via `_find_article_image_container()` (reuse
   existing helper — this is the article body, not nav/sidebar)
3. Iterate all `<a>` tags within the container:
   - **Skip**: `href` is empty, `#`, `javascript:`, or link text `< 3` chars
   - **Resolve**: relative URLs via `urljoin(base_url, href)`
   - **Deduplicate**: by normalized text (`" ".join(text.split())`)
   - **Store**: `list[(text, resolved_url)]`
4. Sort by `text` length descending (longest match first — prevents short
   substring matches consuming longer link text)

### Phase 2 — Reinjection (into extracted HTML)

1. Parse `content_html` (trafilatura output) with BeautifulSoup
2. For each `(link_text, link_url)` pair:
   - Scan `<p>`, `<li>`, `<blockquote>`, `<figcaption>` elements (same element
     types image reinjection targets)
   - **Skip** elements that already contain any `<a>` child (avoid double-wrapping)
   - For each text node within the element, check if `link_text` is a substring
   - When found:
     ```
     idx = text_node.index(link_text)
     before = NavigableString(text_node[:idx])
     after = NavigableString(text_node[idx + len(link_text):])
     a_tag = new_tag("a", href=link_url)
     a_tag.string = link_text
     text_node.replace_with(a_tag)
     if after:  a_tag.insert_after(after)
     if before: a_tag.insert_before(before)
     ```
   - **First match only** per link text (avoid over-linkifying common words)
3. Return `str(traf_soup)`

## Edge Cases Handled

| Case | Handling |
|------|----------|
| Identical link texts, different URLs | First match wins; subsequent identical texts are skipped |
| Text modified by trafilatura (whitespace) | Substring match works if core text survives; normalization `" ".join(text.split())` on extraction side |
| Link already present (survived trafilatura) | Element-level guard: skip if any `<a>` child exists |
| Relative URLs | Resolved via `urljoin` against article URL |
| Non-content links (nav, sidebar) | Excluded by scoping to `_find_article_image_container()` |
| Link text appears in heading | Headings excluded — only `<p>`, `<li>`, `<blockquote>`, `<figcaption>` |
| Link text appears in multiple elements | Per-link-text: first match in any eligible element wins |

## Testing

Add to `tests/test_toggles.py`:

1. **`test_reinject_links_restores_matching_text`** — article HTML with `<a href="https://example.com">some text</a>` in body; verify EPUB content.xhtml contains `<a href="https://example.com">some text</a>`
2. **`test_reinject_links_skips_nav_links`** — `<nav>` links outside article container are not reinjected
3. **`test_reinject_links_relative_urls`** — `<a href="/relative/path">text</a>` gets resolved to absolute URL
4. **`test_reinject_links_false_strips_anchors`** — existing test, unchanged
5. **`test_reinject_links_false_preserves_text`** — existing test, unchanged

## Files Changed

| File | Change |
|------|--------|
| `server.py` | Add `_reinject_links()` function (~60 lines); swap logic in `_html_to_article_epub()` |
| `tests/test_toggles.py` | Add 3 new tests for link reinjection |
