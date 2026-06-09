# Paywall Bypass Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) for syntax tracking.

**Goal:** Rewrite archive URL before fetch for paywalled articles, using config-driven host list and multi-domain archive fallback.

**Architecture:** In `processArticle()`, call new `resolveArchiveUrl(url)` before `fetchViaBackground()`. It reads `paywalledHosts`/`archiveDomains` from `chrome.storage.sync`, checks if host is paywalled, and rewrites to archive.is or archive.org. All downstream pipeline unchanged.

**Tech Stack:** Chrome Extension (MV3), vanilla JS

---

### Task 1: Delete dead contentScript.js

**Files:**
- Delete: `extension/contentScript.js`

- [ ] **Step 1: Delete file**

```bash
rm extension/contentScript.js
```

- [ ] **Step 2: Verify deletion + commit**

Run: `ls extension/contentScript.js`
Expected: `ls: extension/contentScript.js: No such file or directory`

```bash
git rm extension/contentScript.js
git commit -m "chore: remove unused contentScript.js (paywall overlay, never wired to manifest)"
```

---

### Task 2: Add `resolveArchiveUrl()` to popup.js, wire into `processArticle()`

**Files:**
- Modify: `extension/popup.js`

**Remove from popup.js:**
- Lines 107-119: `ARCHIVE_PREFERRED_HOSTS` , `shouldUseArchive()` , `archiveUrlFor()`

**Add before `processArticle()` (before line 14):**

```javascript
async function resolveArchiveUrl(url) {
  var config = await chrome.storage.sync.get({
    paywalledHosts: "theverge.com,wired.com,medium.com",
    archiveDomains: "https://archive.org,https://archive.ph,https://archive.is",
    archiveTimeoutMs: 15000,
    archiveRetries: 2,
  });

  if (!config.paywalledHosts || !config.archiveDomains) return url;

  var hostname = new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
  var hosts = config.paywalledHosts.split(",").map(function(h) { return h.trim().toLowerCase(); }).filter(Boolean);

  var isPaywalled = hosts.some(function(h) { return hostname === h || hostname.endsWith("." + h); });
  if (!isPaywalled) return url;

  var domains = config.archiveDomains.split(",").map(function(d) { return d.trim(); }).filter(Boolean);
  for (var i = 0; i < domains.length; i++) {
    var domain = domains[i].replace(/\/+$/, "");
    if (domain.includes("archive.org")) {
      var snap = await findWaybackSnapshot(url);
      if (snap) return snap;
    } else {
      return domain + "/" + url;
    }
  }

  return url;
}

async function findWaybackSnapshot(url) {
  try {
    var resp = await fetchViaBackground("https://archive.org/wayback/available?url=" + encodeURIComponent(url));
    var data = JSON.parse(resp.text);
    var snap = data.archived_snapshots && data.archived_snapshots.closest;
    if (snap && snap.url) return snap.url;
  } catch(e) {}
  return null;
}
```

**In `processArticle()` (line 18), change:**

Before:
```javascript
    var content = await fetchViaBackground(url);
```

After:
```javascript
    var fetchUrl = await resolveArchiveUrl(url);
    var content = await fetchViaBackground(fetchUrl);
```

- [ ] **Step 1: Remove old archive functions**

Remove lines 107-119 (`ARCHIVE_PREFERRED_HOSTS` through `archiveUrlFor`).

- [ ] **Step 2: Add `resolveArchiveUrl()` and `findWaybackSnapshot()` before line 14**

Insert the two new functions above `processArticle()`.

- [ ] **Step 3: Wire into `processArticle()`**

Change line 18 from `fetchViaBackground(url)` to use `resolveArchiveUrl(url)` result.

- [ ] **Step 4: Commit**

```bash
git add extension/popup.js
git commit -m "feat: add config-driven archive mirror fallback for paywalled articles"
```

---

### Task 3: Update tests

**Files:**
- Modify: `tests/popup.test.js`

**Remove from test file:**
- Lines 150-167: `ARCHIVE_PREFERRED_HOSTS`, `shouldUseArchive()`, `archiveUrlFor()`

**Add after imports/~line 148:**

```javascript
async function resolveArchiveUrl(url) {
  var config = await chrome.storage.sync.get({
    paywalledHosts: "theverge.com,wired.com,medium.com",
    archiveDomains: "https://archive.org,https://archive.ph,https://archive.is",
  });
  if (!config.paywalledHosts || !config.archiveDomains) return url;
  var hostname = new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
  var hosts = config.paywalledHosts.split(",").map(function(h) { return h.trim().toLowerCase(); }).filter(Boolean);
  var isPaywalled = hosts.some(function(h) { return hostname === h || hostname.endsWith("." + h); });
  if (!isPaywalled) return url;
  var domains = config.archiveDomains.split(",").map(function(d) { return d.trim(); }).filter(Boolean);
  for (var i = 0; i < domains.length; i++) {
    var domain = domains[i].replace(/\/+$/, "");
    if (domain.includes("archive.org")) {
      var snap = await findWaybackSnapshot(url);
      if (snap) return snap;
    } else {
      return domain + "/" + url;
    }
  }
  return url;
}

async function findWaybackSnapshot(url) {
  try {
    var resp = await fetchViaBackground("https://archive.org/wayback/available?url=" + encodeURIComponent(url));
    var data = JSON.parse(resp.text);
    var snap = data.archived_snapshots && data.archived_snapshots.closest;
    if (snap && snap.url) return snap.url;
  } catch(e) {}
  return null;
}
```

**Add test cases (after existing tests, before `runTests` call):**

Add these assertions at the end of the `runTests` function body (before the final results log at line 719):

```javascript
console.log("\n── Archive archive URL resolution ──");
mockChromeStorage({ paywalledHosts: "theverge.com,wired.com", archiveDomains: "https://archive.is" });
assertEqual(await resolveArchiveUrl("https://example.com/article"), "https://example.com/article", "non-paywalled URL unchanged");
assertEqual(
  await resolveArchiveUrl("https://www.theverge.com/2026/4/28/story"),
  "https://archive.is/https://www.theverge.com/2026/4/28/story",
  "paywalled host rewrites to archive.is"
);
assertEqual(
  await resolveArchiveUrl("https://www.wired.com/story/article"),
  "https://archive.is/https://www.wired.com/story/article",
  "wired.com rewrites to archive.is"
);
```

Also update the existing archive test at lines 686-702. Replace that section with:

```javascript
console.log("\n── Archive fallback in tryConvert ──");
fetchCalls = [];
runtimeCalls = [];
scriptingCalls = 0;
runtimeResponse = {
  text: "<html><body>archived article</body></html>",
  contentType: "text/html",
  sourceMode: "html-fetch",
};
globalThis.fetch = async (url, opts = {}) => {
  fetchCalls.push({ url, opts });
  if (fetchCalls.length === 1) return makeJsonResponse(400, { error: "thin_content: teaser" });
  return makeJsonResponse(200, { url: "http://127.0.0.1:5001/view/token" });
};
await tryConvert("/article/generate-preview", "https://www.theverge.com/2026/4/28/story", 17);
assertEqual(
  runtimeCalls[0].url,
  "https://archive.is/https://www.theverge.com/2026/4/28/story",
  "archive-preferred articles fetch archive.is in browser fallback",
);
assertEqual(fetchCalls[1].opts.body.get("url"), "https://www.theverge.com/2026/4/28/story", "archived fallback keeps the original article URL in the upload");
```

- [ ] **Step 1: Remove old archive test functions**

Remove lines 150-167 (`ARCHIVE_PREFERRED_HOSTS` through `archiveUrlFor`).

- [ ] **Step 2: Update `tryConvert` to use `resolveArchiveUrl()` instead of removed `archiveUrlFor()`**

Change line 264 from:
```javascript
      const content = await fetchViaBackground(archiveUrlFor(url));
```
to:
```javascript
      var archiveUrl = await resolveArchiveUrl(url);
      const content = await fetchViaBackground(archiveUrl);
```

- [ ] **Step 3: Add `resolveArchiveUrl()` and `findWaybackSnapshot()` to test file**

Insert the test versions of these functions after line 148.

- [ ] **Step 4: Add new test assertions**

Add the archive URL resolution test assertions before the results log.

- [ ] **Step 5: Update existing archive test**

Replace the archive fallback test section (lines 686-702) with the updated version.

- [ ] **Step 5: Run tests to verify**

```bash
node tests/popup.test.js
```

Expected: all tests pass, including the new archive resolution tests.

- [ ] **Step 6: Commit**

```bash
git add tests/popup.test.js
git commit -m "test: update archive URL resolution tests for config-driven approach"
```

---

### Task 4: Run all tests and verify

- [ ] **Step 1: Run JS tests**

```bash
node tests/popup.test.js
```

Expected: 0 failed.

- [ ] **Step 2: Run Python tests**

```bash
python -m pytest tests/ -v
```

Expected: all passing (no Python-side changes were made, so existing tests should pass).

- [ ] **Step 3: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: address test failures from paywall bypass changes"
```
