# Popup Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delegate all heavy article processing from the popup (`popup.js`) to a processing tab (`processor.html`) so the user can close the popup immediately and work continues in the background.

**Architecture:** The popup opens `processor.html` with action/URL/options as query params. The processor tab runs the full article pipeline (fetch → extract → images → EPUB) and handles the result: redirect to `preview.html` for preview, show result page for send/download, show summary for batch operations. Tab stays open on completion.

**Tech Stack:** Chrome Extension MV3, vanilla JS, JSZip, Readability, OffscreenCanvas

---

### Task 1: Improve processor.html UI

**Files:**
- Modify: `extension/processor.html`
- Test: manual — open the page in a tab

- [ ] **Step 1: Replace processor.html with polished progress + result UI**

```html
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Web2Kindle</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; background: #f5f5f7; display: flex; justify-content: center; align-items: center; min-height: 100vh; }
  .card { background: #fff; border-radius: 12px; box-shadow: 0 2px 12px rgba(0,0,0,0.08); padding: 32px; max-width: 520px; width: 90%; text-align: center; }
  .spinner { width: 36px; height: 36px; border: 3px solid #e0e0e0; border-top-color: #2563eb; border-radius: 50%; animation: spin 0.8s linear infinite; margin: 0 auto 16px; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .status { color: #555; font-size: 15px; line-height: 1.5; margin-bottom: 8px; }
  .status-detail { color: #999; font-size: 13px; }
  .result { display: none; }
  .result.show { display: block; }
  .result .icon { font-size: 40px; margin-bottom: 12px; }
  .result h2 { font-size: 18px; margin-bottom: 8px; color: #222; }
  .result p { font-size: 14px; color: #555; line-height: 1.5; margin-bottom: 12px; }
  .result .error-detail { background: #fff5f5; border: 1px solid #fcc; border-radius: 6px; padding: 12px; font-size: 13px; color: #c00; text-align: left; white-space: pre-wrap; word-break: break-word; margin-bottom: 16px; max-height: 200px; overflow-y: auto; }
  .btn { display: inline-block; padding: 8px 20px; border-radius: 6px; border: none; font-size: 14px; cursor: pointer; background: #2563eb; color: #fff; margin: 4px; }
  .btn:hover { background: #1d4ed8; }
  .btn-secondary { background: #e5e5e5; color: #333; }
  .btn-secondary:hover { background: #d4d4d4; }
  .btn-open-preview { background: #059669; }
  .btn-open-preview:hover { background: #047857; }
</style>
</head>
<body>
<div class="card">
  <div id="progress">
    <div class="spinner"></div>
    <div class="status" id="progress-status">Processing…</div>
    <div class="status-detail" id="progress-detail"></div>
  </div>
  <div class="result" id="result-success">
    <div class="icon">✓</div>
    <h2 id="result-title"></h2>
    <p id="result-message"></p>
    <div>
      <button class="btn" onclick="window.close()">Close Tab</button>
    </div>
  </div>
  <div class="result" id="result-error">
    <div class="icon">✕</div>
    <h2>Something went wrong</h2>
    <p id="error-message"></p>
    <div class="error-detail" id="error-detail"></div>
    <div>
      <button class="btn btn-secondary" onclick="window.close()">Close Tab</button>
    </div>
  </div>
</div>
<script src="lib/readability.js"></script>
<script src="lib/jszip.min.js"></script>
<script src="article-extractor.js"></script>
<script src="conversion-counter.js"></script>
<script src="license.js"></script>
<script src="history-store.js"></script>
<script src="image-processor.js"></script>
<script src="epub-generator.js"></script>
<script src="processor.js"></script>
</body>
</html>
```

- [ ] **Step 2: Verify the page loads without errors**

Open `chrome-extension://<id>/processor.html` in a tab. Confirm no console errors.

---

### Task 2: Add progress/result helpers to processor.js

**Files:**
- Modify: `extension/processor.js`

- [ ] **Step 1: Replace the `log()` function with proper UI helpers**

```js
// Replace the top of processor.js
var _params = new URLSearchParams(location.search);
var ACTION = _params.get("action");
var MODE = _params.get("mode");
var TARGET_URL = _params.get("url") || "";
var SELECTION = _params.get("selection");
var PAGE_TITLE = _params.get("pageTitle") || "";
var TAB_INDEX = parseInt(_params.get("tabIndex") || "0", 10);
var OPENER_TAB_ID = parseInt(_params.get("openerTabId") || "0", 10);

// Add these helper functions after the variable declarations:
function setStatus(msg, detail) {
  var el = document.getElementById("progress-status");
  if (el) el.textContent = msg;
  var d = document.getElementById("progress-detail");
  if (d && detail) d.textContent = detail;
}

function showSuccess(title, message) {
  document.getElementById("progress").style.display = "none";
  var el = document.getElementById("result-success");
  el.classList.add("show");
  document.getElementById("result-title").textContent = title;
  document.getElementById("result-message").textContent = message;
}

function showError(message, detail) {
  document.getElementById("progress").style.display = "none";
  var el = document.getElementById("result-error");
  el.classList.add("show");
  document.getElementById("error-message").textContent = message;
  var d = document.getElementById("error-detail");
  if (d && detail) d.textContent = detail;
}

function esc(s) { return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
```

- [ ] **Step 2: Add `setStatus` calls throughout `processLink()`**

```js
async function processLink() {
  setStatus("Fetching page…");
  var fetchUrl = await resolveArchiveUrl(TARGET_URL);
  var content = await fetchViaBackground(fetchUrl);
  setStatus("Extracting article…");
  var article = extractArticle(content.text, TARGET_URL);
  if (!article) throw new Error("Could not extract article from this page.");
  return { article: article, html: content.text };
}
```

- [ ] **Step 3: Add `setStatus` to `buildEpub()`**

```js
async function buildEpub(article, html, url, keepImages, keepLinks, deliveryMode) {
  setStatus("Processing content…");
  var content = postProcess(article.content || "", html, url);
  article.content = content;
  article.readTime = Math.max(1, Math.round((article.textContent || "").trim().split(/\s+/).filter(function(w){ return w.length > 0; }).length / 200));
  var imageProcessor = keepImages ? {
    fetchImageAsBlob: fetchImageAsBlob,
    getImageInfo: getImageInfo,
    shouldSkipImage: shouldSkipImage,
    shouldRotateImage: shouldRotateImage,
    rotateImage: rotateImage,
    convertFormat: convertFormat,
    deliveryOptimize: deliveryOptimize,
  } : null;
  setStatus("Generating EPUB…");
  var epubBlob = await generateEpub({
    article: article,
    originalHtml: html,
    url: url,
    title: article.title,
    keepImages: keepImages,
    keepLinks: keepLinks,
    deliveryMode: deliveryMode,
    imageProcessor: imageProcessor,
  });
  return epubBlob;
}
```

---

### Task 3: Add download action to processor.js

**Files:**
- Modify: `extension/processor.js`

- [ ] **Step 1: Add `handleDownload` and `triggerDownload` functions**

```js
function triggerDownload(blob, filename) {
  var url = URL.createObjectURL(blob);
  var a = document.createElement("a");
  a.href = url;
  a.download = filename || "article.epub";
  a.click();
  URL.revokeObjectURL(url);
}

async function handleDownload(epubBlob, title) {
  triggerDownload(epubBlob, (title || "article") + ".epub");
  await incrementConversion();
  showSuccess("Downloaded", '"' + title + '" saved as EPUB');
}
```

- [ ] **Step 2: Add `action=download` branch to the `run()` function**

In the `run()` function, add this to the action branch:

```js
if (ACTION === "send") {
  log("Sending to Kindle…");
  await handleSend(epubBlob, title);
  log("Send complete");
} else if (ACTION === "preview") {
  log("Opening preview…");
  await handlePreview(epubBlob, result.article, result.html, title);
  return;
} else if (ACTION === "download") {
  log("Downloading EPUB…");
  await handleDownload(epubBlob, title);
  return;
}
```

---

### Task 4: Add batch actions to processor.js

**Files:**
- Modify: `extension/processor.js`

- [ ] **Step 1: Add `handleBatchSend` and `handleBatchDownload` functions**

```js
async function handleBatchSend(urls, keepImages, keepLinks) {
  var opts = { keepImages: keepImages, keepLinks: keepLinks, deliveryMode: true };
  var total = urls.length, done = 0, failed = 0;
  for (var i = 0; i < total; i++) {
    var url = urls[i];
    setStatus("Processing " + (i + 1) + "/" + total + "…", url);
    try {
      var html = (await fetchViaBackground(url)).text;
      var article = extractArticle(html, url);
      if (!article) throw new Error("Could not extract article");
      article.content = postProcess(article.content || "", html, url);
      article.readTime = Math.max(1, Math.round((article.textContent || "").trim().split(/\s+/).filter(function(w){ return w.length > 0; }).length / 200));
      var imageProcessor = keepImages ? {
        fetchImageAsBlob: fetchImageAsBlob, getImageInfo: getImageInfo,
        shouldSkipImage: shouldSkipImage, shouldRotateImage: shouldRotateImage,
        rotateImage: rotateImage, convertFormat: convertFormat, deliveryOptimize: deliveryOptimize,
      } : null;
      var epubBlob = await generateEpub({
        article: article, originalHtml: html, url: url, title: article.title,
        keepImages: keepImages, keepLinks: keepLinks, deliveryMode: true,
        imageProcessor: imageProcessor,
      });
      var sizeWarn = warnEpubSize(epubBlob);
      if (sizeWarn.oversize) throw new Error(sizeWarn.message);
      var base64 = await blobToBase64(epubBlob);
      var result = await sendEmailViaBackground(base64, article.title, url, (article.title || "article") + ".epub");
      await incrementConversion();
      recordSend(article.title, url, "sent");
      done++;
    } catch(e) {
      recordSend("", url, "failed", e.message);
      failed++;
    }
  }
  if (failed === 0) showSuccess("All sent!", done + " article" + (done > 1 ? "s" : "") + " sent to Kindle");
  else showSuccess(done + " sent, " + failed + " failed", "Check History for details");
}

async function handleBatchDownload(urls, keepImages, keepLinks) {
  var opts = { keepImages: keepImages, keepLinks: keepLinks };
  var total = urls.length, done = 0, failed = 0;
  for (var i = 0; i < total; i++) {
    var url = urls[i];
    setStatus("Processing " + (i + 1) + "/" + total + "…", url);
    try {
      var html = (await fetchViaBackground(url)).text;
      var article = extractArticle(html, url);
      if (!article) throw new Error("Could not extract article");
      article.content = postProcess(article.content || "", html, url);
      article.readTime = Math.max(1, Math.round((article.textContent || "").trim().split(/\s+/).filter(function(w){ return w.length > 0; }).length / 200));
      var imageProcessor = keepImages ? {
        fetchImageAsBlob: fetchImageAsBlob, getImageInfo: getImageInfo,
        shouldSkipImage: shouldSkipImage, shouldRotateImage: shouldRotateImage,
        rotateImage: rotateImage, convertFormat: convertFormat, deliveryOptimize: deliveryOptimize,
      } : null;
      var epubBlob = await generateEpub({
        article: article, originalHtml: html, url: url, title: article.title,
        keepImages: keepImages, keepLinks: keepLinks, deliveryMode: false,
        imageProcessor: imageProcessor,
      });
      triggerDownload(epubBlob, (article.title || "article-") + (i + 1) + ".epub");
      await incrementConversion();
      done++;
    } catch(e) {
      failed++;
    }
  }
  if (failed === 0) showSuccess("All downloaded!", done + " EPUB" + (done > 1 ? "s" : "") + " saved");
  else showSuccess(done + " downloaded, " + failed + " failed", "Some articles could not be processed");
}
```

- [ ] **Step 2: Add batch action branches to `run()`**

Add to the action branches:

```js
if (ACTION === "batch-send" || ACTION === "batch-download") {
  var batchData = await new Promise(function(resolve) {
    chrome.storage.local.get("batch_data", function(data) { resolve(data.batch_data || {}); });
  });
  chrome.storage.local.remove("batch_data");
  var urls = batchData.urls || [];
  var keepImages = batchData.keepImages !== false;
  var keepLinks = batchData.keepLinks !== false;
  if (urls.length === 0) throw new Error("No URLs to process");
  if (ACTION === "batch-send") {
    await handleBatchSend(urls, keepImages, keepLinks);
  } else {
    await handleBatchDownload(urls, keepImages, keepLinks);
  }
  return;
}
```

---

### Task 5: Modify processor.js for popup-initiated flow

**Files:**
- Modify: `extension/processor.js`

- [ ] **Step 1: Read `keepImages`, `keepLinks`, and `title` from URL params**

Add to the top of processor.js:

```js
// Params that apply to popup mode (mode=popup)
var POPUP_KEEP_IMAGES = _params.get("keepImages") !== "0"; // default true
var POPUP_KEEP_LINKS = _params.get("keepLinks") !== "0";   // default true
var POPUP_TITLE = _params.get("title") || "";
```

- [ ] **Step 2: Modify `run()` to read options from params in popup mode**

Replace the existing options-loading section in `run()`:

```js
async function run() {
  try {
    setStatus("Starting…");
    if (!(await checkConversionLimit())) {
      showError("Free limit reached", "You've used all " + FREE_LIMIT + " free conversions. Upgrade to Pro for unlimited.");
      return;
    }

    if (ACTION === "batch-send" || ACTION === "batch-download") {
      var batchData = await new Promise(function(resolve) {
        chrome.storage.local.get("batch_data", function(data) { resolve(data.batch_data || {}); });
      });
      chrome.storage.local.remove("batch_data");
      var urls = batchData.urls || [];
      var keepImages = batchData.keepImages !== false;
      var keepLinks = batchData.keepLinks !== false;
      if (urls.length === 0) throw new Error("No URLs to process");
      if (ACTION === "batch-send") {
        await handleBatchSend(urls, keepImages, keepLinks);
      } else {
        await handleBatchDownload(urls, keepImages, keepLinks);
      }
      return;
    }

    var keepImages, keepLinks;
    if (MODE === "popup") {
      keepImages = POPUP_KEEP_IMAGES;
      keepLinks = POPUP_KEEP_LINKS;
    } else {
      var stored = await chrome.storage.local.get({ keepImages: true, keepLinks: true });
      keepImages = stored.keepImages;
      keepLinks = stored.keepLinks;
    }

    var result;
    if (MODE === "link" || MODE === "popup") {
      result = await processLink();
    } else if (MODE === "selection") {
      result = createSelectionArticle();
    } else {
      throw new Error("Unknown mode: " + MODE);
    }

    var title = POPUP_TITLE || result.article.title || "Article";

    setStatus("Building EPUB…");
    var epubBlob = await buildEpub(result.article, result.html, TARGET_URL, keepImages, keepLinks, ACTION === "send" || ACTION === "batch-send");

    if (ACTION === "send") {
      await handleSend(epubBlob, title);
    } else if (ACTION === "preview") {
      await handlePreview(epubBlob, result.article, result.html, title);
    } else if (ACTION === "download") {
      await handleDownload(epubBlob, title);
    }
  } catch(err) {
    log("ERROR: " + err.message + "\n" + (err.stack || ""));
    showError(err.message, err.stack || "");
    recordSend("", TARGET_URL, "failed", err.message);
  }
}
```

- [ ] **Step 3: Modify `handleSend` to show result on page instead of notification**

```js
async function handleSend(epubBlob, title) {
  var sizeWarn = warnEpubSize(epubBlob);
  if (sizeWarn.oversize) {
    showError(sizeWarn.message);
    return;
  }
  setStatus("Sending to Kindle…");
  var base64 = await blobToBase64(epubBlob);
  var result = await sendEmailViaBackground(base64, title, TARGET_URL, (title || "article") + ".epub");
  await incrementConversion();
  recordSend(title, TARGET_URL, "sent");
  showSuccess("Sent to Kindle", formatSendSuccess(result));
}
```

- [ ] **Step 4: Remove the auto-close timeout at end of `run()`**

Delete the old `setTimeout(function() { chrome.runtime.sendMessage({ action: "processorDone" }); }, 2000);` at the end.

- [ ] **Step 5: Remove notification in error handler for popup mode**

Replace the error catch block — just show error on page instead of notification:

```js
} catch(err) {
  log("ERROR: " + err.message + "\n" + (err.stack || ""));
  showError(err.message, err.stack || "");
  recordSend("", TARGET_URL, "failed", err.message);
}
```

---

### Task 6: Modify popup.js to delegate to processing tab

**Files:**
- Modify: `extension/popup.js`
- Test: manual — click each button, verify processing tab opens and completes

- [ ] **Step 1: Add helper function to open processing tab**

```js
function openProcessingTab(action, url, titleOverride, tabIndex, tabId) {
  var params = new URLSearchParams();
  params.set("mode", "popup");
  params.set("action", action);
  params.set("url", url);
  params.set("keepImages", $("keep-images").checked ? "1" : "0");
  params.set("keepLinks", $("keep-links").checked ? "1" : "0");
  if (titleOverride) params.set("title", titleOverride);
  params.set("tabIndex", String(tabIndex || 0));
  params.set("openerTabId", String(tabId || ""));
  chrome.tabs.create({
    url: chrome.runtime.getURL("processor.html") + "?" + params.toString(),
    active: false,
    index: (tabIndex || 0) + 1,
  });
  showResult("Processing in new tab…");
  setTimeout(function(){ window.close(); }, 500);
}
```

- [ ] **Step 2: Replace `handleConvert` with tab-opener**

```js
async function handleConvert(url, tabId) {
  if (!(await checkConversionLimit())) return;
  var title = $("preview-title") ? $("preview-title").value.trim() : "";
  openProcessingTab("send", url, title || undefined, currentTab ? currentTab.index : 0, tabId);
}
```

- [ ] **Step 3: Replace `handlePreview` with tab-opener**

```js
async function handlePreview(url, tabId, tabIndex) {
  var title = $("preview-title") ? $("preview-title").value.trim() : "";
  openProcessingTab("preview", url, title || undefined, tabIndex, tabId);
}
```

- [ ] **Step 4: Replace `handleDownload` with tab-opener**

```js
async function handleDownload(url, tabId) {
  if (!(await checkConversionLimit())) return;
  openProcessingTab("download", url, undefined, currentTab ? currentTab.index : 0, tabId);
}
```

- [ ] **Step 5: Replace `handlePasteConvert` with tab-opener (for URL type)**

In `handlePasteConvert`, replace the URL processing block:

```js
if (isUrl) {
  openProcessingTab("send", pastedContent, $("paste-title").value.trim() || undefined, 0);
  return;
}
```

- [ ] **Step 6: Replace `handlePasteDownload` with tab-opener (for URL type)**

In `handlePasteDownload`, replace the URL processing block:

```js
if (isUrl) {
  openProcessingTab("download", pastedContent, $("paste-title").value.trim() || undefined, 0);
  return;
}
```

- [ ] **Step 7: Replace `handleBatchSend` with storage + tab-opener**

```js
async function handleBatchSend() {
  if (!(await checkConversionLimit())) return;
  var urls = getBatchUrls();
  if (urls.length === 0) { showError("No URLs to process"); return; }
  await new Promise(function(resolve) {
    chrome.storage.local.set({
      batch_data: {
        urls: urls,
        keepImages: $("keep-images").checked,
        keepLinks: $("keep-links").checked,
      }
    }, resolve);
  });
  var params = new URLSearchParams();
  params.set("mode", "popup");
  params.set("action", "batch-send");
  chrome.tabs.create({
    url: chrome.runtime.getURL("processor.html") + "?" + params.toString(),
    active: false,
    index: (currentTab ? currentTab.index : 0) + 1,
  });
  showResult("Processing " + urls.length + " URLs in new tab…");
  setTimeout(function(){ window.close(); }, 500);
}
```

- [ ] **Step 8: Replace `handleBatchDownload` with storage + tab-opener**

```js
async function handleBatchDownload() {
  if (!(await checkConversionLimit())) return;
  var urls = getBatchUrls();
  if (urls.length === 0) { showError("No URLs to process"); return; }
  await new Promise(function(resolve) {
    chrome.storage.local.set({
      batch_data: {
        urls: urls,
        keepImages: $("keep-images").checked,
        keepLinks: $("keep-links").checked,
      }
    }, resolve);
  });
  var params = new URLSearchParams();
  params.set("mode", "popup");
  params.set("action", "batch-download");
  chrome.tabs.create({
    url: chrome.runtime.getURL("processor.html") + "?" + params.toString(),
    active: false,
    index: (currentTab ? currentTab.index : 0) + 1,
  });
  showResult("Processing " + urls.length + " URLs in new tab…");
  setTimeout(function(){ window.close(); }, 500);
}
```

- [ ] **Step 9: Replace `handleBatchRetry` with storage + tab-opener**

```js
async function handleBatchRetry(failedItems, mode) {
  if (!failedItems || failedItems.length === 0) return;
  var urls = failedItems.map(function(item){ return item.url; });
  await new Promise(function(resolve) {
    chrome.storage.local.set({
      batch_data: {
        urls: urls,
        keepImages: $("keep-images").checked,
        keepLinks: $("keep-links").checked,
      }
    }, resolve);
  });
  var params = new URLSearchParams();
  params.set("mode", "popup");
  params.set("action", mode === "download" ? "batch-download" : "batch-send");
  chrome.tabs.create({
    url: chrome.runtime.getURL("processor.html") + "?" + params.toString(),
    active: false,
  });
  showResult("Retrying " + urls.length + " URL" + (urls.length > 1 ? "s" : "") + " in new tab…");
  setTimeout(function(){ window.close(); }, 500);
}
```

---

### Task 7: Modify popup.html — replace progress bar with info banner

**Files:**
- Modify: `extension/popup.html`

- [ ] **Step 1: Replace the progress bar section**

Find and replace the `progress` section in popup.html:

```html
<div id="progress" class="hidden" style="margin:12px 0">
  <div style="padding:12px;background:#f0f7ff;border-radius:8px;text-align:center;color:#2563eb;font-size:13px">
    Processing in new tab…
  </div>
</div>
```

---

### Task 8: Verify everything works end-to-end

- [ ] **Step 1: Load extension in Chrome**

Open `chrome://extensions`, enable Developer mode, click "Load unpacked" and select the `extension/` folder. Verify no errors on the extension card.

- [ ] **Step 2: Test Preview flow**

Visit any article page, click extension icon, click "Open Preview". Verify a processing tab opens, shows status messages, then redirects to `preview.html`.

- [ ] **Step 3: Test Send flow**

Click "Send to Kindle". Verify processing tab opens, shows status, shows success message when done. Verify EPUB arrives at Kindle.

- [ ] **Step 4: Test Download flow**

Click "Save EPUB". Verify processing tab opens, shows status, triggers file download, shows success message.

- [ ] **Step 5: Test Batch flow**

Toggle paste mode, paste 3+ URLs, click "Send to Kindle" or "Save EPUB". Verify processing tab handles all URLs and shows summary.

- [ ] **Step 6: Test that popup can be closed immediately**

After clicking any button, close the popup. Verify processing tab continues and completes successfully.

- [ ] **Step 7: Test paste text (non-URL) still works**

Toggle paste mode, paste some plain text, click "Send to Kindle". Verify it processes inline in popup (no tab opened).

---

### Task 9: Commit

- [ ] **Step 1: Stage and commit**

```bash
git add extension/popup.js extension/popup.html extension/processor.js extension/processor.html
git commit -m "feat: move article processing from popup to dedicated tab

Popup actions (Preview/Send/Download/Batch) now delegate all heavy
processing to a processor tab that survives popup closure.

- New processor.html UI with spinner, status messages, result cards
- processor.js: added download, batch-send, batch-download actions
- processor.js: mode=popup support with keepImages/keepLinks from URL
- popup.js: button handlers open processing tab instead of inline work
- popup.html: simplified progress display"
```
