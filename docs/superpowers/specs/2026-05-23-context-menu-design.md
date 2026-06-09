# Web2Kindle Context Menu

## Goal

Add right-click context menu items so users can send pages/links/selections to
Kindle without opening the popup. Two menu items per context: "Send to Kindle"
(silent send) and "Send to Kindle (Preview)" (open preview tab first).

## Contexts

| Context | Menu items shown |
|---|---|
| Right-click a link (`contexts: ["link"]`) | "Send to Kindle", "Send to Kindle (Preview)" |
| Right-click selected text (`contexts: ["selection"]`) | "Send to Kindle", "Send to Kindle (Preview)" |
| Right-click on page (no link, no selection) | Nothing shown |

## Architecture

```
User right-clicks
       │
       ▼
background.js (service worker, MV3)
  chrome.contextMenus.onClicked
       │
       │  Opens hidden tab (not focused)
       ▼
processor.html + processor.js (DOM-capable tab)
  1. Read params from URL (?action=&url=&selection=)
  2. Fetch + extract + post-process + generate EPUB
       │
       ├── action=send ──► chrome.runtime.sendMessage({action:"sendEmail"})
       │                       │
       │                       ▼
       │                   background.js sends via Gmail API
       │                       │
       │                       ▼
       │                   chrome.notifications.create() → window.close()
       │
       └── action=preview ──► chrome.storage.local.set({preview_data})
                              │
                              ▼
                          chrome.tabs.create({url:"preview.html"})
                              │
                              ▼
                          window.close()
```

## Files

### New files

- **`extension/processor.html`** — Invisible processing page. Includes all
  pipeline scripts but no UI. Entry point for hidden-tab processing.
- **`extension/processor.js`** — Pipeline driver for context menu actions.
  Reads URL params, runs fetch→extract→EPUB→send/store, closes.

### Modified files

- **`extension/manifest.json`** — Add `"contextMenus"` and `"notifications"`
  to permissions array.
- **`extension/background.js`** — Register menu items via
  `chrome.contextMenus.create` on `runtime.onInstalled`. Handle clicks:
  construct processor URL with params (including `pageTitle` from `tab.title`
  for selection context), open as hidden tab.

## Behavior details

### Link + "Send to Kindle"
1. Fetch the link URL via `fetchViaBackground()` (reused from popup)
2. Run full extraction pipeline: `resolveArchiveUrl` → `extractArticle`
   → post-process (stripUiText, stripTrailingRelated, restoreOrderedLists,
   restoreBlockquotes, reinjectImages, reinjectLinks, extractMetadata)
3. Generate EPUB with images+links enabled
4. `blobToBase64` → `chrome.runtime.sendMessage({action:"sendEmail"})` to
   background service worker
5. Background sends via Gmail API, returns `{success, kindle_email}`
6. `chrome.notifications.create` with result message
7. `incrementConversion()` + `recordSend()`
8. `window.close()`

### Link + "Send to Kindle (Preview)"
1-3: Same fetch + extract + generate EPUB
4. Store result as `preview_data` in `chrome.storage.local` (same format popup
   uses)
5. `chrome.tabs.create({ url: chrome.runtime.getURL("preview.html") })`
6. `window.close()`

### Selection + "Send to Kindle"
1. Wrap selected text as `<html><body><p>{selection}</p></body></html>`
2. Title = `"Clipped from {pageTitle}"` (page title from `tab.title`)
3. `extractArticle` on the wrapped HTML
4. Generate EPUB with images disabled (no images in a text selection)
5. Same send+notify+close flow as link mode

### Selection + "Send to Kindle (Preview)"
1-4: Same as selection send, but store preview_data + open preview tab

## Error handling

- **Fetch fails**: notification "Could not fetch page"
- **Extraction fails**: notification "Could not extract article"
- **Gmail API fails**: notification with error message
- **No Kindle email configured**: notification "Set your Kindle email in Settings"
- **Conversion limit reached**: notification "Free limit reached"
- **EPUB too large (>25MB)**: notification "EPUB too large to email"
- All errors: `recordSend(..., "failed", errMessage)` before closing

## Reused functions (from existing code)

Processor.js will include standalone copies of these pure (UI-free) functions
from popup.js:

- `fetchViaBackground(url)` — already pure, no UI
- `resolveArchiveUrl(url)` — already pure
- `blobToBase64(blob)` — already pure
- `sendEmailViaBackground(epubBase64, title, url, filename)` — already pure
- `formatSendSuccess(result)` — string formatter, no UI
- `warnEpubSize(blob)` — already pure

Scripts loaded by processor.html provide the rest:
- `extractArticle()` from article-extractor.js
- `generateEpub()` from epub-generator.js
- Image functions from image-processor.js
- `recordSend()` from history-store.js
- `incrementConversion()` from conversion-counter.js
- `hasProLicense()` from license.js

## Notification style

```
Title:  "Sent to dnavarro@kindle.com"
Message: "Article Name"

On error:
Title:  "Send failed"
Message: "Could not fetch page"
```

Using `chrome.notifications.create` with type `"basic"` and an icon.

## Testing

- Manual: right-click link → "Send to Kindle" → notification appears
- Manual: right-click link → "Send to Kindle (Preview)" → preview opens
- Manual: select text → "Send to Kindle" → notification for clipped article
- Existing tests unchanged (no new unit tests needed for this UI feature)
