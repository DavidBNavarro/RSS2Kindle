# Wire Extension to smtp_relay.py Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) for syntax tracking.

**Goal:** Switch extension from sending via `server.py` multipart `/send-epub` to `smtp_relay.py` JSON `/send`. Remove server.py dependency.

**Architecture:** Extension converts EPUB Blob to base64 client-side, POSTs JSON to smtp_relay.py port 5002. Health check uses relay. History in chrome.storage. Resend button removed. Server.py becomes fully optional.

**Tech Stack:** Chrome Extension (MV3), vanilla JS, Python/Flask

---

### Task 1: popup.js — add relay URL, base64 conversion, switch to smtp_relay.py

**Files:**
- Modify: `extension/popup.js`

- [ ] **Step 1: Add relay URL constant and variable, add `loadRelayUrl()`**

Add near the top of popup.js (after `SEND_EPUB_ENDPOINT` line 2):
```javascript
var DEFAULT_RELAY = "http://127.0.0.1:5002";
var SEND_RELAY_ENDPOINT = "/send";
```
Add after `loadServerUrl()` (around line 76):
```javascript
var RELAY_URL = DEFAULT_RELAY;

async function loadRelayUrl() {
  var stored = await chrome.storage.sync.get({ relayUrl: DEFAULT_RELAY });
  RELAY_URL = stored.relayUrl;
}
```

- [ ] **Step 2: Add `blobToBase64()` helper**

Add after `appendSmtpToForm()` (around line 331):
```javascript
function blobToBase64(blob) {
  return new Promise(function(resolve, reject) {
    var reader = new FileReader();
    reader.onloadend = function() { resolve(reader.result.split(",")[1]); };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
```

- [ ] **Step 3: Add relay URL loading to `initPopup()`**

In `initPopup()`, after `await loadServerUrl();` (line 648), add:
```javascript
  await loadRelayUrl();
```

- [ ] **Step 4: Modify `handleConvert()` to POST JSON to relay**

Replace lines 340-345 (from `setProgress("Sending to Kindle…", 85)` through `formData.append`) with:
```javascript
    setProgress("Sending to Kindle…", 85);
    var smtp = await chrome.storage.sync.get({
      kindle_email: "", smtp_host: "", smtp_port: "", smtp_user: "", smtp_password: "",
    });
    var epubBase64 = await blobToBase64(result.epubBlob);
    var resp = await fetch(RELAY_URL + SEND_RELAY_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      var payload = { epub: epubBase64, title: result.title, url: url };
      Object.assign(payload, smtp);
      var resp = await fetch(RELAY_URL + SEND_RELAY_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    });
```

- [ ] **Step 5: Modify `handlePasteConvert()` similarly**

Replace the send section (from `setProgress("Sending to Kindle…", 85)` through the `formData.append` block) with the same pattern:
```javascript
    setProgress("Sending to Kindle…", 85);
    var smtp = await chrome.storage.sync.get({
      kindle_email: "", smtp_host: "", smtp_port: "", smtp_user: "", smtp_password: "",
    });
    var epubBase64 = await blobToBase64(result.epubBlob);
    var body = { epub: epubBase64, title: result.title };
    Object.assign(body, smtp);
    if (isUrl) body.url = pastedContent;
    var resp = await fetch(RELAY_URL + SEND_RELAY_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
```

- [ ] **Step 6: Modify `handleBatchSend()` similarly**

Replace the FormData block (lines 552-556) with:
```javascript
      var smtp = await chrome.storage.sync.get({
        kindle_email: "", smtp_host: "", smtp_port: "", smtp_user: "", smtp_password: "",
      });
      var epubBase64 = await blobToBase64(result.epubBlob);
      var payload = { epub: epubBase64, title: result.title, url: item.url };
      Object.assign(payload, smtp);
      var resp = await fetch(RELAY_URL + SEND_RELAY_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
```

- [ ] **Step 7: Modify `handleBatchRetry()` similarly**

Replace the FormData block (lines 614-617) with:
```javascript
        var smtp = await chrome.storage.sync.get({
          kindle_email: "", smtp_host: "", smtp_port: "", smtp_user: "", smtp_password: "",
        });
        var epubBase64 = await blobToBase64(result.epubBlob);
        var payload = { epub: epubBase64, url: item.url };
        Object.assign(payload, smtp);
        var resp = await fetch(RELAY_URL + SEND_RELAY_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
```

- [ ] **Step 8: Modify `checkServer()` to use relay URL**

Change line 591 from:
```javascript
      var r = await fetch(SERVER + "/health", { signal: AbortSignal.timeout(3000) });
```
to:
```javascript
      var r = await fetch(RELAY_URL + "/health", { signal: AbortSignal.timeout(3000) });
```

- [ ] **Step 9: Commit**

```bash
git add extension/popup.js
git commit -m "feat: send EPUBs to smtp_relay.py via base64 JSON POST instead of server.py multipart"
```

---

### Task 2: options.js + options.html — add relay URL field

**Files:**
- Modify: `extension/options.js`
- Modify: `extension/options.html`

- [ ] **Step 1: Add relay URL field to options.html**

Add after the server URL section (after line 18 `</div>`):
```html
    <label for="relay-url">SMTP relay URL</label>
    <input type="url" id="relay-url" value="http://127.0.0.1:5002">
    <p class="help">Default: http://127.0.0.1:5002 (local smtp_relay.py). Change for cloud-hosted relay.</p>
```

- [ ] **Step 2: Add relay URL load in options.js**

In the DOMContentLoaded handler, after loading `stored.serverUrl` (line 23-24), add:
```javascript
  document.getElementById("relay-url").value = stored.relayUrl || DEFAULT_RELAY;
```

And in the `chrome.storage.sync.get` defaults at line 19-22, add `relayUrl: DEFAULT_RELAY`.

- [ ] **Step 3: Add relay URL save in options.js submit handler**

Add after the serverUrl save (around line 101):
```javascript
  const relayUrl = document.getElementById("relay-url").value.replace(/\/+$/, "") || DEFAULT_RELAY;
```

And add `relayUrl` to the `chrome.storage.sync.set` object.

- [ ] **Step 4: Add `DEFAULT_RELAY` constant to options.js**

Add near line 1:
```javascript
const DEFAULT_RELAY = "http://127.0.0.1:5002";
```

- [ ] **Step 5: Commit**

```bash
git add extension/options.js extension/options.html
git commit -m "feat: add SMTP relay URL setting to options page"
```

---

### Task 3: history.js — remove resend button + function

**Files:**
- Modify: `extension/history.js`

- [ ] **Step 1: Remove dead code**

Remove lines 1-2:
```javascript
const RESEND_ENDPOINT = "/article/send-to-kindle";
```
Remove `formatResendSuccess()` function (lines 19-22).

- [ ] **Step 2: Remove resend button from template**

In `renderList()`, remove the resend button line:
```javascript
        <button class="btn-resend" title="${failed ? "Retry sending to Kindle" : "Send to Kindle again"}">${failed ? "↺ Retry" : "✉ Resend"}</button>
```
And the corresponding event listener:
```javascript
    li.querySelector(".btn-resend").addEventListener("click", () => resend(item));
```

- [ ] **Step 3: Remove `resend()` function**

Remove the entire `resend()` function (lines 89-113).

- [ ] **Step 4: Commit**

```bash
git add extension/history.js
git commit -m "chore: remove dead resend button from history (endpoint no longer exists)"
```

---

### Task 4: Update tests

**Files:**
- Modify: `tests/popup.test.js`

- [ ] **Step 1: Add relay URL and blobToBase64 to test file**

Add near the top of the test's source definitions:
```javascript
const DEFAULT_RELAY = "http://127.0.0.1:5002";
const SEND_RELAY_ENDPOINT = "/send";
```
Add after mock helpers:
```javascript
async function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
```

- [ ] **Step 2: Add relay assertion test**

Add after the SMTP inline config tests (after the last SMTP assertion):
```javascript
console.log("\n── Relay endpoint ──");
assertEqual(DEFAULT_RELAY, "http://127.0.0.1:5002", "relay defaults to port 5002");
assertEqual(SEND_RELAY_ENDPOINT, "/send", "relay uses /send endpoint");
```

- [ ] **Step 3: Run tests**

```bash
node tests/popup.test.js
```
Expected: all pass.

- [ ] **Step 4: Run Python tests**

```bash
python -m pytest tests/ -v
```
Expected: all pass (no server-side changes).

- [ ] **Step 5: Commit**

```bash
git add tests/popup.test.js
git commit -m "test: add relay endpoint assertions to popup tests"
```

---

### Task 5: Final verification

- [ ] **Step 1: Run all tests**

```bash
node tests/popup.test.js && python -m pytest tests/ -v
```

- [ ] **Step 2: Commit remaining docs**

```bash
git add docs/superpowers/specs/2026-05-16-wire-smtp-relay.md docs/superpowers/plans/2026-05-16-wire-smtp-relay.md
git commit -m "docs: add wire-smtp-relay design doc and implementation plan"
```
