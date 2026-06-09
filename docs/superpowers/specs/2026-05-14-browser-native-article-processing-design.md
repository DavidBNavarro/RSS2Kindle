# Browser-Native Article Processing

## Goal

Replace server-side article extraction (trafilatura) and EPUB generation (ebooklib) with
in-extension processing using Mozilla Readability and JSZip. The server is stripped down
to a config/SMTP relay; the extension handles the entire article→EPUB pipeline.

## Architecture

**Before:**
```
popup.js → server.py (trafilatura → 200+ lines BS4 → ebooklib → PIL) → EPUB
```

**After:**
```
popup.js → background.js (fetch HTML)
         → article-extractor.js (Readability + ported DOM post-processing)
         → epub-generator.js (JSZip)
         → EPUB blob → download / server.py /send-epub SMTP relay
```

## Files

### New: `extension/article-extractor.js`

Ports all server-side extraction + post-processing.

| Function | Source | Purpose |
|---|---|---|
| `extractArticle(html, url)` | New (Readability wrapper) | Returns `{title, author, content, excerpt, textContent, length}` |
| `stripUiText(html)` | `_strip_ui_text` | Removes "listen to this article", timestamps, "learn more" |
| `stripTrailingRelated(html)` | `_strip_trailing_related` | Removes related-content sections |
| `restoreOrderedLists(html, sourceHtml)` | `_restore_ordered_lists` | Fingerprinted `<ol>` restoration |
| `restoreBlockquotes(html, sourceHtml)` | `_restore_blockquotes` | Text-fingerprinted `<blockquote>` restoration |
| `reinjectImages(html, sourceHtml, url)` | `_reinject_images` | Full image reinjection pipeline (~300 lines server, ported to DOM APIs) |
| `reinjectLinks(html, sourceHtml, url)` | `_reinject_links` | Link reinjection from source |
| `extractMetadata(html, url)` | `_extract_meta_image_urls` + trafilatura metadata | Title, author, sitename, date, read time |

### Modified: `extension/epub-generator.js`

New `generateEpub()` function using JSZip:

```js
async function generateEpub({ article, html, keepImages, keepLinks, rotateImages })
  → Promise<Blob>
```

- Builds EPUB structure: `mimetype`, `META-INF/container.xml`, `OEBPS/content.opf`,
  `OEBPS/toc.ncx`, `OEBPS/content.xhtml`, `OEBPS/details.xhtml`, `OEBPS/style/default.css`
- Calls existing `generateCoverImageSvg()` for cover
- Calls existing `generateDetailsPage()` for metadata page
- Embeds images as EPUB items when `keepImages=true` (fetched via `image-processor.js`)
- Returns zip blob

Existing `generateCoverImageSvg()` and `generateDetailsPage()` stay as-is.

### Modified: `extension/popup.js`

- New `processArticle(url)` flow: fetch HTML → extract → post-process → generate EPUB → blob
- `handleConvert()` rewritten: in-extension EPUB → blob → POST to server /send-epub
- `handleDownload()` rewritten: in-extension EPUB → blob → trigger download
- `handlePreview()` rewritten: in-extension EPUB → blob URL → open preview tab
- Batch queue, paste mode updated to use in-extension pipeline
- Still uses background.js `fetchPageContent` for HTML fetching

### Modified: `extension/popup.html`

Add script tags:
```html
<script src="lib/readability.min.js"></script>
<script src="lib/jszip.min.js"></script>
<script src="article-extractor.js"></script>
```

### Modified: `server.py`

**Removed routes:** `/preview`, `/convert`, `/article/send-to-kindle`,
`/article/generate-preview`, `/view/<token>`, `/send-kindle-preview/<token>`,
`/debug/<...>`

**Removed imports:** `trafilatura`, `ebooklib`, `PIL`, `BeautifulSoup`

**Kept routes:** `/health` (updated capabilities), `/config` (GET/POST),
`/history` (GET/DELETE)

**Added route:** `POST /send-epub` — accepts multipart/form-data with `epub` file field
+ optional `title` + `url` form fields. Calls `_send_epub_to_kindle()`.
Returns `{success, kindle_email, delivery_notice?}`.

### New: `extension/lib/readability.min.js`

Bundled from `@mozilla/readability` npm package.

### New: `extension/lib/jszip.min.js`

Bundled from `jszip` npm package.

## Data flow

### Send to Kindle

```
1. User clicks "Send to Kindle"
2. popup.js → background.js fetchPageContent(url) → raw HTML
3. article-extractor.js extractArticle(html, url) → article object
4. article-extractor.js post-processing (strip, restore, reinject)
5. epub-generator.js generateEpub({article, html, ...}) → EPUB Blob
6. POST Blob to server.py /send-epub
7. server.py sends via SMTP → Kindle
8. Record in history-store.js
9. Increment conversion counter
```

### Download EPUB

```
1-5. Same as above
6. URL.createObjectURL(epubBlob) + <a>.click() → download
7. Increment conversion counter
```

### Preview

```
1-5. Same as above
6. URL.createObjectURL(epubBlob) → open in tab
   (future: inline preview with section editing)
```

## SMTP sending after refactor

Server.py keeps SMTP config management + a single `/send-epub` endpoint.
The extension generates the EPUB in-browser and sends the finished blob
to the server for delivery. This keeps the SMTP implementation (which
needs raw TCP sockets / smtplib) on the server side.

## Testing

- `tests/image-processor.test.js` — already exists, unchanged
- New JS test runner for `article-extractor.js` functions
- New JS test for `epub-generator.js` `generateEpub()`
- Update `tests/popup.test.js` to mock in-extension pipeline
- Server tests stay (for remaining routes)
- Python cover/detail tests stay (`w2k_epub.py` kept)

## Edge cases

| Case | Handling |
|---|---|
| Readability returns null | Fallback: DOM article extraction (ported `_extract_dom_article_html`) |
| Thin content (<150 words) | Error with same message as current server |
| No images in article | No-op, EPUB has no images (cover only) |
| Image fetch fails | Skip image, continue (same as server) |
| Paywalled page | Use existing archive.is bypass in contentScript.js, then re-fetch |
| Bot challenge page | Error with suggestion to open in browser first |
| Batch mode | Process sequentially, each generates EPUB in-memory |
