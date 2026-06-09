# Batch URL Queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow pasting multiple URLs into the popup, auto-detect batch mode, process sequentially via existing server endpoints.

**Architecture:** No server changes. The existing paste textarea detects 2+ URLs → shows a queue list → "Send All" / "Download All" iterate the queue sequentially. Each URL gets one API call to existing `/article/send-to-kindle` or `/convert`. Counter increments per-URL.

**Tech Stack:** Vanilla JS, Chrome Extension MV3, no deps.

---

### Task 1: Add batch queue HTML to popup.html

**Files:**
- Modify: `extension/popup.html`

- [ ] **Step 1: Add batch queue container after `#paste-title`**

Insert this block right after the `#paste-title` closing `</div>` (line 38):

```html
    <!-- Batch queue -->
    <div id="batch-queue" class="batch-queue hidden">
      <div id="batch-list" class="batch-list"></div>
    </div>
```

The `#paste-title` input should be hidden in batch mode (handled in JS), and shown for single-URL/text mode.

- [ ] **Step 2: Verify the HTML file is well-formed**

Run: `node -e "require('fs').readFileSync('extension/popup.html','utf8').includes('batch-queue') && console.log('OK')"`
Expected: `OK`

---

### Task 2: Add batch queue CSS to popup.css

**Files:**
- Modify: `extension/popup.css`

- [ ] **Step 1: Add batch queue styles at end of file**

Append these styles:

```css
/* ── Batch queue ── */
.batch-queue {
  margin: 6px 0 8px;
  max-height: 132px;
  overflow-y: auto;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  background: #f8fafc;
}
.batch-list {
  display: flex;
  flex-direction: column;
}
.batch-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 8px;
  font-size: 11px;
  border-bottom: 1px solid #e2e8f0;
  min-height: 22px;
}
.batch-item:last-child {
  border-bottom: none;
}
.batch-dot {
  width: 7px; height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
  background: #d1d5db;
}
.batch-dot.processing {
  background: #2563eb;
  animation: pulse 1s ease-in-out infinite;
}
.batch-dot.done {
  background: #22c55e;
}
.batch-dot.failed {
  background: #ef4444;
}
.batch-url {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: #475569;
  flex: 1;
  min-width: 0;
}
.badge.batch {
  background: #dbeafe;
  color: #1d4ed8;
}
```

- [ ] **Step 2: Verify the file parses cleanly**

---

### Task 3: Add batch detection + state management to popup.js

**Files:**
- Modify: `extension/popup.js`

- [ ] **Step 1: Add batch state variables and helper function after the `pasteMode` variable (line 7)**

```javascript
let batchUrls = [];
```

- [ ] **Step 2: Add `getBatchUrls()` helper after `isArticleUrl()` (after line 38)**

```javascript
function getBatchUrls() {
  const val = $("paste-input").value.trim();
  if (!val) return [];
  const lines = val.split("\n").map(l => l.trim()).filter(l => l.length > 0);
  return lines.filter(l => /^https?:\/\//i.test(l) && !isPdfUrl(l) && !isLocalFileUrl(l));
}
```

- [ ] **Step 3: Replace `updatePasteBadge()` to handle batch detection**

Old:
```javascript
function updatePasteBadge() {
  const val = $("paste-input").value.trim();
  const badge = $("paste-badge");
  if (!val) {
    badge.textContent = "";
    badge.className = "badge";
    return;
  }
  const isUrl = /^https?:\/\//i.test(val) || /^file:\/\//i.test(val);
  badge.textContent = isUrl ? "URL" : "TEXT";
  badge.className = "badge " + (isUrl ? "url" : "text");
}
```

New:
```javascript
function updatePasteBadge() {
  const val = $("paste-input").value.trim();
  const badge = $("paste-badge");
  if (!val) {
    badge.textContent = "";
    badge.className = "badge";
    hide("batch-queue");
    show("paste-title");
    return;
  }

  const detected = getBatchUrls();

  if (detected.length >= 2) {
    badge.textContent = `BATCH ${detected.length}`;
    badge.className = "badge batch";
    batchUrls = detected;
    renderBatchQueue(detected.map(url => ({ url, status: "pending", error: "" })));
    show("batch-queue");
    hide("paste-title");
    return;
  }

  hide("batch-queue");
  show("paste-title");
  const isUrl = /^https?:\/\//i.test(val) || /^file:\/\//i.test(val);
  badge.textContent = isUrl ? "URL" : "TEXT";
  badge.className = "badge " + (isUrl ? "url" : "text");
}
```

- [ ] **Step 4: Add `renderBatchQueue()` and `updateBatchItem()` after `updatePasteBadge()`**

```javascript
function renderBatchQueue(queue) {
  const list = $("batch-list");
  list.innerHTML = "";
  queue.forEach((item, i) => {
    const row = document.createElement("div");
    row.className = "batch-item";
    row.id = `batch-item-${i}`;
    const dot = document.createElement("span");
    dot.className = "batch-dot " + item.status;
    const urlEl = document.createElement("span");
    urlEl.className = "batch-url";
    urlEl.textContent = item.url;
    row.appendChild(dot);
    row.appendChild(urlEl);
    list.appendChild(row);
  });
}

function updateBatchItem(i, status) {
  const row = $(`batch-item-${i}`);
  if (!row) return;
  const dot = row.querySelector(".batch-dot");
  if (dot) dot.className = "batch-dot " + status;
}
```

- [ ] **Step 5: Update the paste toggle to clear batch state**

In `togglePasteMode()`, around line 150, add batchUrls = [] after `pasteMode = !pasteMode;`:

```javascript
function togglePasteMode() {
  pasteMode = !pasteMode;
  batchUrls = [];
  clearMessages();
  ...
```

- [ ] **Step 6: Update click handlers to route batch vs single**

Replace the click handler section (around line 665-676):

Old:
```javascript
  $("btn-kindle").onclick = () => {
    if (pasteMode) handlePasteConvert(ARTICLE_SEND_ENDPOINT, currentTab?.index);
    else handleConvert(url, tabId);
  };
  $("btn-preview").onclick = () => {
    if (pasteMode) handlePasteConvert(ARTICLE_PREVIEW_ENDPOINT, currentTab?.index);
    else handlePreview(url, tabId, tab.index);
  };
  $("btn-download").onclick = () => {
    if (pasteMode) handlePasteDownload();
    else handleDownload(url, tabId);
  };
```

New:
```javascript
  $("btn-kindle").onclick = () => {
    if (pasteMode && batchUrls.length >= 2) handleBatchSend();
    else if (pasteMode) handlePasteConvert(ARTICLE_SEND_ENDPOINT, currentTab?.index);
    else handleConvert(url, tabId);
  };
  $("btn-preview").onclick = () => {
    if (pasteMode) handlePasteConvert(ARTICLE_PREVIEW_ENDPOINT, currentTab?.index);
    else handlePreview(url, tabId, tab.index);
  };
  $("btn-download").onclick = () => {
    if (pasteMode && batchUrls.length >= 2) handleBatchDownload();
    else if (pasteMode) handlePasteDownload();
    else handleDownload(url, tabId);
  };
```

Note: Preview button doesn't get batch mode — batch preview doesn't make sense. Preview stays as-is (single item only).

---

### Task 4: Add batch processing functions to popup.js

**Files:**
- Modify: `extension/popup.js`

- [ ] **Step 1: Add `handleBatchSend()` after `handlePasteDownload()` (around line 604)**

```javascript
async function handleBatchSend() {
  if (!(await checkConversionLimit())) return;
  clearMessages();
  hide("actions");
  hide("options");
  show("progress");

  const queue = batchUrls.map(url => ({ url, status: "pending", error: "" }));
  renderBatchQueue(queue);
  show("batch-queue");
  const total = queue.length;
  let done = 0, failed = 0;

  for (let i = 0; i < total; i++) {
    const item = queue[i];
    if (!(await checkConversionLimit())) {
      item.status = "failed";
      item.error = "Free conversion limit reached";
      updateBatchItem(i, "failed");
      failed++;
      continue;
    }

    item.status = "processing";
    updateBatchItem(i, "processing");
    setProgress(`Converting ${i + 1}/${total}…`, Math.round(((i) / total) * 100));

    try {
      const resp = await fetch(`${SERVER}${ARTICLE_SEND_ENDPOINT}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: item.url, ...getOptions() }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || `Failed (${resp.status})`);
      }
      const result = await resp.json();
      item.status = "done";
      updateBatchItem(i, "done");
      done++;
      await incrementConversion();
      recordSend("", item.url, "sent");
    } catch (err) {
      item.status = "failed";
      item.error = err.message;
      updateBatchItem(i, "failed");
      failed++;
      recordSend("", item.url, "failed", err.message);
    }
  }

  setProgress("Done!", 100);
  if (failed === 0) {
    showResult(`✓ ${done} URL${done > 1 ? "s" : ""} sent to Kindle`);
  } else {
    showResult(`✓ ${done} sent, ${failed} failed`);
    show("btn-retry");
    $("btn-retry").onclick = () => handleBatchRetry(queue.filter(i => i.status === "failed"));
  }
  show("actions");
  show("options");
}
```

- [ ] **Step 2: Add `handleBatchDownload()` after `handleBatchSend()`**

```javascript
async function handleBatchDownload() {
  if (!(await checkConversionLimit())) return;
  clearMessages();
  hide("actions");
  hide("options");
  show("progress");

  const queue = batchUrls.map(url => ({ url, status: "pending", error: "" }));
  renderBatchQueue(queue);
  show("batch-queue");
  const total = queue.length;
  let done = 0, failed = 0;

  for (let i = 0; i < total; i++) {
    const item = queue[i];
    if (!(await checkConversionLimit())) {
      item.status = "failed";
      item.error = "Free conversion limit reached";
      updateBatchItem(i, "failed");
      failed++;
      continue;
    }

    item.status = "processing";
    updateBatchItem(i, "processing");
    setProgress(`Converting ${i + 1}/${total}…`, Math.round(((i) / total) * 100));

    try {
      const resp = await fetch(`${SERVER}/convert`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: item.url, ...getOptions() }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || `Failed (${resp.status})`);
      }
      triggerDownload(resp, `article-${i + 1}.epub`);
      item.status = "done";
      updateBatchItem(i, "done");
      done++;
      await incrementConversion();
    } catch (err) {
      item.status = "failed";
      item.error = err.message;
      updateBatchItem(i, "failed");
      failed++;
    }
  }

  setProgress("Done!", 100);
  if (failed === 0) {
    showResult(`✓ ${done} EPUB${done > 1 ? "s" : ""} downloaded`);
  } else {
    showResult(`✓ ${done} downloaded, ${failed} failed`);
    show("btn-retry");
    $("btn-retry").onclick = () => handleBatchRetry(queue.filter(i => i.status === "failed"), "download");
  }
  show("actions");
  show("options");
}
```

- [ ] **Step 3: Add `handleBatchRetry()` after `handleBatchDownload()`**

```javascript
async function handleBatchRetry(failedItems, mode = "send") {
  if (!failedItems || failedItems.length === 0) return;
  clearMessages();
  hide("actions");
  hide("options");
  hide("btn-retry");
  show("progress");

  const total = failedItems.length;
  let done = 0, failed = 0;

  for (let i = 0; i < total; i++) {
    const item = failedItems[i];
    if (!(await checkConversionLimit())) {
      item.status = "failed";
      failed++;
      continue;
    }

    item.status = "processing";
    setProgress(`Retrying ${i + 1}/${total}…`, Math.round(((i) / total) * 100));

    try {
      const endpoint = mode === "download" ? "/convert" : ARTICLE_SEND_ENDPOINT;
      const resp = await fetch(`${SERVER}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: item.url, ...getOptions() }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || `Failed (${resp.status})`);
      }
      if (mode === "download") {
        triggerDownload(resp, `article-${Date.now()}.epub`);
      }
      item.status = "done";
      done++;
      await incrementConversion();
    } catch (err) {
      item.status = "failed";
      item.error = err.message;
      failed++;
    }
  }

  setProgress("Done!", 100);
  if (failed === 0) {
    showResult(`✓ ${done} URL${done > 1 ? "s" : ""} ${mode === "download" ? "downloaded" : "sent"}`);
  } else {
    showResult(`✓ ${done} ${mode === "download" ? "downloaded" : "sent"}, ${failed} still failed`);
    show("btn-retry");
    $("btn-retry").onclick = () => handleBatchRetry(failedItems.filter(i => i.status === "failed"), mode);
  }
  show("actions");
  show("options");
}
```

- [ ] **Step 4: Verify all references are consistent**

Check that `handleBatchSend`, `handleBatchDownload`, `handleBatchRetry` are called and defined in the right order (definitions before usages).

---

### Task 5: Write tests

**Files:**
- Modify: `tests/popup.test.js`

- [ ] **Step 1: Add batch detection tests after the "Article gating" section (after line 574)**

Add helpers and tests:

```javascript
// ── Batch detection helpers ──
let batchModeActive = false;
let batchQueueState = [];

function setPasteInput(value) {
  globalThis._pasteInput = value;
}

function getBatchUrls() {
  const val = (globalThis._pasteInput || "").trim();
  if (!val) return [];
  const lines = val.split("\n").map(l => l.trim()).filter(l => l.length > 0);
  return lines.filter(l => /^https?:\/\//i.test(l) && !isPdfUrl(l) && !isLocalFileUrl(l));
}

async function testBatchDetection() {
  console.log("\n── Batch URL detection ──");

  setPasteInput("");
  assertEqual(getBatchUrls().length, 0, "empty input yields 0 URLs");

  setPasteInput("https://example.com/article1");
  assertEqual(getBatchUrls().length, 1, "single URL yields 1");

  setPasteInput("https://example.com/article1\nhttps://example.com/article2");
  assertEqual(getBatchUrls().length, 2, "two URLs yields 2");

  setPasteInput("https://example.com/a\nhttps://example.com/b\nhttps://example.com/c");
  assertEqual(getBatchUrls().length, 3, "three URLs yields 3");

  setPasteInput("https://example.com/a\n\nhttps://example.com/b");
  assertEqual(getBatchUrls().length, 2, "blank lines are ignored");

  setPasteInput("some random text\nhttps://example.com/a");
  assertEqual(getBatchUrls().length, 1, "non-URL lines are filtered out");

  setPasteInput("https://example.com/paper.pdf\nhttps://example.com/a");
  assertEqual(getBatchUrls().length, 1, "PDF URLs are excluded");

  setPasteInput("file:///Users/test/doc.pdf\nhttps://example.com/a");
  assertEqual(getBatchUrls().length, 1, "local file URLs are excluded");

  setPasteInput("https://example.com/paper.pdf");
  assertEqual(getBatchUrls().length, 0, "single PDF is excluded (not batch)");

  console.log("  batch detection works correctly");
}
```

- [ ] **Step 2: Add batch processing tests**

```javascript
async function testBatchProcessing() {
  console.log("\n── Batch sequential processing ──");

  // Mock storage for conversion counter
  let storageData = {};
  globalThis.chrome = {
    storage: {
      local: {
        get(keys, cb) {
          const keysArr = Array.isArray(keys) ? keys : [keys];
          const result = {};
          for (const k of keysArr) result[k] = storageData[k];
          if (cb) return cb(result);
          return Promise.resolve(result);
        },
        set(items, cb) {
          Object.assign(storageData, items);
          if (cb) cb();
          return Promise.resolve();
        },
      },
      sync: {
        get(defaults, cb) {
          const result = { ...defaults };
          if (cb) return cb(result);
          return Promise.resolve(result);
        },
        set() { return Promise.resolve(); },
      },
    },
    runtime: { sendMessage() {} },
    scripting: { executeScript() {} },
    tabs: { create() {} },
  };

  const fs4 = require("node:fs");
  const counterCode = fs4.readFileSync(
    path.join(__dirname, "..", "extension", "conversion-counter.js"), "utf8"
  );
  const evalCode = counterCode.replace(/^export\s+\{.*\};\s*$/m, '');
  eval(evalCode);

  // Simulate: 3 URLs, 2 succeed 1 fails
  let fetchCalls = [];
  let callIdx = 0;
  const responses = [
    makeJsonResponse(200, { kindle_email: "kindle@example.com" }),
    makeJsonResponse(200, { kindle_email: "kindle@example.com" }),
    makeJsonResponse(400, { error: "Article not found" }),
  ];

  globalThis.fetch = async (url, opts = {}) => {
    fetchCalls.push({ url, opts });
    return responses[callIdx++];
  };

  globalThis._pasteInput = "https://example.com/a\nhttps://example.com/b\nhttps://example.com/c";
  const urls = getBatchUrls();
  assertEqual(urls.length, 3, "parsed 3 batch URLs");

  // Run sequential send
  let done = 0, failed = 0;
  for (const item of urls) {
    try {
      const resp = await fetch("http://127.0.0.1:5001/article/send-to-kindle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: item, keepImages: true, keepLinks: true }),
      });
      if (!resp.ok) throw new Error("Failed");
      done++;
    } catch {
      failed++;
    }
  }

  assertEqual(done, 2, "2 URLs succeed");
  assertEqual(failed, 1, "1 URL fails");
  assertEqual(fetchCalls.length, 3, "3 API calls made");
  assertEqual(
    JSON.parse(fetchCalls[0].opts.body).url,
    "https://example.com/a",
    "first call sends first URL"
  );
  assertEqual(
    JSON.parse(fetchCalls[1].opts.body).url,
    "https://example.com/b",
    "second call sends second URL"
  );
  assertEqual(
    JSON.parse(fetchCalls[2].opts.body).url,
    "https://example.com/c",
    "third call sends third URL"
  );
}
```

- [ ] **Step 3: Wire batch tests into `runTests()`**

Add to the test runner (after `await testLicenseSystem();`, before the results print):

```javascript
  await testBatchDetection();
  await testBatchProcessing();
```

---

### Task 6: Run tests and verify

- [ ] **Step 1: Run the popup tests**

```bash
node tests/popup.test.js
```

Expected: all existing tests pass + new batch tests pass.

- [ ] **Step 2: Verify conversion counter respects limits in batch**

Check that if conversion count is near limit, batch processing stops per-item correctly.

---

### Task 7: Update ROADMAP.md

**Files:**
- Modify: `ROADMAP.md`

- [ ] **Step 1: Move batch URL queue from Ready now to Done**

```markdown
| **Batch URL queue** — paste multiple URLs, process sequentially, individual EPUBs | Extension UX | 2026-05-14 |
```
