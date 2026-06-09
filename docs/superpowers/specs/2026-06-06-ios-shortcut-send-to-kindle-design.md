# iOS Shortcut + Scriptable: Send to Kindle

## Goal

Allow sending articles to Kindle from **any iOS app** (Newsify, Chrome, Safari,
etc.) via the Share Sheet, without requiring a running server or the Chrome
extension. Entirely serverless — the pipeline runs on-device via iOS Scriptable.

## Components

```
iOS Share Sheet (any app)
       │
       ▼  URL
┌──────────────────┐     ┌─────────────────────┐     ┌──────────────────┐
│ Shortcut          │────▶│ Scriptable           │     │ iCloud Drive      │
│ "Send to Kindle"  │     │ "WK2Kindle" script   │────▶│ web2kindle/       │
│                   │◀────│                      │     │  bundle.js        │
│  ~10 actions      │     │  ~20 lines           │     │                   │
└──────────────────┘     └──────────────────────┘     └──────────────────┘
       │
       ▼
   iOS Mail → SMTP → Amazon Kindle
```

## Files

### New directory: `ios/`

| File | Purpose |
|---|---|
| `ios/bundle.js` | Bundled JS pipeline — minified Readability, JSZip, text-only article extractor, text-only EPUB generator, glue code |
| `ios/wk2kindle.js` | Scriptable script — reads `bundle.js` from iCloud Drive, calls `processArticle()`, returns result |

### Not stored as files

| Artifact | Notes |
|---|---|
| Shortcut "Send to Kindle" | Built manually in Shortcuts app (~10 actions). Cannot be committed as text. |

## bundle.js

Single file concatenated in order, evaluated in Scriptable's global scope.

### Sections

| # | Content | Source | What it exports |
|---|---|---|---|
| 1 | Readability (minified) | `extension/lib/readability.js` | `globalThis.Readability` |
| 2 | JSZip (minified) | `extension/lib/jszip.min.js` | `globalThis.JSZip` |
| 3 | Text-only extractor | Adapted from `article-extractor.js` | `extractArticle(html, url)`, `stripUiText()`, `stripTrailingRelated()` |
| 4 | Text-only EPUB generator | Adapted from `epub-generator.js` | `generateEpub(opts)` (no image handling) |
| 5 | Glue code | New | `bundle.processArticle(url)` |

### Text-only extractor (section 3)

Kept from `article-extractor.js`:
- `extractArticle(html, url)` — DOM parse + Readability + supplement content
- `stripUiText(content)` — Remove UI noise paragraphs
- `stripTrailingRelated(content)` — Remove "related" sections
- `extractMetadata(html, url)` — OG meta extraction

Removed (image/link specific):
- `reinjectImages()` — not applicable to text-only
- `reinjectLinks()` — not applicable
- `restoreOrderedLists()` — nice-to-have, can add later
- `restoreBlockquotes()` — nice-to-have, can add later

### Text-only EPUB generator (section 4)

Adapted from `epub-generator.js`:

Preserved:
- EPUB 2.0 structure (mimetype, container.xml, content.opf, toc.ncx)
- Cover page (text-only SVG, no cover image — just title/author/sitename)
- Details page (metadata table)
- Content XHTML with CSS
- `_sanitizeHtmlForEpub()` — strips HTML5-only tags and `<img>` tags
- `_uuid()`, `_esc()`, `_selfCloseVoidElements()`

Removed:
- All image processing — no `fetchImageAsBlob()`, no image rotation, no conversion
- `imageProcessor` parameter and image embedding loop in `generateEpub()`
- `deliveryOptimize()`, `warnEpubSize()` — not needed (no images, no size issue)
- Cover image generation (no jpg/png cover art)

### Glue code (section 5)

```javascript
var bundle = {};

bundle.processArticle = async function(url) {
  if (!url) throw new Error("No URL provided");

  const response = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (iPhone; web2kindle iOS) AppleWebKit/605.1.15" }
  });
  if (!response.ok) throw new Error("HTTP " + response.status);
  const html = await response.text();

  const doc = new DOMParser().parseFromString(html, "text/html");
  const reader = new Readability(doc.cloneNode(true));
  const article = reader.parse();
  if (!article || !article.content) throw new Error("Could not extract article");

  let content = article.content;
  content = stripUiText(content);
  content = stripTrailingRelated(content);

  const epubBlob = await generateEpub({
    article: Object.assign({}, article, { content: content }),
    originalHtml: html,
    url: url,
    title: article.title,
    keepImages: false,
    keepLinks: true,
    imageProcessor: null
  });

  const buffer = await epubBlob.arrayBuffer();
  var bytes = new Uint8Array(buffer);
  var binary = "";
  for (var i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  var epubBase64 = btoa(binary);

  return { title: article.title, epubBase64: epubBase64 };
};
```

## wk2kindle.js (Scriptable script)

Installed in Scriptable app as a new script named "WK2Kindle". Called from
Shortcut with a URL as text input. Returns a dictionary to Shortcut.

```javascript
// WK2Kindle — called from Shortcut "Send to Kindle"
const url = args.plainTexts[0];
if (!url) throw new Error("No URL provided");

const fm = FileManager.iCloud();
const bundlePath = fm.joinPath(fm.documentsDirectory(), "web2kindle/bundle.js");
const code = fm.readString(bundlePath);
eval(code); // defines globalThis.Readability, JSZip, bundle

const result = await bundle.processArticle(url);
return result; // { title, epubBase64 }
```

## Shortcut "Send to Kindle"

### Setup

1. Open Shortcuts app → tap `+`
2. Tap `i` (info) → toggle on "Share Sheet"
3. Accepts: URLs

### Actions (in order)

| # | Action Type | Configuration |
|---|---|---|
| 1 | **Run Scriptable** | Script: `WK2Kindle`<br>Input: `Shortcut Input` |
| 2 | **If** | Condition: `Run Scriptable` `has any value` |
| 3 | **Get Dictionary from Input** | Input: `Run Scriptable` result |
| 4 | **Get Dictionary Value** | Key: `title` |
| 5 | **Get Dictionary Value** | Key: `epubBase64` |
| 6 | **Base64 Encode** | Mode: Decode<br>Input: `epubBase64` |
| 7 | **Send Email** | To: `(user's Kindle email, set once)`<br>Subject: `convert`<br>Body: `Sent from web2kindle: {title}`<br>Attachment: Base64 Decode result<br>Filename: `article.epub` |
| 8 | **Show Notification** | Title: `Sent to Kindle`<br>Body: `{title}` |
| 9 | **Otherwise** | (from step 2 If) |
| 10 | **Show Notification** | Title: `Failed`<br>Body: `Could not process article` |

The user sets their Kindle email address (e.g., `user@kindle.com`) in the
"Send Email" To: field. This is configured once when building the Shortcut.

## One-time setup

1. Install **Scriptable** from App Store (free)
2. Create a new script in Scriptable named `WK2Kindle`
3. Paste the contents of `ios/wk2kindle.js` into it
4. Place `ios/bundle.js` at `iCloud Drive/Scriptable/web2kindle/bundle.js`
   (Scriptable's iCloud documents folder)
5. Build the Shortcut in Shortcuts app following the actions above
6. Ensure your Gmail is configured in iOS **Mail** app
7. Verify your sending email is in Amazon's **Approved Personal Document
   Email List** at https://www.amazon.com/hz/mycd/myx#/home/settings/pdoc

## Error handling

| Scenario | Behavior |
|---|---|
| No URL provided | Scriptable throws error → Shortcut shows "Failed" notification |
| HTTP fetch fails | `processArticle` throws → Shortcut shows "Failed" notification |
| Readability returns null | `processArticle` throws "Could not extract article" → Shortcut shows "Failed" notification |
| Send Email fails | iOS Mail handles natively (may show alert) |
| bundle.js not found in iCloud | Scriptable throws file read error → Shortcut shows "Failed" notification |

## Future enhancements

- **Image support**: Add image processing back (OffscreenCanvas in iOS 16.4+)
- **Preview**: Open a preview page before sending
- **Save EPUB locally**: Also save to Files app
- **Batch processing**: Multiple URLs from a reading list
- **Readability options**: Toggle link preservation

## Testing

- Manual: Share URL from Newsify → Shortcut runs → Kindle receives EPUB
- Manual: Share URL from Chrome → Shortcut runs → Kindle receives EPUB
- Manual: Share URL from Safari → Shortcut runs → Kindle receives EPUB
- Error case: Share a non-article URL (e.g., google.com) → "Failed" notification
- Error case: Run Shortcut with no bundle.js in iCloud → "Failed" notification
