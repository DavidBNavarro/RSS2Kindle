# Paywall Bypass Integration — Design Spec

## Problem

The extension has a paywall bypass feature that was partially built but never finished:
- `contentScript.js` has 373 lines of dead code (not wired into the manifest)
- `popup.js` has hardcoded `ARCHIVE_PREFERRED_HOSTS` for theverge.com/wired.com that is only used in tests
- The options page already saves paywall config (`paywalledHosts`, `archiveDomains`, etc.) but no code consumes it

## Architecture

**Approach: Fetch-time archive rewrite** — when the user triggers a conversion, if the URL is a known paywalled domain, silently fetch from an archive mirror instead of the original site. The rest of the pipeline (extraction, EPUB generation, delivery) is unchanged.

```
User clicks Convert
  → processArticle(url)
    → url = resolveArchiveUrl(url)          [NEW: rewrite to archive if paywalled]
    → html = fetchViaBackground(url)         [unchanged]
    → article = extractArticle(html, url)    [unchanged]
    → generateEpub(...)                      [unchanged]
```

## Changes

### Files to delete
- `extension/contentScript.js` — unused overlay-based bypass

### Files to modify
- `extension/popup.js` — add `resolveArchiveUrl()`, integrate into `processArticle()`, remove old hardcoded functions

### Files unchanged
- `extension/background.js` — fetch proxying works as-is
- `extension/options.js` — already saves config to `chrome.storage.sync`
- `extension/options.html` — already has the settings UI fields
- `extension/article-extractor.js` — no changes needed
- `extension/epub-generator.js` — no changes needed
- `server.py` — no changes needed
- `extension/manifest.json` — no changes needed (contentScript.js was never listed)

## Implementation

### 1. Remove dead code
- Delete `extension/contentScript.js`

### 2. Remove old hardcoded functions from popup.js
- Remove `ARCHIVE_PREFERRED_HOSTS` (line 107)
- Remove `shouldUseArchive()` (lines 109-115)
- Remove `archiveUrlFor()` (lines 117-119)

### 3. Add `resolveArchiveUrl(url)` to popup.js

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

### 4. Wire into processArticle()

Line 18 changes from:
```javascript
var content = await fetchViaBackground(url);
```
to:
```javascript
var fetchUrl = await resolveArchiveUrl(url);
var content = await fetchViaBackground(fetchUrl);
```

### 5. Tests
- Remove test cases for old `shouldUseArchive()`/`archiveUrlFor()` in `tests/popup.test.js`
- Add test for `resolveArchiveUrl()`: returns original URL for non-paywalled hosts, rewrites for paywalled hosts, falls back on failure

## Error Handling

- If all archive mirrors fail, `resolveArchiveUrl()` returns the original URL — graceful degradation
- Network errors during archive fetch are caught silently
- The user never sees archive URLs; the rewrite is transparent

## Scope

- **Only** the fetch URL changes
- Article extraction, image processing, EPUB generation, and delivery work identically
- Batch mode (multiple URLs) and text paste mode are unaffected
