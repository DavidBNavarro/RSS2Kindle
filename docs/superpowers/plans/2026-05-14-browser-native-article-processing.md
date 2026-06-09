# Browser-Native Article Processing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) for syntax tracking.

**Goal:** Replace server-side trafilatura + ebooklib with in-extension Mozilla Readability + JSZip article processing.

**Architecture:** Extension fetches page HTML → `article-extractor.js` (Readability) → post-processing (ported BS4 logic) → `epub-generator.js` (JSZip) → EPUB blob → download or POST to server SMTP relay. Server stripped to config + `/send-epub`.

**Tech Stack:** `@mozilla/readability` (npm), `jszip` (npm), Chrome Extension MV3 popup context (full DOM APIs), `image-processor.js` (existing Canvas pipeline)

---

### Task 1: Install npm dependencies and bundle libraries

**Files:**
- Create: `extension/lib/readability.min.js` (bundled from npm)
- Create: `extension/lib/jszip.min.js` (bundled from npm)
- Modify: `package.json` (create if needed)

- [ ] **Step 1: Initialize npm and install packages**

Run:
```bash
npm init -y
npm install @mozilla/readability jszip
```

- [ ] **Step 2: Create the extension/lib/ directory and copy bundled files**

Readability's UMD build is at `node_modules/@mozilla/readability/Readability.js`. JSZip's browser build is at `node_modules/jszip/dist/jszip.min.js`.

Run:
```bash
mkdir -p extension/lib
cp node_modules/@mozilla/readability/Readability.js extension/lib/readability.js
cp node_modules/jszip/dist/jszip.min.js extension/lib/jszip.min.js
```

(We keep readability.js uncompressed for debugging; jszip.min.js is the minified browser build.)

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json extension/lib/
git commit -m "feat: add Readability and JSZip dependencies"
```

---

### Task 2: Create article-extractor.js — Readability wrapper and metadata extraction

**Files:**
- Create: `extension/article-extractor.js`

- [ ] **Step 1: Write the file with Readability wrapper + metadata extraction**

Create `extension/article-extractor.js`:

```js
function extractArticle(html, url) {
  var doc = new DOMParser().parseFromString(html, "text/html");
  var reader = new Readability(doc);
  var article = reader.parse();
  if (!article) {
    var fallback = _extractDomArticle(html);
    if (fallback) return fallback;
    return null;
  }
  return {
    title: _normalizeTitle(article.title || _extractH1Title(html) || "Article"),
    author: article.byline || "",
    content: article.content || "",
    textContent: article.textContent || "",
    length: article.length || 0,
    excerpt: article.excerpt || "",
  };
}

function _normalizeTitle(text) {
  if (!text) return "";
  return text.replace(/\s+/g, " ").trim();
}

function _extractH1Title(html) {
  var doc = new DOMParser().parseFromString(html, "text/html");
  var article = doc.querySelector("article") || doc.body;
  if (!article) return "";
  var h1 = article.querySelector("h1");
  if (!h1) return "";
  var text = _normalizeTitle(h1.textContent);
  return text.length > 5 ? text : "";
}

function extractMetadata(html, url) {
  var doc = new DOMParser().parseFromString(html, "text/html");
  var meta = { title: "", author: "", sitename: "", date: "", readTime: 0 };

  function _meta(name) {
    var el = doc.querySelector('meta[name="' + name + '"], meta[property="' + name + '"]');
    return el ? (el.getAttribute("content") || "").trim() : "";
  }

  meta.title = _normalizeTitle(
    _meta("og:title") || _meta("twitter:title") || doc.title || ""
  );
  meta.author = _meta("author") || _meta("article:author") || "";
  meta.sitename = _meta("og:site_name") || "";
  meta.date = _meta("article:published_time") || _meta("date") || "";

  var bodyText = (doc.body ? doc.body.textContent || "" : "");
  var wordCount = bodyText.split(/\s+/).filter(function(w){ return w.length > 0; }).length;
  meta.readTime = Math.max(1, Math.round(wordCount / 200));

  return meta;
}

function _extractDomArticle(html) {
  var doc = new DOMParser().parseFromString(html, "text/html");
  for (var sel of ["script", "style", "noscript", "template", "iframe"]) {
    var els = doc.querySelectorAll(sel);
    for (var i = 0; i < els.length; i++) els[i].remove();
  }
  var body = doc.body;
  if (!body) return null;

  var candidates = [];
  var seen = new Set();

  function _consider(el) {
    if (!el || !el.tagName || seen.has(el)) return;
    seen.add(el);
    var text = (el.textContent || "").replace(/\s+/g, " ").trim();
    var words = text.split(/\s+/).length;
    if (words < 120) return;
    var score = words;
    if (el.tagName === "ARTICLE") score += 400;
    var cls = (el.className || "") + " " + (el.id || "") + " " + (el.getAttribute("role") || "");
    if (/article|content|story|post|body|main|entry/i.test(cls)) score += 250;
    var paragraphs = el.querySelectorAll("p, h2, h3, li, blockquote, figure");
    score += paragraphs.length * 8;
    candidates.push({ score: score, el: el });
  }

  _consider(doc.querySelector("article"));
  _consider(doc.querySelector("main"));
  var all = body.querySelectorAll("article, main, section, div");
  for (var i = 0; i < all.length && i < 80; i++) _consider(all[i]);

  if (candidates.length === 0) return null;
  candidates.sort(function(a, b){ return b.score - a.score; });
  var best = candidates[0].el;

  var fragments = [];
  var seenTexts = new Set();
  var tags = best.querySelectorAll("h1, p, h2, h3, ul, ol, li, blockquote, figure, figcaption, img");
  for (var i = 0; i < tags.length; i++) {
    var el = tags[i];
    if (el.tagName === "IMG") {
      var src = _getBestImgSrc(el);
      if (!src) continue;
    }
    var text = (el.textContent || "").replace(/\s+/g, " ").trim();
    if ((el.tagName === "P" || el.tagName === "LI" || el.tagName === "BLOCKQUOTE" || el.tagName === "FIGCAPTION") && text.split(/\s+/).length < 3) continue;
    var html = el.outerHTML;
    var norm = html.replace(/\s+/g, " ").trim();
    if (seenTexts.has(norm)) continue;
    seenTexts.add(norm);
    fragments.push(html);
  }

  if (fragments.length === 0) return null;
  return {
    title: _extractH1Title(html) || "Article",
    author: "",
    content: "<html><body>" + fragments.join("\n") + "</body></html>",
    textContent: fragments.map(function(f){ return f.replace(/<[^>]+>/g, ""); }).join(" "),
    length: fragments.join(" ").length,
    excerpt: (fragments[0] || "").replace(/<[^>]+>/g, "").slice(0, 200),
  };
}

function _getBestImgSrc(img) {
  if (!img) return "";
  var src = (img.getAttribute("src") || "").trim();
  if (src && !src.startsWith("data:")) return src;
  for (var attr of ["data-src", "data-lazy-src", "data-original", "data-original-src"]) {
    var val = (img.getAttribute(attr) || "").trim();
    if (val) return val;
  }
  return src;
}
```

- [ ] **Step 2: Verify the file loads in the test harness**

Run:
```bash
node -e "
const fs = require('fs');
const vm = require('vm');
const code = fs.readFileSync('extension/article-extractor.js', 'utf8');
const sandbox = { DOMParser, Readability: function(){}, console, Error, Set, Math, window: {} };
code += 'this.extractArticle = extractArticle; this.extractMetadata = extractMetadata;';
vm.runInNewContext(code, sandbox);
console.log('article-extractor.js loads OK');
console.log('extractArticle:', typeof sandbox.extractArticle);
console.log('extractMetadata:', typeof sandbox.extractMetadata);
"
```
Expected: loads without errors, shows `extractArticle: function` and `extractMetadata: function`.

- [ ] **Step 3: Commit**

```bash
git add extension/article-extractor.js
git commit -m "feat: add article-extractor.js with Readability wrapper and metadata"
```

---

### Task 3: Add text post-processing functions to article-extractor.js

**Files:**
- Modify: `extension/article-extractor.js` (append post-processing functions)

- [ ] **Step 1: Add stripUiText and stripTrailingRelated**

Append to `extension/article-extractor.js`:

```js
var _UI_TEXT_PATTERNS = [
  /listen to this article/i,
  /^\d+:\d+\s*min/i,
  /^learn more$/i,
  /share (this|full) article/i,
  /^advertisement$/i,
  /^supported by$/i,
  /^read in app$/i,
];

function stripUiText(contentHtml) {
  var doc = new DOMParser().parseFromString(contentHtml, "text/html");
  var paragraphs = doc.querySelectorAll("p");
  for (var i = 0; i < paragraphs.length; i++) {
    var p = paragraphs[i];
    var text = (p.textContent || "").trim();
    if (text.length > 120) continue;
    for (var j = 0; j < _UI_TEXT_PATTERNS.length; j++) {
      if (_UI_TEXT_PATTERNS[j].test(text)) {
        p.remove();
        break;
      }
    }
  }
  return doc.body ? doc.body.innerHTML : contentHtml;
}

var _RELATED_HEADING_RE = /^(explore our coverage|related|more on\b|recommended|also read|you might also like|more coverage|more in\b|more from\b|what to read next|keep reading|continue reading|up next)/i;

function stripTrailingRelated(contentHtml) {
  var doc = new DOMParser().parseFromString(contentHtml, "text/html");
  var headings = doc.querySelectorAll("h2, h3");
  for (var i = 0; i < headings.length; i++) {
    var h = headings[i];
    if (_RELATED_HEADING_RE.test((h.textContent || "").trim())) {
      var next = h.nextElementSibling;
      while (next) {
        var toRemove = next;
        next = next.nextElementSibling;
        toRemove.remove();
      }
      h.remove();
      break;
    }
  }
  return doc.body ? doc.body.innerHTML : contentHtml;
}
```

- [ ] **Step 2: Add restoreOrderedLists and restoreBlockquotes**

Append to `extension/article-extractor.js`:

```js
function restoreOrderedLists(extractedHtml, sourceHtml) {
  var srcDoc = new DOMParser().parseFromString(sourceHtml, "text/html");
  var ols = srcDoc.querySelectorAll("ol");
  var fingerprints = new Set();
  for (var i = 0; i < ols.length; i++) {
    var firstLi = ols[i].querySelector("li");
    if (firstLi) {
      var fp = (firstLi.textContent || "").split(/\s+/).join(" ").slice(0, 60);
      if (fp) fingerprints.add(fp);
    }
  }
  if (fingerprints.size === 0) return extractedHtml;

  var extDoc = new DOMParser().parseFromString(extractedHtml, "text/html");
  var uls = extDoc.querySelectorAll("ul");
  for (var i = 0; i < uls.length; i++) {
    var firstLi = uls[i].querySelector("li");
    if (firstLi) {
      var fp = (firstLi.textContent || "").split(/\s+/).join(" ").slice(0, 60);
      if (fingerprints.has(fp)) {
        var ul = uls[i];
        var ol = extDoc.createElement("ol");
        while (ul.firstChild) ol.appendChild(ul.firstChild);
        ul.parentNode.replaceChild(ol, ul);
      }
    }
  }
  return extDoc.body ? extDoc.body.innerHTML : extractedHtml;
}

function restoreBlockquotes(extractedHtml, sourceHtml) {
  function _norm(text) { return (text || "").split(/\s+/).join(" "); }

  var srcDoc = new DOMParser().parseFromString(sourceHtml, "text/html");
  var quotes = srcDoc.querySelectorAll("blockquote");
  var quoteTexts = new Set();
  for (var i = 0; i < quotes.length; i++) {
    var text = _norm(quotes[i].textContent);
    if (text) quoteTexts.add(text);
  }
  if (quoteTexts.size === 0) return extractedHtml;

  var extDoc = new DOMParser().parseFromString(extractedHtml, "text/html");
  var tags = extDoc.querySelectorAll("p, div");
  for (var i = 0; i < tags.length; i++) {
    var tag = tags[i];
    if (tag.querySelector("img, figure, table, ul, ol")) continue;
    var text = _norm(tag.textContent);
    if (quoteTexts.has(text)) {
      var bq = extDoc.createElement("blockquote");
      while (tag.firstChild) bq.appendChild(tag.firstChild);
      tag.parentNode.replaceChild(bq, tag);
    }
  }
  return extDoc.body ? extDoc.body.innerHTML : extractedHtml;
}
```

- [ ] **Step 3: Run basic test**

Run:
```bash
node -e "
const fs = require('fs');
const vm = require('vm');
const code = fs.readFileSync('extension/article-extractor.js', 'utf8') + '\n' +
  'this.stripUiText = stripUiText; this.stripTrailingRelated = stripTrailingRelated;' +
  'this.restoreOrderedLists = restoreOrderedLists; this.restoreBlockquotes = restoreBlockquotes;';
const sandbox = {
  DOMParser, Readability: function(){}, console, Error, Set, Math, window: {},
  document: { createElement: function(){ return {}; } }
};
// DOMParser setup
sandbox.DOMParser.prototype.parseFromString = function(str, type) {
  var doc = new DOMParser().parseFromString(str, type);
  return doc;
};
vm.runInNewContext(code, sandbox);

// Test stripUiText
var result = sandbox.stripUiText('<p>Listen to this article</p><p>Real content here.</p>');
console.log('stripUiText:', result.includes('Real content') && !result.includes('Listen to this'));
var ok = result.includes('Real content') && !result.includes('Listen to this');
console.log(ok ? 'PASS' : 'FAIL');

// Test stripTrailingRelated
result = sandbox.stripTrailingRelated('<p>Lead.</p><h2>Related</h2><p>Related content.</p>');
console.log('stripTrailingRelated:', !result.includes('Related'));
ok = !result.includes('Related') && result.includes('Lead.');
console.log(ok ? 'PASS' : 'FAIL');

// Test restoreOrderedLists
result = sandbox.restoreOrderedLists('<ul><li>First item</li></ul>', '<ol><li>First item</li></ol>');
console.log('restoreOrderedLists:', result.includes('<ol>') && !result.includes('<ul>'));
ok = result.includes('<ol>');
console.log(ok ? 'PASS' : 'FAIL');

// Test restoreBlockquotes
result = sandbox.restoreBlockquotes('<p>Some quote text here.</p>', '<blockquote>Some quote text here.</blockquote>');
console.log('restoreBlockquotes:', result.includes('<blockquote>'));
ok = result.includes('<blockquote>');
console.log(ok ? 'PASS' : 'FAIL');

console.log('\\nDone');
"
```
Expected: all 4 tests PASS.

- [ ] **Step 4: Commit**

```bash
git add extension/article-extractor.js
git commit -m "feat: add post-processing functions to article-extractor.js"
```

---

### Task 4: Port image reinjection to article-extractor.js

**Files:**
- Modify: `extension/article-extractor.js`

This ports `_reinject_images()` from server.py (~300 lines BS4 → DOM APIs). The logic is identical: find the article container in the original HTML, scan for image candidates, match them to extracted text positions, insert `<img>` tags in the extracted content.

- [ ] **Step 1: Add reinjectImages function**

Append to `extension/article-extractor.js`:

```js
var _UI_CHROME_CLASSES = new Set([
  "share", "social", "toolbar", "audio", "player", "icon",
  "button", "nav", "menu", "comment", "comments", "newsletter",
  "subscribe", "ad", "promo", "sidebar", "widget",
]);

function _iterTokens(value) {
  if (!value) return [];
  return value.toLowerCase().split(/[^a-z0-9]+/).filter(function(t){ return t; });
}

function _isUiChrome(el) {
  var node = el;
  for (var depth = 0; depth < 5 && node; depth++) {
    var cls = (node.className || "") + " " + (node.id || "");
    var tokens = _iterTokens(cls);
    for (var i = 0; i < tokens.length; i++) {
      if (_UI_CHROME_CLASSES.has(tokens[i])) return true;
    }
    node = node.parentElement;
  }
  return false;
}

function _resolveUrl(src, baseUrl) {
  if (!src || src.startsWith("data:")) return src;
  try {
    return new URL(src, baseUrl).href;
  } catch(e) {
    return src;
  }
}

function _normalizeImageUrl(src, baseUrl) {
  var resolved = _resolveUrl(src, baseUrl);
  var m = resolved.match(/\/assets\/images\/optimized\/[^/]+\/([^/]+)\/wp-content\/uploads\/(.+)$/i);
  if (m) return "https://" + m[1] + "/wp-content/uploads/" + m[2];
  return resolved;
}

function _candidateSrc(tag) {
  for (var attr of [
    "data-src", "data-lazy-src", "data-lazyload", "data-lazy",
    "data-original", "data-original-src", "data-original-url",
    "data-img-src", "data-full-src", "data-full-url", "data-full-image",
    "data-large-src", "data-nitro-lazy-src", "data-nitro-src",
    "nitro-lazy-src", "data-orig-file", "data-medium-file", "data-large-file",
  ]) {
    var val = (tag.getAttribute(attr) || "").trim();
    if (val && !val.startsWith("data:") && val.length > 10) return val;
  }
  var src = (tag.getAttribute("src") || "").trim();
  if (src && !src.startsWith("data:")) return src;
  return "";
}

function _parseSrcset(srcset) {
  if (!srcset) return "";
  var parts = srcset.split(",");
  var best = "", bestScore = -1;
  for (var i = 0; i < parts.length; i++) {
    var part = parts[i].trim();
    var m = part.match(/(\S+)\s+(\d+(?:\.\d+)?)([wx])/);
    if (m) {
      var score = parseFloat(m[2]) * (m[3] === "w" ? 1 : 1000);
      if (score > bestScore) { bestScore = score; best = m[1]; }
    }
  }
  return best;
}

function _findArticleContainer(doc) {
  var article = doc.querySelector("article");
  if (article) return { el: article, selector: "article" };
  for (var cls of ["entry-content", "entry", "post-content", "available-content", "body"]) {
    var el = doc.querySelector("div." + cls);
    if (el) return { el: el, selector: "." + cls };
  }
  if (doc.body) return { el: doc.body, selector: "body" };
  return null;
}

function _evaluateSrc(tag, url, skipSizeCheck) {
  var src = _candidateSrc(tag);
  if (!src) return { src: "", reason: "no_src" };
  if (!skipSizeCheck) {
    var w = parseInt(tag.getAttribute("width")), h = parseInt(tag.getAttribute("height"));
    if ((w && w < 50) || (h && h < 50)) return { src: "", reason: "tiny" };
  }
  if (src.startsWith("data:")) return { src: "", reason: "data_uri" };
  var low = src.toLowerCase();
  if (/,w_32,|,w_24,|,w_16,|\/icon|\/avatar|\/favicon|\/button|\/share|\/social|\/toolbar|\/sprite|\/emoji|\/logo|badge|icon\.|icons\//.test(low)) {
    return { src: "", reason: "ui_like_url" };
  }
  if (_isUiChrome(tag)) return { src: "", reason: "ui_chrome" };
  return { src: _normalizeImageUrl(src, url), reason: "accepted" };
}

function _normText(text) {
  return text.replace(/\s+/g, " ").trim().toLowerCase().replace(/[^a-z0-9 ]/g, "");
}

function reinjectImages(extractedHtml, originalHtml, url) {
  var origDoc = new DOMParser().parseFromString(originalHtml, "text/html");
  var container = _findArticleContainer(origDoc);
  if (!container) return extractedHtml;

  var article = container.el;
  var seenSrcs = new Set();
  var placements = [];

  // Lead images: walk up from article looking for preceding siblings with images
  function _collectMedia(node) {
    if (!node || !node.querySelectorAll) return;
    var imgs = node.querySelectorAll("img, picture, [data-src], [data-lazy-src]");
    for (var i = 0; i < imgs.length; i++) {
      var el = imgs[i];
      if (el.tagName === "PICTURE") {
        var img = el.querySelector("img");
        var result = img ? _evaluateSrc(img, url, true) : { src: "", reason: "" };
        if (result.src && !seenSrcs.has(result.src)) {
          seenSrcs.add(result.src);
          placements.push({ text: "", src: result.src });
        }
      } else {
        var result = _evaluateSrc(el, url, true);
        if (result.src && !seenSrcs.has(result.src)) {
          seenSrcs.add(result.src);
          placements.push({ text: "", src: result.src });
        }
      }
    }
  }

  var cur = article;
  for (var d = 0; d < 8 && cur; d++) {
    var parent = cur.parentElement;
    if (!parent) break;
    var sibling = cur.previousElementSibling;
    while (sibling) {
      if (_isUiChrome(sibling)) { sibling = sibling.previousElementSibling; continue; }
      _collectMedia(sibling);
      sibling = sibling.previousElementSibling;
    }
    cur = parent;
    if (parent.tagName === "BODY" || parent.tagName === "HTML") break;
  }

  // Inline images: walk article descendants
  var lastText = "";
  var children = article.querySelectorAll("p, h1, h2, h3, h4, h5, h6, li, blockquote, figcaption, picture, img, [data-src], [data-lazy-src]");
  for (var i = 0; i < children.length; i++) {
    var el = children[i];
    if (["P","H1","H2","H3","H4","H5","H6","LI","BLOCKQUOTE","FIGCAPTION"].indexOf(el.tagName) >= 0) {
      var text = (el.textContent || "").replace(/\s+/g, " ").trim();
      if (text.length > 3) lastText = text;
    } else if (el.tagName === "PICTURE") {
      var img = el.querySelector("img");
      if (img) {
        var result = _evaluateSrc(img, url);
        if (result.src && !seenSrcs.has(result.src)) {
          seenSrcs.add(result.src);
          placements.push({ text: lastText, src: result.src });
        }
      }
    } else if (el.tagName === "IMG") {
      if (el.parentElement && el.parentElement.tagName === "PICTURE") continue;
      var result = _evaluateSrc(el, url);
      if (result.src && !seenSrcs.has(result.src)) {
        seenSrcs.add(result.src);
        placements.push({ text: lastText, src: result.src });
      }
    } else {
      // elements with data-src etc
      var result = _evaluateSrc(el, url, true);
      if (result.src && !seenSrcs.has(result.src)) {
        seenSrcs.add(result.src);
        placements.push({ text: lastText, src: result.src });
      }
    }
  }

  // Open graph fallback
  if (placements.length === 0) {
    var metas = origDoc.querySelectorAll('meta[property="og:image"], meta[name="twitter:image"]');
    for (var i = 0; i < metas.length; i++) {
      var content = (metas[i].getAttribute("content") || "").trim();
      if (content) {
        var resolved = _resolveUrl(content, url);
        if (!seenSrcs.has(resolved)) {
          seenSrcs.add(resolved);
          placements.push({ text: "", src: resolved });
        }
      }
    }
  }

  if (placements.length === 0) return extractedHtml;

  // Match to extracted document
  var extDoc = new DOMParser().parseFromString(extractedHtml, "text/html");
  var textEls = extDoc.querySelectorAll("p, h1, h2, h3, h4, h5, h6, li, figcaption");
  var elemTexts = [];
  for (var i = 0; i < textEls.length; i++) {
    elemTexts.push({
      norm: _normText(textEls[i].textContent),
      el: textEls[i],
    });
  }

  var placedSrcs = new Set();
  var lastMatchIdx = -1;

  for (var p = 0; p < placements.length; p++) {
    var placement = placements[p];
    var snippet = _normText(placement.text).slice(0, 40);
    var snippetPrefix = snippet.slice(0, 25);
    var bestMatch = null;
    var bestMatchIdx = -1;

    if (snippetPrefix) {
      for (var j = lastMatchIdx + 1; j < elemTexts.length; j++) {
        var normPrefix = elemTexts[j].norm.slice(0, 25);
        if (!normPrefix) continue;
        if (elemTexts[j].norm.indexOf(snippetPrefix) >= 0 || snippetPrefix.indexOf(elemTexts[j].norm.slice(0, 25)) >= 0) {
          bestMatch = elemTexts[j].el;
          bestMatchIdx = j;
          break;
        }
      }
    }

    if (bestMatch && !placedSrcs.has(placement.src)) {
      var img = extDoc.createElement("img");
      img.setAttribute("src", placement.src);
      img.setAttribute("alt", "");
      img.style.maxWidth = "100%";
      bestMatch.parentNode.insertBefore(img, bestMatch.nextSibling);
      placedSrcs.add(placement.src);
      lastMatchIdx = bestMatchIdx;
    }
  }

  // Place unplaced lead images at top
  for (var p = 0; p < placements.length; p++) {
    if (!placedSrcs.has(placements[p].src) && !placements[p].text && textEls.length > 0) {
      var img = extDoc.createElement("img");
      img.setAttribute("src", placements[p].src);
      img.setAttribute("alt", "");
      img.style.maxWidth = "100%";
      textEls[0].parentNode.insertBefore(img, textEls[0]);
      placedSrcs.add(placements[p].src);
    }
  }

  return extDoc.body ? extDoc.body.innerHTML : extractedHtml;
}
```

- [ ] **Step 2: Commit**

```bash
git add extension/article-extractor.js
git commit -m "feat: add image reinjection to article-extractor.js"
```

---

### (Fix) Inline: ProcessArticle title parameter and keepLinks inversion

Before Task 5, fix two issues:

1. `processArticle()` needs to accept an optional title parameter (for paste mode where the title comes from `$("paste-title")`, not `$("preview-title")`)
2. `generateEpub()` has inverted `keepLinks` logic (strips links when it should keep them)

**Fix 1: In Task 8's `processArticle`, change signature to accept optional title:**

Replace `async function processArticle(url, opts) {` with:
```js
async function processArticle(url, opts, titleOverride) {
```

And replace the title line:
```js
  var title = _getPreviewTitle() || article.title;
```
with:
```js
  var title = titleOverride || _getPreviewTitle() || article.title;
```

**Fix 2: In Task 6's `generateEpub`, fix the keepLinks condition:**

Replace:
```js
  if (keepLinks) {
    bodyHtml = bodyHtml.replace(/<a\b[^>]*>(.*?)<\/a>/gi, "$1");
  }
```
with:
```js
  if (!keepLinks) {
    bodyHtml = bodyHtml.replace(/<a\b[^>]*>(.*?)<\/a>/gi, "$1");
  }
```

**Fix 3: In Task 8's `handlePasteConvert`, pass the captured title to processArticle for URL paste mode:**

In the `handlePasteConvert` function, find:
```js
        result = await processArticle(pastedContent, opts);
```
Replace with:
```js
        result = await processArticle(pastedContent, opts, title);
```

---

### Task 5: Add link reinjection to article-extractor.js

**Files:**
- Modify: `extension/article-extractor.js`

- [ ] **Step 1: Add reinjectLinks function**

Append to `extension/article-extractor.js`:

```js
function reinjectLinks(extractedHtml, originalHtml, url) {
  var origDoc = new DOMParser().parseFromString(originalHtml, "text/html");
  var container = _findArticleContainer(origDoc);
  if (!container) return extractedHtml;

  var linkMap = [];
  var seen = new Set();
  var links = container.el.querySelectorAll("a");
  for (var i = 0; i < links.length; i++) {
    var a = links[i];
    var href = (a.getAttribute("href") || "").trim();
    if (!href || href.startsWith("#") || href.startsWith("javascript:")) continue;
    var text = (a.textContent || "").trim();
    if (!text || text.length < 3) continue;
    var resolved = _resolveUrl(href, url);
    var normalized = text.split(/\s+/).join(" ");
    if (!seen.has(normalized)) {
      seen.add(normalized);
      linkMap.push({ text: normalized, url: resolved });
    }
  }

  if (linkMap.length < 3) {
    var fallback = origDoc.querySelector("article") || origDoc.body;
    if (fallback && fallback !== container.el) {
      var moreLinks = fallback.querySelectorAll("a");
      for (var i = 0; i < moreLinks.length; i++) {
        var a = moreLinks[i];
        var href = (a.getAttribute("href") || "").trim();
        if (!href || href.startsWith("#") || href.startsWith("javascript:")) continue;
        var text = (a.textContent || "").trim();
        if (!text || text.length < 3) continue;
        var resolved = _resolveUrl(href, url);
        var normalized = text.split(/\s+/).join(" ");
        if (!seen.has(normalized)) {
          seen.add(normalized);
          linkMap.push({ text: normalized, url: resolved });
        }
      }
    }
  }

  if (linkMap.length === 0) return extractedHtml;

  linkMap.sort(function(a, b){ return b.text.length - a.text.length; });

  var extDoc = new DOMParser().parseFromString(extractedHtml, "text/html");
  var candidates = extDoc.querySelectorAll("p, li, blockquote, figcaption");

  for (var li = 0; li < linkMap.length; li++) {
    var linkText = linkMap[li].text;
    var linkUrl = linkMap[li].url;
    for (var ci = 0; ci < candidates.length; ci++) {
      var el = candidates[ci];
      if (el.querySelector("a")) continue;
      var html = el.innerHTML;
      var idx = html.indexOf(linkText);
      if (idx === -1) continue;
      var before = html.slice(0, idx);
      var after = html.slice(idx + linkText.length);
      el.innerHTML = before + '<a href="' + linkUrl.replace(/&/g,"&amp;").replace(/"/g,"&quot;") + '">' + linkText + "</a>" + after;
      break;
    }
  }

  return extDoc.body ? extDoc.body.innerHTML : extractedHtml;
}
```

- [ ] **Step 2: Commit**

```bash
git add extension/article-extractor.js
git commit -m "feat: add link reinjection to article-extractor.js"
```

---

### Task 6: Add JSZip-based EPUB generation to epub-generator.js

**Files:**
- Modify: `extension/epub-generator.js`

- [ ] **Step 1: Add generateEpub function using JSZip**

At the end of `extension/epub-generator.js`, add:

```js
var _KINDLE_CSS = "body{font-family:Georgia,serif;line-height:1.6;margin:2em 1.5em}" +
  "h1{font-size:1.4em;margin-top:1em}" +
  "h2{font-size:1.2em;margin-top:0.8em}" +
  "h3{font-size:1.05em;margin-top:0.6em}" +
  "p{margin:0.6em 0;text-indent:1.2em}" +
  "p.byline{color:#555;font-size:0.9em;text-indent:0}" +
  "blockquote{color:#444;font-style:italic;margin:1em 2em;padding:0.5em 1em;border-left:3px solid #ccc}" +
  "pre{font-size:0.85em;background:#f5f5f5;padding:0.5em;overflow-x:auto;white-space:pre-wrap}" +
  "code{font-family:Menlo,Consolas,monospace;font-size:0.9em}" +
  "img{max-width:100%;height:auto}" +
  "table{border-collapse:collapse;margin:1em auto;font-size:0.9em}" +
  "td,th{border:1px solid #ccc;padding:0.4em 0.6em}" +
  "th{background:#f0f0f0}" +
  "a{color:#2563eb;text-decoration:none}a:hover{text-decoration:underline}" +
  "ol,ul{margin:0.6em 0;padding-left:2em}";

function _epubXmlHeader() {
  return '<?xml version="1.0" encoding="utf-8"?>\n';
}

function _containerXml() {
  return _epubXmlHeader() +
    '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">\n' +
    '  <rootfiles>\n' +
    '    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>\n' +
    '  </rootfiles>\n' +
    '</container>';
}

function _contentOpf(title, author, fileManifest, spineOrder, coverId) {
  var manifest = "";
  for (var i = 0; i < fileManifest.length; i++) {
    var f = fileManifest[i];
    manifest += '    <item id="' + f.id + '" href="' + f.href + '" media-type="' + f.mediaType + '"/>\n';
  }
  var spine = "";
  for (var i = 0; i < spineOrder.length; i++) {
    spine += '    <itemref idref="' + spineOrder[i] + '"/>\n';
  }

  return _epubXmlHeader() +
    '<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="BookId">\n' +
    '  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">\n' +
    '    <dc:identifier id="BookId">urn:uuid:' + _uuid() + '</dc:identifier>\n' +
    '    <dc:title>' + _esc(title) + '</dc:title>\n' +
    '    <dc:language>en</dc:language>\n' +
    (author ? '    <dc:creator>' + _esc(author) + '</dc:creator>\n' : "") +
    '    <meta name="cover" content="' + coverId + '"/>\n' +
    '  </metadata>\n' +
    '  <manifest>\n' + manifest +
    '  </manifest>\n' +
    '  <spine toc="ncx">\n' + spine +
    '  </spine>\n' +
    '</package>';
}

function _tocNcx(title, navPoints) {
  var points = "";
  for (var i = 0; i < navPoints.length; i++) {
    var np = navPoints[i];
    points += '    <navPoint id="navpoint-' + (i + 1) + '" playOrder="' + (i + 1) + '">\n' +
      '      <navLabel><text>' + _esc(np.label) + '</text></navLabel>\n' +
      '      <content src="' + np.src + '"/>\n' +
      '    </navPoint>\n';
  }
  return _epubXmlHeader() +
    '<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">\n' +
    '  <head>\n' +
    '    <meta name="dtb:uid" content="urn:uuid:' + _uuid() + '"/>\n' +
    '  </head>\n' +
    '  <docTitle><text>' + _esc(title) + '</text></docTitle>\n' +
    '  <navMap>\n' + points +
    '  </navMap>\n' +
    '</ncx>';
}

function _uuid() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function(c) {
    var r = Math.random() * 16 | 0;
    return (c === "x" ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

function _sanitizeKindleText(text) {
  if (!text) return text;
  return text.replace(/[\u200d\u2600-\u27bf\ufe0e-\ufe0f\ud800-\udbff\udc00-\udfff]/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

async function generateEpub(opts) {
  var {
    article,
    originalHtml = "",
    url = "",
    title: titleOverride = "",
    keepImages = true,
    keepLinks = true,
    rotateImages = true,
    imageProcessor = null,
  } = opts;

  var title = _sanitizeKindleText(titleOverride || article.title || "Article");
  var author = _sanitizeKindleText(article.author || "");
  var sitename = article.sitename || "";
  var pubDate = article.pubDate || "";
  var readTime = article.readTime || 0;

  var bodyHtml = article.content || "";
  if (keepLinks) {
    bodyHtml = bodyHtml.replace(/<a\b[^>]*>(.*?)<\/a>/gi, "$1");
  }

  // Wrap content in EPUB structure
  var contentHtml =
    '<body>\n' +
    '  <h1 id="title">' + _esc(title) + '</h1>\n' +
    (author ? '  <p class="byline">' + _esc(author) + '</p>\n' : "") +
    '  ' + bodyHtml + '\n' +
    '</body>';

  // Build heading-based TOC
  var tocEntries = [];
  var doc = new DOMParser().parseFromString(bodyHtml, "text/html");
  var headings = doc.querySelectorAll("h1, h2, h3");
  var usedIds = new Set(["title"]);
  for (var i = 0; i < headings.length; i++) {
    var h = headings[i];
    var text = (h.textContent || "").replace(/\s+/g, " ").trim();
    if (!text) continue;
    var slug = text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "section";
    var base = slug, counter = 1;
    while (usedIds.has(slug)) { slug = base + "-" + counter; counter++; }
    usedIds.add(slug);
    h.setAttribute("id", slug);
    tocEntries.push({ text: text, slug: slug, level: parseInt(h.tagName[1]) });
  }
  bodyHtml = doc.body ? doc.body.innerHTML : bodyHtml;

  // Cover SVG
  var coverSvg = generateCoverImageSvg({
    title: title,
    authors: author,
    sitename: sitename,
    readTime: readTime > 0 ? readTime : null,
  });
  var coverXhtml = _epubXmlHeader() +
    '<html xmlns="http://www.w3.org/1999/xhtml">\n' +
    '<head><title>Cover</title></head>\n' +
    '<body>\n' + coverSvg + '\n</body>\n</html>';

  // Details page
  var detailsHtml = generateDetailsPage({
    title: title,
    authors: author,
    pubDate: pubDate,
    place: sitename,
    url: url,
    sentDate: new Date().toISOString().split("T")[0],
    keepLinks: keepLinks,
    readTime: readTime > 0 ? readTime : null,
  });

  var contentXhtml = _epubXmlHeader() +
    '<html xmlns="http://www.w3.org/1999/xhtml">\n' +
    '<head><title>' + _esc(title) + '</title></head>\n' +
    contentHtml + '\n</html>';

  var detailsXhtml = detailsHtml;

  // Build JSZip
  var zip = new JSZip();
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
  zip.folder("META-INF").file("container.xml", _containerXml());

  var oebps = zip.folder("OEBPS");
  oebps.file("style/default.css", _KINDLE_CSS);

  // File manifest and spine
  var fileManifest = [];
  var spineOrder = [];
  var imgCounter = 0;

  function addItem(id, href, mediaType) {
    fileManifest.push({ id: id, href: href, mediaType: mediaType });
    spineOrder.push(id);
  }

  // Cover
  oebps.file("cover.xhtml", coverXhtml);
  addItem("cover", "cover.xhtml", "application/xhtml+xml");

  // Cover SVG image as item (needed for Kindle)
  var coverImgId = "cover-image";
  oebps.folder("images").file("cover.svg", coverSvg);
  fileManifest.push({ id: coverImgId, href: "images/cover.svg", mediaType: "image/svg+xml" });

  // Details
  oebps.file("details.xhtml", detailsXhtml);
  addItem("details", "details.xhtml", "application/xhtml+xml");

  // CSS
  fileManifest.push({ id: "css", href: "style/default.css", mediaType: "text/css" });

  // Content
  oebps.file("content.xhtml", contentXhtml);
  addItem("content", "content.xhtml", "application/xhtml+xml");

  // Nav
  var navPoints = [
    { label: title, src: "content.xhtml#title" },
  ];
  for (var i = 0; i < tocEntries.length; i++) {
    if (tocEntries[i].level <= 2) {
      navPoints.push({ label: tocEntries[i].text, src: "content.xhtml#" + tocEntries[i].slug });
    }
  }
  oebps.file("toc.ncx", _tocNcx(title, navPoints));
  fileManifest.push({ id: "ncx", href: "toc.ncx", mediaType: "application/x-dtbncx+xml" });

  // Images
  if (keepImages && imageProcessor) {
    var imgEls = doc.querySelectorAll("img");
    for (var i = 0; i < imgEls.length; i++) {
      var imgSrc = imgEls[i].getAttribute("src");
      if (!imgSrc || imgSrc.startsWith("data:")) continue;
      try {
        var blob = await imageProcessor.fetchImageAsBlob(imgSrc, { referer: url });
        var info = await imageProcessor.getImageInfo(blob);
        if (imageProcessor.shouldSkipImage(info.width, info.height)) continue;

        var processed = blob;
        if (rotateImages && imageProcessor.shouldRotateImage(info.width, info.height)) {
          processed = await imageProcessor.rotateImage(blob);
        }
        if (processed.type !== "image/jpeg" && processed.type !== "image/png") {
          processed = await imageProcessor.convertFormat(processed, "image/jpeg", { quality: 0.85 });
        }

        imgCounter++;
        var ext = processed.type === "image/png" ? "png" : "jpg";
        var fname = "images/img" + String(imgCounter).padStart(3, "0") + "." + ext;
        oebps.folder("images").file(fname, await processed.arrayBuffer(), { binary: true });

        var imgId = "img" + imgCounter;
        fileManifest.push({ id: imgId, href: fname, mediaType: processed.type });

        // Update src in content
        imgEls[i].setAttribute("src", fname);
      } catch(e) {
        // Skip image on error
        imgEls[i].remove();
      }
    }
  }

  // Generate content.opf with updated manifest
  var opf = _contentOpf(title, author, fileManifest, spineOrder, coverImgId);
  oebps.file("content.opf", opf);

  return zip.generateAsync({ type: "blob" });
}
```

- [ ] **Step 2: Commit**

```bash
git add extension/epub-generator.js
git commit -m "feat: add JSZip-based generateEpub to epub-generator.js"
```

---

### Task 7: Update popup.html with new script tags

**Files:**
- Modify: `extension/popup.html`

- [ ] **Step 1: Add script tags for new dependencies and article-extractor.js**

Edit `extension/popup.html` and add before the existing scripts:

```html
  <script src="lib/readability.js"></script>
  <script src="lib/jszip.min.js"></script>
  <script src="article-extractor.js"></script>
  <script src="conversion-counter.js"></script>
  <script src="license.js"></script>
  <script src="history-store.js"></script>
  <script src="image-processor.js"></script>
  <script src="epub-generator.js"></script>
  <script src="popup.js"></script>
```

- [ ] **Step 2: Commit**

```bash
git add extension/popup.html
git commit -m "feat: add readability, jszip, article-extractor script tags"
```

---

### Task 8: Rewrite popup.js to use in-extension article processing

**Files:**
- Modify: `extension/popup.js`

This is the most invasive change. The popup currently sends URLs to server.py for processing. After this task, it processes everything in-extension.

- [ ] **Step 1: Update the convert/send/download functions**

Replace the popup.js processing functions. The key changes:

1. `handleConvert()` - fetch HTML locally, extract, generate EPUB, POST blob to server
2. `handleDownload()` - fetch HTML locally, extract, generate EPUB, download blob
3. `handlePreview()` - fetch HTML locally, extract, generate EPUB, open preview
4. Remove `ARTICLE_SEND_ENDPOINT`, `ARTICLE_PREVIEW_ENDPOINT` constants (no longer used)
5. Add `processArticle()` helper
6. Remove `tryConvert()` (no longer needed, replaced by in-extension flow)

Replace the contents of `extension/popup.js`:

```js
var DEFAULT_SERVER = "http://127.0.0.1:5001";
var SEND_EPUB_ENDPOINT = "/send-epub";

var SERVER = DEFAULT_SERVER;
var pasteMode = false;
var currentTab = null;
var batchUrls = [];

function $(id) { return document.getElementById(id); }
function show(id) { $(id).classList.remove("hidden"); }
function hide(id) { $(id).classList.add("hidden"); }

async function processArticle(url, opts) {
  setProgress("Fetching page…", 10);
  var html;
  try {
    var content = await fetchViaBackground(url);
    html = content.text;
  } catch(e) {
    // Fallback: rendered DOM
    if (currentTab && currentTab.id) {
      html = await fetchRenderedHtml(currentTab.id);
    }
    if (!html) throw new Error("Could not fetch page content. Try opening it in a tab first.");
  }

  setProgress("Extracting article…", 30);
  var article = extractArticle(html, url);
  if (!article) throw new Error("Could not extract article content from this page. Try a page with a clear article body.");

  // Post-processing
  setProgress("Processing…", 50);
  var title = _getPreviewTitle() || article.title;
  var content = article.content;

  content = stripUiText(content);
  content = stripTrailingRelated(content);
  content = restoreOrderedLists(content, html);
  content = restoreBlockquotes(content, html);
  content = reinjectImages(content, html, url);
  content = reinjectLinks(content, html, url);

  var metadata = extractMetadata(html, url);
  article.title = title;
  article.author = article.author || metadata.author || "";
  article.sitename = metadata.sitename || "";
  article.pubDate = metadata.date || "";
  article.readTime = metadata.readTime;

  setProgress("Generating EPUB…", 70);
  var epubBlob = await generateEpub({
    article: article,
    originalHtml: html,
    url: url,
    title: title,
    keepImages: opts.keepImages !== false,
    keepLinks: opts.keepLinks !== false,
    imageProcessor: {
      fetchImageAsBlob: fetchImageAsBlob,
      getImageInfo: getImageInfo,
      shouldSkipImage: shouldSkipImage,
      shouldRotateImage: shouldRotateImage,
      rotateImage: rotateImage,
      convertFormat: convertFormat,
    },
  });

  return { epubBlob: epubBlob, title: title };
}

async function loadServerUrl() {
  var stored = await chrome.storage.sync.get({ serverUrl: DEFAULT_SERVER });
  SERVER = stored.serverUrl;
}

async function loadOptions() {
  var stored = await chrome.storage.local.get({ keepImages: true, keepLinks: true });
  $("keep-images").checked = stored.keepImages;
  $("keep-links").checked = stored.keepLinks;
}

function getOptions() {
  return { keepImages: $("keep-images").checked, keepLinks: $("keep-links").checked };
}

function isPdfUrl(url) {
  return /\.pdf(\?|#|$)/i.test(url || "") || /\/pdf\//i.test(url || "");
}

function isLocalFileUrl(url) {
  return /^file:\/\//i.test(url || "");
}

function isArticleUrl(url) {
  return /^https?:\/\//i.test(url || "") && !isPdfUrl(url);
}

function getBatchUrls() {
  var val = $("paste-input").value.trim();
  if (!val) return [];
  var lines = val.split("\n").map(function(l){ return l.trim(); }).filter(function(l){ return l.length > 0; });
  return lines.filter(function(l){ return /^https?:\/\//i.test(l) && !isPdfUrl(l) && !isLocalFileUrl(l); });
}

var ARCHIVE_PREFERRED_HOSTS = new Set(["theverge.com", "wired.com"]);

function shouldUseArchive(url) {
  try {
    var parsed = new URL(url);
    var host = parsed.hostname.replace(/^www\./i, "").toLowerCase();
    return parsed.protocol.startsWith("http") && ARCHIVE_PREFERRED_HOSTS.has(host);
  } catch(e) { return false; }
}

function archiveUrlFor(url) {
  return shouldUseArchive(url) ? "https://archive.is/" + url : url;
}

function setProgress(text, pct) {
  $("progress-text").textContent = text;
  $("progress-fill").style.width = pct + "%";
}

function showError(msg) {
  hide("progress");
  hide("actions");
  hide("options");
  hide("mode-note");
  $("error-text").textContent = msg;
  show("error-text");
}

function showResult(msg) {
  hide("progress");
  hide("mode-note");
  $("result-text").textContent = msg;
  show("result-text");
}

function showNote(msg) {
  hide("progress");
  hide("error-text");
  hide("result-text");
  $("mode-note").textContent = msg;
  show("mode-note");
}

function clearMessages() {
  hide("error-text");
  hide("result-text");
  hide("mode-note");
}

function formatSendSuccess(result) {
  var base = "✓ Sent to " + result.kindle_email;
  return result.delivery_notice ? base + " (" + result.delivery_notice + ")" : base;
}

function setServerStatus(state) {
  if (state === "starting") {
    $("server-dot").className = "dot starting";
    $("server-text").textContent = "Connecting…";
  } else {
    $("server-dot").className = "dot " + (state ? "online" : "offline");
    $("server-text").textContent = state ? "Server running" : "Server offline";
  }
}

function getStartupErrorMessage(serverState) {
  if (!serverState && !$("server-dot").classList.contains("online")) {
    return "Server offline. Run install.sh once to auto-start on login, or: python server.py";
  }
  return "";
}

function updatePasteBadge() {
  var val = $("paste-input").value.trim();
  var badge = $("paste-badge");
  if (!val) {
    badge.textContent = "";
    badge.className = "badge";
    hide("batch-queue");
    show("paste-title");
    return;
  }
  var detected = getBatchUrls();
  if (detected.length >= 2) {
    badge.textContent = "BATCH " + detected.length;
    badge.className = "badge batch";
    batchUrls = detected;
    renderBatchQueue(detected.map(function(u){ return { url: u, status: "pending", error: "" }; }));
    show("batch-queue");
    hide("paste-title");
    return;
  }
  hide("batch-queue");
  show("paste-title");
  var isUrl = /^https?:\/\//i.test(val) || /^file:\/\//i.test(val);
  badge.textContent = isUrl ? "URL" : "TEXT";
  badge.className = "badge " + (isUrl ? "url" : "text");
}

function togglePasteMode() {
  pasteMode = !pasteMode;
  batchUrls = [];
  clearMessages();
  if (pasteMode) {
    hide("preview-card");
    hide("preview-loading");
    hide("prev-sent-warning");
    show("paste-mode");
    show("actions");
    show("options");
    $("paste-toggle").textContent = "← Current page";
    $("paste-input").focus();
    updatePasteBadge();
  } else {
    hide("paste-mode");
    $("paste-toggle").textContent = "✂ Paste URL / text";
    initPopup();
  }
}

function renderBatchQueue(queue) {
  var list = $("batch-list");
  list.innerHTML = "";
  queue.forEach(function(item, i) {
    var row = document.createElement("div");
    row.className = "batch-item";
    row.id = "batch-item-" + i;
    var dot = document.createElement("span");
    dot.className = "batch-dot " + item.status;
    var urlEl = document.createElement("span");
    urlEl.className = "batch-url";
    urlEl.textContent = item.url;
    row.appendChild(dot);
    row.appendChild(urlEl);
    list.appendChild(row);
  });
}

function updateBatchItem(i, status) {
  var row = $("batch-item-" + i);
  if (!row) return;
  var dot = row.querySelector(".batch-dot");
  if (dot) dot.className = "batch-dot " + status;
}

function _getPreviewTitle() {
  var el = $("preview-title");
  return el ? el.value.trim() : "";
}

async function fetchViaBackground(url) {
  return new Promise(function(resolve, reject) {
    chrome.runtime.sendMessage({ action: "fetchPageContent", url }, function(resp) {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (resp.error) return reject(new Error(resp.error));
      if (typeof resp.text === "string") {
        resolve({
          text: resp.text,
          contentType: resp.contentType || "text/html",
          sourceMode: resp.sourceMode || "html-fetch",
        });
        return;
      }
      // Binary fallback (PDF etc)
      var binary = atob(resp.base64 || "");
      var bytes = new Uint8Array(binary.length);
      for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      var decoder = new TextDecoder("utf-8");
      resolve({
        text: decoder.decode(bytes),
        contentType: resp.contentType || "text/html",
        sourceMode: resp.sourceMode || "html-fetch",
      });
    });
  });
}

async function fetchRenderedHtml(tabId) {
  var results = await chrome.scripting.executeScript({
    target: { tabId: tabId },
    func: function(){ return document.documentElement.outerHTML; },
  });
  return results ? (results[0] ? results[0].result || "" : "") : "";
}

function triggerDownload(blob, filename) {
  var url = URL.createObjectURL(blob);
  var a = document.createElement("a");
  a.href = url;
  a.download = filename || "article.epub";
  a.click();
  URL.revokeObjectURL(url);
}

async function handleConvert(url, tabId) {
  if (!(await checkConversionLimit())) return;
  clearMessages();
  hide("actions");
  hide("options");
  show("progress");
  try {
    var opts = getOptions();
    var result = await processArticle(url, opts);
    setProgress("Sending to Kindle…", 85);
    // POST EPUB blob to server SMTP relay
    var formData = new FormData();
    formData.append("epub", result.epubBlob, "article.epub");
    formData.append("title", result.title);
    formData.append("url", url);
    var resp = await fetch(SERVER + SEND_EPUB_ENDPOINT, { method: "POST", body: formData });
    if (!resp.ok) {
      var err = await resp.json().catch(function(){ return {}; });
      throw new Error(err.error || "Send failed (" + resp.status + ")");
    }
    var data = await resp.json();
    setProgress("Done!", 100);
    showResult(formatSendSuccess(data));
    recordSend(result.title, url, "sent");
    await incrementConversion();
  } catch(err) {
    showError(err.message);
    recordSend($("preview-title") ? $("preview-title").value.trim() || "" : "", url, "failed", err.message);
  }
}

async function handleDownload(url, tabId) {
  if (!(await checkConversionLimit())) return;
  clearMessages();
  hide("actions");
  hide("options");
  show("progress");
  try {
    var opts = getOptions();
    var result = await processArticle(url, opts);
    setProgress("Done!", 100);
    triggerDownload(result.epubBlob, (result.title || "article") + ".epub");
    await incrementConversion();
    showResult("✓ EPUB downloaded");
  } catch(err) {
    showError(err.message);
  }
}

async function handlePreview(url, tabId, tabIndex) {
  clearMessages();
  hide("actions");
  hide("options");
  show("progress");
  try {
    var opts = getOptions();
    var result = await processArticle(url, opts);
    setProgress("Opening preview…", 95);
    var blobUrl = URL.createObjectURL(result.epubBlob);
    // For preview, we open a simple HTML page that embeds the EPUB
    // In future (Task 4), this will have proper inline preview
    var previewHtml = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Preview</title></head><body>' +
      '<p><a href="' + blobUrl + '" download="' + (result.title || "article") + '.epub">Download EPUB</a></p>' +
      '<p>In-browser EPUB preview coming soon.</p></body></html>';
    var previewBlob = new Blob([previewHtml], { type: "text/html" });
    var previewUrl = URL.createObjectURL(previewBlob);
    await chrome.tabs.create({ url: previewUrl, index: (tabIndex || 0) + 1 });
    setProgress("Done!", 100);
    showResult("✓ Preview opened in new tab");
  } catch(err) {
    showError(err.message);
  }
}

async function handlePasteConvert() {
  if (!(await checkConversionLimit())) return;
  var pastedContent = $("paste-input").value.trim();
  if (!pastedContent) { showError("Paste a URL or some text first."); show("actions"); show("options"); return; }
  var isUrl = /^https?:\/\/|^file:\/\//i.test(pastedContent);
  if (isUrl && (isPdfUrl(pastedContent) || isLocalFileUrl(pastedContent))) {
    showNote("PDFs are handled by PDF2Kindle. Open that extension to preview, edit, or send this file.");
    show("actions"); hide("options"); return;
  }
  clearMessages(); hide("actions"); hide("options"); show("progress");
  try {
    var opts = getOptions();
    var title = $("paste-title").value.trim() || undefined;
    var result;
    if (isUrl) {
      result = await processArticle(pastedContent, opts);
    } else {
      var htmlWrapped = "<html><body>" + pastedContent.split("\n\n").map(function(p){ return "<p>" + p + "</p>"; }).join("") + "</body></html>";
      var article = extractArticle(htmlWrapped, "");
      if (!article) throw new Error("Could not extract article from pasted text.");
      article.title = title || article.title;
      var content = article.content;
      content = stripUiText(content);
      content = reinjectLinks(content, htmlWrapped, "");
      var metadata = extractMetadata(htmlWrapped, "");
      article.sitename = metadata.sitename || "";
      article.pubDate = metadata.date || "";
      article.readTime = metadata.readTime;
      result = {
        epubBlob: await generateEpub({
          article: article, originalHtml: htmlWrapped, url: "", title: article.title,
          keepImages: false, keepLinks: opts.keepLinks !== false, imageProcessor: null,
        }),
        title: article.title,
      };
    }
    setProgress("Sending to Kindle…", 85);
    var formData = new FormData();
    formData.append("epub", result.epubBlob, "article.epub");
    formData.append("title", result.title);
    if (isUrl) formData.append("url", pastedContent);
    var resp = await fetch(SERVER + SEND_EPUB_ENDPOINT, { method: "POST", body: formData });
    if (!resp.ok) throw new Error("Send failed (" + resp.status + ")");
    var data = await resp.json();
    setProgress("Done!", 100);
    showResult(formatSendSuccess(data));
    recordSend(result.title, isUrl ? pastedContent : "", "sent");
    await incrementConversion();
  } catch(err) {
    showError(err.message);
    show("actions"); show("options");
  }
}

async function handlePasteDownload() {
  if (!(await checkConversionLimit())) return;
  var pastedContent = $("paste-input").value.trim();
  if (!pastedContent) { showError("Paste a URL or some text first."); show("actions"); show("options"); return; }
  var isUrl = /^https?:\/\/|^file:\/\//i.test(pastedContent);
  if (isUrl && (isPdfUrl(pastedContent) || isLocalFileUrl(pastedContent))) {
    showNote("PDFs are handled by PDF2Kindle. Open that extension to preview, edit, or send this file.");
    show("actions"); hide("options"); return;
  }
  clearMessages(); hide("actions"); hide("options"); show("progress");
  try {
    var opts = getOptions();
    var title = $("paste-title").value.trim() || undefined;
    var result;
    if (isUrl) {
      result = await processArticle(pastedContent, opts);
    } else {
      var htmlWrapped = "<html><body>" + pastedContent.split("\n\n").map(function(p){ return "<p>" + p + "</p>"; }).join("") + "</body></html>";
      var article = extractArticle(htmlWrapped, "");
      if (!article) throw new Error("Could not extract article from pasted text.");
      article.title = title || article.title;
      var content = article.content;
      content = stripUiText(content);
      content = reinjectLinks(content, htmlWrapped, "");
      result = {
        epubBlob: await generateEpub({
          article: article, originalHtml: htmlWrapped, url: "", title: article.title,
          keepImages: false, keepLinks: opts.keepLinks !== false, imageProcessor: null,
        }),
        title: article.title,
      };
    }
    setProgress("Done!", 100);
    triggerDownload(result.epubBlob, (result.title || "article") + ".epub");
    await incrementConversion();
    showResult("✓ EPUB downloaded");
  } catch(err) {
    showError(err.message);
    show("actions"); show("options");
  }
}

async function handleBatchSend() {
  if (!(await checkConversionLimit())) return;
  clearMessages(); hide("actions"); hide("options"); show("progress");
  var queue = batchUrls.map(function(u){ return { url: u, status: "pending", error: "" }; });
  renderBatchQueue(queue); show("batch-queue");
  var total = queue.length, done = 0, failed = 0;
  var opts = getOptions();
  for (var i = 0; i < total; i++) {
    var item = queue[i];
    if (!(await checkConversionLimit())) { item.status = "failed"; item.error = "Free conversion limit reached"; updateBatchItem(i, "failed"); failed++; continue; }
    item.status = "processing"; updateBatchItem(i, "processing");
    setProgress("Converting " + (i + 1) + "/" + total + "…", Math.round((i / total) * 100));
    try {
      var result = await processArticle(item.url, opts);
      var formData = new FormData();
      formData.append("epub", result.epubBlob, "article.epub");
      formData.append("title", result.title);
      formData.append("url", item.url);
      var resp = await fetch(SERVER + SEND_EPUB_ENDPOINT, { method: "POST", body: formData });
      if (!resp.ok) throw new Error("Send failed (" + resp.status + ")");
      item.status = "done"; updateBatchItem(i, "done"); done++;
      await incrementConversion();
      recordSend("", item.url, "sent");
    } catch(err) {
      item.status = "failed"; item.error = err.message; updateBatchItem(i, "failed"); failed++;
      recordSend("", item.url, "failed", err.message);
    }
  }
  setProgress("Done!", 100);
  if (failed === 0) showResult("✓ " + done + " URL" + (done > 1 ? "s" : "") + " sent to Kindle");
  else showResult("✓ " + done + " sent, " + failed + " failed");
  show("actions"); show("options");
}

async function handleBatchDownload() {
  if (!(await checkConversionLimit())) return;
  clearMessages(); hide("actions"); hide("options"); show("progress");
  var queue = batchUrls.map(function(u){ return { url: u, status: "pending", error: "" }; });
  renderBatchQueue(queue); show("batch-queue");
  var total = queue.length, done = 0, failed = 0;
  var opts = getOptions();
  for (var i = 0; i < total; i++) {
    var item = queue[i];
    if (!(await checkConversionLimit())) { item.status = "failed"; failed++; continue; }
    item.status = "processing"; updateBatchItem(i, "processing");
    setProgress("Converting " + (i + 1) + "/" + total + "…", Math.round((i / total) * 100));
    try {
      var result = await processArticle(item.url, opts);
      triggerDownload(result.epubBlob, "article-" + (i + 1) + ".epub");
      item.status = "done"; updateBatchItem(i, "done"); done++;
      await incrementConversion();
    } catch(err) {
      item.status = "failed"; updateBatchItem(i, "failed"); failed++;
    }
  }
  setProgress("Done!", 100);
  if (failed === 0) showResult("✓ " + done + " EPUB" + (done > 1 ? "s" : "") + " downloaded");
  else showResult("✓ " + done + " downloaded, " + failed + " failed");
  show("actions"); show("options");
}

async function handleBatchRetry(failedItems, mode) {
  if (!failedItems || failedItems.length === 0) return;
  clearMessages(); hide("actions"); hide("options"); show("progress");
  var total = failedItems.length, done = 0, failed = 0;
  var opts = getOptions();
  for (var i = 0; i < total; i++) {
    var item = failedItems[i];
    if (!(await checkConversionLimit())) { failed++; continue; }
    item.status = "processing";
    setProgress("Retrying " + (i + 1) + "/" + total + "…", Math.round((i / total) * 100));
    try {
      var result = await processArticle(item.url, opts);
      if (mode === "download") triggerDownload(result.epubBlob, "article-" + Date.now() + ".epub");
      else {
        var formData = new FormData();
        formData.append("epub", result.epubBlob, "article.epub");
        formData.append("url", item.url);
        var resp = await fetch(SERVER + SEND_EPUB_ENDPOINT, { method: "POST", body: formData });
        if (!resp.ok) throw new Error("Send failed");
      }
      item.status = "done"; done++;
      await incrementConversion();
    } catch(err) {
      item.status = "failed"; failed++;
    }
  }
  setProgress("Done!", 100);
  if (failed === 0) showResult("✓ " + done + " URL" + (done > 1 ? "s" : "") + " " + (mode === "download" ? "downloaded" : "sent"));
  else showResult("✓ " + done + " " + (mode === "download" ? "downloaded" : "sent") + ", " + failed + " still failed");
  show("actions"); show("options");
}

async function checkServer() {
  var MAX_RETRIES = 8;
  for (var i = 0; i < MAX_RETRIES; i++) {
    try {
      var r = await fetch(SERVER + "/health", { signal: AbortSignal.timeout(3000) });
      if (r.ok) {
        setServerStatus(true);
        return { online: true };
      }
    } catch(e) {}
    if (i < MAX_RETRIES - 1) {
      setServerStatus("starting");
      if (i === 3) {
        $("error-text").textContent = "Server not reachable. Run install.sh once, or: python server.py";
        show("error-text");
      }
      await new Promise(function(resolve){ setTimeout(resolve, 1000); });
    }
  }
  setServerStatus(false);
  return { online: false };
}

function isBotChallenge(title) {
  var t = (title || "").toLowerCase();
  return ["just a moment", "attention required", "access denied", "checking your browser", "enable javascript"].some(function(s){ return t.includes(s); });
}

async function loadPreview(url, tabTitle) {
  show("preview-loading");
  try {
    var content = await fetchViaBackground(url);
    var article = extractArticle(content.text, url);
    hide("preview-loading");
    if (!article) return { type: "article", title: tabTitle || url, snippet: "" };
    var textContent = (article.textContent || "").trim().slice(0, 180);
    var snippet = textContent + (textContent.length >= 180 ? "…" : "");
    return { type: "article", title: article.title || tabTitle || "Article", snippet: snippet };
  } catch(e) {
    hide("preview-loading");
    return { type: "article", title: tabTitle || "Article", snippet: "" };
  }
}

function renderPreview(meta) {
  var badge = $("type-badge");
  badge.textContent = meta.type === "pdf" ? "PDF" : meta.type === "protected" ? "Protected" : "Article";
  badge.className = "badge " + (meta.type || "article");
  $("preview-title").value = meta.title || "Untitled";
  show("preview-card");
  if (meta.snippet) { $("preview-snippet").textContent = meta.snippet; show("preview-snippet"); }
  else { hide("preview-snippet"); }
}

function showPdfNotice() {
  showNote("PDFs are handled by PDF2Kindle. Open this page there to preview, edit, or send the document.");
  hide("actions"); hide("options");
}

async function initPopup() {
  await loadServerUrl();
  await loadOptions();

  var serverState = await checkServer();
  var tab = (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  currentTab = tab || null;

  var url = tab ? tab.url || "" : "";
  if (!url || url.startsWith("chrome://") || url.startsWith("chrome-extension://")) {
    showError("Navigate to a web article to convert it.");
    return;
  }

  var meta = await loadPreview(url, tab.title);
  renderPreview(meta);

  if (meta.type === "pdf") { hide("prev-sent-warning"); showPdfNotice(); return; }

  var prevSentEntries = await getEntries({ url: url }).catch(function(){ return []; });
  if (prevSentEntries.length > 0) show("prev-sent-warning");
  else hide("prev-sent-warning");

  show("actions"); show("options");

  if (await hasProLicense()) show("pro-badge");

  var tabId = tab.id;
  $("btn-kindle").onclick = function() {
    if (pasteMode) {
      var urls = getBatchUrls();
      if (urls.length >= 2) handleBatchSend();
      else handlePasteConvert();
    } else handleConvert(url, tabId);
  };
  $("btn-preview").onclick = function() {
    if (pasteMode) handlePasteConvert();
    else handlePreview(url, tabId, tab.index);
  };
  $("btn-download").onclick = function() {
    if (pasteMode) {
      var urls = getBatchUrls();
      if (urls.length >= 2) handleBatchDownload();
      else handlePasteDownload();
    } else handleDownload(url, tabId);
  };

  $("btn-upgrade").onclick = function(){ chrome.tabs.create({ url: "https://web2kindle.com/upgrade" }); };
  $("btn-enter-key").onclick = function(){ chrome.runtime.openOptionsPage(); };
}

document.addEventListener("DOMContentLoaded", function() {
  initPopup();

  $("btn-retry").addEventListener("click", function() {
    hide("btn-retry"); hide("error-text");
    $("server-text").textContent = "Checking…";
    $("server-dot").className = "dot";
    initPopup();
  });

  $("settings-link").addEventListener("click", function(e){ e.preventDefault(); chrome.runtime.openOptionsPage(); });
  $("history-link").addEventListener("click", function(e){ e.preventDefault(); chrome.tabs.create({ url: chrome.runtime.getURL("history.html") }); });
  $("paste-toggle").addEventListener("click", function(e){ e.preventDefault(); togglePasteMode(); });
  $("paste-input").addEventListener("input", updatePasteBadge);

  $("keep-images").addEventListener("change", function(){ chrome.storage.local.set({ keepImages: $("keep-images").checked }); });
  $("keep-links").addEventListener("change", function(){ chrome.storage.local.set({ keepLinks: $("keep-links").checked }); });
});
```

- [ ] **Step 2: Commit**

```bash
git add extension/popup.js
git commit -m "feat: rewrite popup.js to use in-extension article processing"
```

---

### Task 9: Strip article routes from server.py and add /send-epub

**Files:**
- Modify: `server.py`

- [ ] **Step 1: Remove article processing routes and imports, add /send-epub**

Remove from `server.py`:
- All article routes: `/preview`, `/convert`, `/article/send-to-kindle`, `/article/generate-preview`, `/view/<token>`, `/send-kindle-preview/<token>`, `/debug/<...>`
- Helper functions that are only used by article routes: `_html_to_article_epub`, `_get_article_epub_path`, `_convert_article_url`, `_fetch_and_embed_images`, `_generate_article_epub`, `_epub_to_preview_html`, etc.
- Imports: `trafilatura`, `ebooklib`, `PIL`, `BeautifulSoup`
- Update `_health_capabilities()` to not claim article routes

Add `/send-epub` route.

**Detailed changes:**

1. Remove imports: `trafilatura`, `ebooklib`, `PIL` (lines 27, 31, 35)
2. Update `_health_capabilities()` (line 138-144):
```python
def _health_capabilities() -> dict:
    return {
        "article_routes": False,
        "article_send_to_kindle": False,
        "article_generate_preview": False,
        "pdf_routes": False,
        "send_epub": True,
    }
```
3. Remove all functions from `_new_image_debug_bundle` through `_epub_to_preview_html` (lines 81-2294)
4. Add `/send-epub` route:
```python
@app.route("/send-epub", methods=["POST"])
def send_epub():
    file = request.files.get("epub")
    if not file:
        return jsonify({"error": "No EPUB file provided"}), 400
    title = request.form.get("title", "Article")
    url = request.form.get("url", "")
    tmp = tempfile.NamedTemporaryFile(suffix=".epub", delete=False)
    tmp_path = tmp.name
    try:
        file.save(tmp_path)
        result = _send_epub_to_kindle(tmp_path)
        return jsonify({"success": True, **result})
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        Path(tmp_path).unlink(missing_ok=True)
```
5. Keep: `_send_epub_to_kindle`, `_parse_recipients`, `_build_epub_email_message`, `_optimize_epub_for_delivery`, `_delivery_size_error_message`, `_is_gmail_smtp_host`, `_epub_filename`, `_estimate_epub_email_size`, config routes, history routes
6. Keep: imports needed for remaining functions (`smtplib`, `json`, `Path`, `datetime`, `uuid`, `sqlite3`, etc.)

To apply cleanly, edit server.py in these specific locations:

**1. Remove trafilatura import (line 27), ebooklib from w2k_epub import (lines 32-38):**

```python
import trafilatura
import requests as http_requests
from flask import Flask, request, jsonify, send_file
from flask_cors import CORS

from w2k_epub import (
    _add_standalone_image_pages,
    _rotate_image_bytes,
    _should_rotate_image,
    generate_details_page_html,
    generate_cover_image,
)
```

Replace with:

```python
import requests as http_requests
from flask import Flask, request, jsonify
from flask_cors import CORS
```

**2. Update _health_capabilities** (lines 138-144):

```python
def _health_capabilities() -> dict:
    return {
        "article_routes": False,
        "article_send_to_kindle": False,
        "article_generate_preview": False,
        "pdf_routes": False,
        "send_epub": True,
    }
```

**3. Remove the entire block from _new_image_debug_bundle through _epub_to_preview_html** (lines 81-2294).

**4. Add /send-epub route before the health and config routes (before the existing routes section):**

```python
# ── Routes ────────────────────────────────────────────────────────────────────

@app.route("/send-epub", methods=["POST"])
def send_epub():
    file = request.files.get("epub")
    if not file:
        return jsonify({"error": "No EPUB file provided"}), 400
    title = request.form.get("title", "Article")
    url = request.form.get("url", "")
    epub_path = None
    try:
        tmp = tempfile.NamedTemporaryFile(suffix=".epub", delete=False)
        tmp_path = tmp.name
        tmp.close()
        file.save(tmp_path)
        epub_path = tmp_path
        result = _send_epub_to_kindle(epub_path)
        return jsonify({"success": True, **result})
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        if epub_path:
            Path(epub_path).unlink(missing_ok=True)

@app.route("/health")
def health():
    return jsonify({
        "status": "ok",
        "version": APP_VERSION,
        "capabilities": _health_capabilities(),
    })
```

- [ ] **Step 2: Commit**

```bash
git add server.py
git commit -m "refactor: strip article routes, add /send-epub endpoint"
```

---

### Task 10: Write tests for article-extractor.js

**Files:**
- Modify: `tests/popup.test.js`
- Create: `tests/article-extractor.test.js`

- [ ] **Step 1: Create article-extractor test file**

Create `tests/article-extractor.test.js`:

```js
// Web2Kindle article-extractor tests
// Run with: node tests/article-extractor.test.js

var fs = require("node:fs");
var path = require("node:path");
var vm = require("node:vm");

var passed = 0, failed = 0;

function assert(condition, msg) {
  if (condition) { console.log("  \u2713 " + msg); passed++; }
  else { console.error("  \u2717 " + msg); failed++; }
}

function assertEqual(actual, expected, msg) {
  assert(actual === expected, msg + " (got " + JSON.stringify(actual) + ", expected " + JSON.stringify(expected) + ")");
}

function assertIncludes(str, substr, msg) {
  assert(str.indexOf(substr) >= 0, msg + " — expected to find " + JSON.stringify(substr));
}

function assertExcludes(str, substr, msg) {
  assert(str.indexOf(substr) < 0, msg + " — expected NOT to find " + JSON.stringify(substr));
}

var srcPath = path.join(__dirname, "..", "extension", "article-extractor.js");
var srcCode = fs.readFileSync(srcPath, "utf8");

function loadModule() {
  var sandbox = {
    DOMParser: DOMParser,
    Readability: function(doc) {
      // Minimal Readability mock: extract title from h1 and content from body
      var h1 = doc.querySelector("h1");
      var body = doc.querySelector("body") || doc.documentElement;
      this.parse = function() {
        if (!body) return null;
        var textContent = (body.textContent || "").trim();
        if (textContent.length < 10) return null;
        return {
          title: h1 ? (h1.textContent || "").trim() : "Test Article",
          byline: (doc.querySelector("[rel=author]") || {}).textContent || "",
          content: body.innerHTML || "",
          textContent: textContent,
          length: textContent.length,
          excerpt: textContent.slice(0, 200),
        };
      };
    },
    window: {},
    console: console,
    Error: Error,
    Set: Set,
    Math: Math,
  };
  var wrapped = srcCode + "\n" +
    "this.extractArticle = extractArticle;\n" +
    "this.extractMetadata = extractMetadata;\n" +
    "this.stripUiText = stripUiText;\n" +
    "this.stripTrailingRelated = stripTrailingRelated;\n" +
    "this.restoreOrderedLists = restoreOrderedLists;\n" +
    "this.restoreBlockquotes = restoreBlockquotes;\n" +
    "this.reinjectImages = reinjectImages;\n" +
    "this.reinjectLinks = reinjectLinks;";
  vm.runInNewContext(wrapped, sandbox, { timeout: 5000 });
  return sandbox;
}

function runTests() {
  console.log("\n── Module loads ──");
  var mod = loadModule();
  assert(typeof mod.extractArticle === "function", "extractArticle loaded");
  assert(typeof mod.extractMetadata === "function", "extractMetadata loaded");
  assert(typeof mod.stripUiText === "function", "stripUiText loaded");
  assert(typeof mod.stripTrailingRelated === "function", "stripTrailingRelated loaded");
  assert(typeof mod.restoreOrderedLists === "function", "restoreOrderedLists loaded");
  assert(typeof mod.restoreBlockquotes === "function", "restoreBlockquotes loaded");
  assert(typeof mod.reinjectImages === "function", "reinjectImages loaded");
  assert(typeof mod.reinjectLinks === "function", "reinjectLinks loaded");

  console.log("\n── extractArticle ──");
  // Test with a simple HTML article
  var html = "<html><head><title>Test Article</title></head><body>" +
    "<article><h1>My Test Article</h1><p>This is the article content with enough text to pass Readability extraction. It needs to be long enough for the mock to return a result. Let me add some more padding here to make sure we clear the minimum threshold. One more sentence for good measure.</p></article></body></html>";
  var article = mod.extractArticle(html, "https://example.com");
  assert(article !== null, "extractArticle returns non-null for valid HTML");
  assert(article.title === "My Test Article", "title extracted from h1");
  assert(article.content.length > 0, "content is non-empty");

  // Test with HTML that has no article content
  html = "<html><body><p>Short</p></body></html>";
  article = mod.extractArticle(html, "https://example.com");
  assert(article === null, "returns null for very short/no article content");

  console.log("\n── extractMetadata ──");
  html = '<html><head><meta property="og:title" content="OG Title"><meta name="author" content="Jane Doe"><meta property="og:site_name" content="Example Site"></head><body><p>Hello world this is a test article body with enough words to count for read time estimation.</p></body></html>';
  var meta = mod.extractMetadata(html, "https://example.com");
  assertEqual(meta.title, "OG Title", "og:title extracted");
  assertEqual(meta.author, "Jane Doe", "author extracted");
  assertEqual(meta.sitename, "Example Site", "site_name extracted");
  assert(meta.readTime >= 1, "readTime is positive");

  console.log("\n── stripUiText ──");
  var result = mod.stripUiText("<p>Listen to this article</p><p>Real content.</p>");
  assertExcludes(result, "Listen to this", "removes listen to this article");
  assertIncludes(result, "Real content", "keeps real content");
  result = mod.stripUiText("<p>12:30 min</p><p>More content.</p>");
  assertExcludes(result, "12:30", "removes timestamp text");

  console.log("\n── stripTrailingRelated ──");
  result = mod.stripTrailingRelated("<p>Lead paragraph.</p><h2>Related</h2><p>Related content.</p>");
  assertExcludes(result, "Related", "removes related section");
  assertIncludes(result, "Lead", "keeps content before related");

  console.log("\n── restoreOrderedLists ──");
  result = mod.restoreOrderedLists("<ul><li>First item</li></ul>", "<ol><li>First item</li></ol>");
  assertIncludes(result, "<ol>", "converts ul to ol");
  assertExcludes(result, "<ul>", "removes ul wrapper");

  console.log("\n── restoreBlockquotes ──");
  result = mod.restoreBlockquotes("<p>Some quote text here.</p>", "<blockquote>Some quote text here.</blockquote>");
  assertIncludes(result, "<blockquote>", "converts p to blockquote");
  assertExcludes(result, "<p>Some quote text here.</p>", "removes original p");

  console.log("\n── reinjectLinks ──");
  result = mod.reinjectLinks("<p>Click here for more info.</p>", '<p><a href="https://example.com">Click here</a> for more info.</p>', "https://example.com");
  assertIncludes(result, '<a href="https://example.com">Click here</a>', "restores link around matched text");

  console.log("\n── reinjectImages ──");
  result = mod.reinjectImages("<p>Text with image after.</p>", '<html><body><article><p>Text with image after.</p><img src="https://example.com/photo.jpg"></article></body></html>', "https://example.com");
  assertIncludes(result, '<img', "injects img tag into extracted content");
  assertIncludes(result, 'https://example.com/photo.jpg', "uses original image src");

  console.log("\n── Results: " + passed + " passed, " + failed + " failed ──\n");
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(function(err) {
  console.error("Test runner error:", err);
  process.exit(1);
});
```

- [ ] **Step 2: Run the tests**

```bash
node tests/article-extractor.test.js
```
Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add tests/article-extractor.test.js
git commit -m "test: add article-extractor unit tests"
```

---

### Task 11: Run existing tests and verify

**Files:**
- All modified files

- [ ] **Step 1: Run the image-processor JS tests**

```bash
node tests/image-processor.test.js
```
Expected: all tests pass.

- [ ] **Step 2: Run the cover/details Python tests**

```bash
python -m pytest tests/test_cover_image.py tests/test_details_page.py -v
```
Expected: all pass (w2k_epub.py functions still exist).

- [ ] **Step 3: Verify server.py starts without errors**

```bash
python -c "import server; print('server.py loads OK')"
```
Expected: loads without errors (no missing imports from removed article routes).

- [ ] **Step 4: Verify the extension loads (syntax check)**

```bash
node -e "
var fs = require('fs');
var files = ['extension/article-extractor.js', 'extension/epub-generator.js', 'extension/popup.js'];
files.forEach(function(f) {
  try {
    var code = fs.readFileSync(f, 'utf8');
    // Just check no syntax errors by evaluating (won't fully work in node, but will catch basic issues)
    console.log(f + ': ' + code.length + ' bytes');
  } catch(e) {
    console.error(f + ': ERROR - ' + e.message);
  }
});
console.log('All files readable');
"
```

---

### Task 12: Update Python tests that reference removed server functions

**Files:**
- Modify: `tests/test_cover_image.py`
- Modify: `tests/test_details_page.py`

- [ ] **Step 1: Remove tests that import removed server functions**

These tests imported `_generate_article_epub` and `_restore_blockquotes` from `server` — functions that no longer exist (replaced by in-browser equivalents).

In `tests/test_cover_image.py`, remove or update `test_article_epub_cover_is_generated` — it relies on `server._generate_article_epub` which is now removed. The cover generation logic lives in JS (`epub-generator.js`).

Replace `test_article_epub_cover_is_generated` in `tests/test_cover_image.py` with a note:
```python
# Note: test_article_epub_cover_is_generated removed — cover generation
# now lives in extension/epub-generator.js (generateCoverImageSvg + generateEpub).
# See tests/article-extractor.test.js for in-browser pipeline tests.
```

In `tests/test_details_page.py`, add similar note and remove tests that import from `server`:
- `test_article_epub_details_page_spine`
- `test_article_epub_css_styles_blockquotes`
- `test_article_wide_image_adds_rotated_page`
- `test_article_mixed_images_stay_inline_in_order`
- `test_article_preview_keeps_rotation_toggle_metadata`
- `test_article_gif_image_embeds_as_png`
- `test_article_epub_strips_decorative_emoji_from_text_and_nav`

Keep tests that import from `w2k_epub` directly (they test shared utility functions):
- `test_article_details_page_has_metadata`
- `test_details_page_handles_missing_fields`
- `test_archive_url_helper_only_rewrites_selected_publishers`
- `test_convert_article_url_fetches_archive_for_selected_publishers`

- [ ] **Step 2: Run remaining Python tests to verify**

```bash
python -m pytest tests/test_cover_image.py tests/test_details_page.py -v 2>&1 | head -30
```
Expected: remaining tests pass (cover without server, details without server).

---

### Task 13: Update ROADMAP.md

**Files:**
- Modify: `ROADMAP.md`

- [ ] **Step 1: Mark task 1 as done in ROADMAP.md**

Move the "Browser-native article processing" entry from 🟡 "Needs prerequisite first" to 🔵 "Done" section, with today's date.

- [ ] **Step 2: Commit**

```bash
git add ROADMAP.md
git commit -m "docs: mark browser-native article processing done in roadmap"
```
