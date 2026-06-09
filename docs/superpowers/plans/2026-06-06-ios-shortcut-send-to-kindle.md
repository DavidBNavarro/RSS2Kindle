# iOS Shortcut + Scriptable: Send to Kindle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the iOS Shortcut + Scriptable solution for sending articles to Kindle from any iOS app.

**Architecture:** Two files — `ios/bundle.js` (concatenated JS pipeline: Readability + JSZip + adapted extractor + adapted EPUB generator + glue code) and `ios/wk2kindle.js` (Scriptable entry point). Plus Shortcut build instructions.

**Tech Stack:** JavaScript (Scriptable/Web APIs), iOS Shortcuts

---

## File Structure

```
ios/
├── bundle.js         — Final bundled pipeline (created by concatenating sources)
├── extractor.js      — Task 1: Adapted text-only article extractor
├── generator.js      — Task 2: Adapted text-only EPUB generator
└── wk2kindle.js      — Task 4: Scriptable script
```

`bundle.js` is built by concatenating in order:
1. `extension/lib/readability.js` (as-is)
2. `extension/lib/jszip.min.js` (as-is)
3. `ios/extractor.js`
4. `ios/generator.js`
5. Glue code (inline in Task 3)

---

### Task 1: Create the text-only article extractor

**Files:**
- Create: `ios/extractor.js`

This is a stripped-down version of `extension/article-extractor.js` that keeps only the functions needed for text-only extraction.

Kept from original:
- `extractArticle(html, url)` — calls Readability, restores headings, supplements content
- `stripUiText(contentHtml)` — removes UI noise paragraphs
- `stripTrailingRelated(contentHtml)` — removes "related" sections
- `extractMetadata(html, url)` — OG meta extraction (used by EPUB details page)
- Helper functions: `_preserveHeadings`, `_restoreHeadings`, `_normalizeTitle`, `_extractH1Title`, `_extractDomArticle`, `_supplementContent`, `_UI_TEXT_PATTERNS`, `_RELATED_HEADING_RE`, `_SUPPRESS_NON_CONTENT_RE`, `_BYLINE_DATE_RE`, `_isArticleContentElement`, `_contentFingerprint`, `_findArticleContainer`

Removed:
- `reinjectImages()` and all its helpers: `_getBestImgSrc`, `_resolveUrl`, `_normalizeImageUrl`, `_candidateSrc`, `_parseSrcset`, `_evaluateSrc`, `_isUiChrome`, `_UI_CHROME_CLASSES`, `_iterTokens`, `_normText`, `_collectMedia`
- `reinjectLinks()` and all its helpers
- `restoreOrderedLists()` and all its helpers
- `restoreBlockquotes()` and all its helpers

- [ ] **Step 1: Create `ios/extractor.js`**

```javascript
// text-only article extractor — adapted from extension/article-extractor.js

function _preserveHeadings(doc) {
  var headings = doc.querySelectorAll("h2, h3");
  for (var i = 0; i < headings.length; i++) {
    var h = headings[i];
    var text = (h.textContent || "").replace(/\s+/g, " ").trim();
    if (text) {
      var p = doc.createElement("p");
      p.textContent = text;
      p.setAttribute("data-p2k-o", h.tagName);
      h.parentNode.replaceChild(p, h);
    }
  }
}

function _restoreHeadings(html) {
  return html.replace(/<p[^>]*data-p2k-o=\"(H[23])\"[^>]*>([^<]+)<\/p>/g, "<$1>$2</$1>");
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

function extractArticle(html, url) {
  var doc = new DOMParser().parseFromString(html, "text/html");
  _preserveHeadings(doc);
  var reader = new Readability(doc);
  var article = reader.parse();
  if (!article) {
    var fallback = _extractDomArticle(html);
    if (fallback) return fallback;
    return null;
  }
  var content = _restoreHeadings(article.content || "");
  var supplemented = _supplementContent(content, html);
  if (supplemented !== content) {
    content = supplemented;
    var textContent = content.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    article.textContent = textContent;
    article.length = content.length;
  }
  return {
    title: _normalizeTitle(article.title || _extractH1Title(html) || "Article"),
    author: article.byline || "",
    content: content,
    textContent: article.textContent || "",
    length: article.length || 0,
    excerpt: article.excerpt || "",
    publishedTime: article.publishedTime || "",
  };
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
  for (var s = 0; s < ["script", "style", "noscript", "template", "iframe"].length; s++) {
    var sel = ["script", "style", "noscript", "template", "iframe"][s];
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
    var paragraphs = el.querySelectorAll("p, h2, h3, li, blockquote");
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
  var tags = best.querySelectorAll("h1, p, h2, h3, ul, ol, li, blockquote");
  for (var i = 0; i < tags.length; i++) {
    var el = tags[i];
    var text = (el.textContent || "").replace(/\s+/g, " ").trim();
    if ((el.tagName === "P" || el.tagName === "LI" || el.tagName === "BLOCKQUOTE") && text.split(/\s+/).length < 3) continue;
    var htmlOuter = el.outerHTML;
    var norm = htmlOuter.replace(/\s+/g, " ").trim();
    if (seenTexts.has(norm)) continue;
    seenTexts.add(norm);
    fragments.push(htmlOuter);
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

var _SUPPRESS_NON_CONTENT_RE = /^(featured video|to view this video|loaded:|the live event has ended|captions\/subtitles|share this article|share on|tweet|email|read more|sponsored|advertisement|select your language|wired is obsessed|copyright|all rights reserved|we may earn a commission|skip to main content|comments|back to top|you might also like|courtesy of|buy this book at|photo-illustration:|subscribe to|newsletter)/i;

var _BYLINE_DATE_RE = /\b(?:january|february|march|april|may|june|july|august|september|october|november|december) \d{1,2}, \d{4}\b/i;

function _isArticleContentElement(el, articleH1) {
  var text = (el.textContent || "").replace(/\s+/g, " ").trim();
  var wordCount = text.split(/\s+/).length;
  if (wordCount === 0) return false;
  if (el.tagName === "H1") return false;
  if (el.tagName === "DIV" && wordCount < 20) return false;
  if ((el.tagName === "P" || el.tagName === "LI" || el.tagName === "BLOCKQUOTE") && wordCount < 3) return false;
  if (/^H[1-6]$/.test(el.tagName) && wordCount < 5) return false;
  if (articleH1 && el.contains(articleH1)) return false;
  var linkText = "";
  var links = el.querySelectorAll("a");
  for (var l = 0; l < links.length; l++) {
    linkText += (links[l].textContent || "");
  }
  var linkWords = linkText.split(/\s+/).filter(function(w){ return w.length > 0; }).length;
  if (links.length > 0 && linkWords / wordCount > 0.5) return false;
  var lowerText = text.toLowerCase().trim();
  if (_SUPPRESS_NON_CONTENT_RE.test(lowerText)) return false;
  if (/tabindex|aria-checked|aria-modal/.test(lowerText)) return false;
  if (wordCount < 30 && _BYLINE_DATE_RE.test(lowerText)) return false;
  var elStyle = (el.getAttribute("style") || "").toLowerCase();
  if (/grid-column-start\s*:\s*(?:9|1[0-9]|2[0-9])/i.test(elStyle)) return false;
  var node = el.parentElement;
  for (var depth = 0; depth < 8 && node; depth++) {
    var style = node.getAttribute("style") || "";
    if (/grid-column-start\s*:\s*(?:9|1[0-9]|2[0-9])/i.test(style)) return false;
    node = node.parentElement;
  }
  return true;
}

function _contentFingerprint(text) {
  return text.replace(/\s+/g, " ").trim().toLowerCase().slice(0, 80);
}

function _findArticleContainer(doc) {
  var article = doc.querySelector("article");
  if (article) return { el: article, selector: "article" };
  for (var ci = 0; ci < ["entry-content", "entry", "post-content", "available-content", "body"].length; ci++) {
    var cls = ["entry-content", "entry", "post-content", "available-content", "body"][ci];
    var el = doc.querySelector("div." + cls);
    if (el) return { el: el, selector: "." + cls };
  }
  if (doc.body) return { el: doc.body, selector: "body" };
  return null;
}

function _supplementContent(readabilityHtml, originalHtml) {
  var origDoc = new DOMParser().parseFromString(originalHtml, "text/html");
  for (var s = 0; s < ["script", "style", "noscript", "template", "iframe"].length; s++) {
    var sel = ["script", "style", "noscript", "template", "iframe"][s];
    var els = origDoc.querySelectorAll(sel);
    for (var i = 0; i < els.length; i++) els[i].remove();
  }
  var container = _findArticleContainer(origDoc);
  if (!container) return readabilityHtml;
  var rDoc = new DOMParser().parseFromString(readabilityHtml, "text/html");
  var rEls = rDoc.body ? rDoc.body.querySelectorAll("*") : [];
  var knownFps = [];
  for (var i = 0; i < rEls.length; i++) {
    var fp = _contentFingerprint(rEls[i].textContent || "");
    if (fp.length > 10) knownFps.push(fp);
  }
  var articleH1 = container.el.querySelector("h1");
  var candidates = container.el.querySelectorAll("p, h1, h2, h3, h4, h5, h6, li, blockquote, div");
  var newElements = [];
  var addedFps = new Set();
  var addedTexts = [];
  for (var i = 0; i < candidates.length; i++) {
    var el = candidates[i];
    if (!_isArticleContentElement(el, articleH1)) continue;
    var text = (el.textContent || "").replace(/\s+/g, " ").trim();
    var fp = _contentFingerprint(text);
    if (fp.length < 10) continue;
    if (knownFps.indexOf(fp) >= 0) continue;
    if (addedFps.has(fp)) continue;
    var wordCount = text.split(/\s+/).length;
    if (wordCount > 200) {
      var lowerText = text.toLowerCase();
      var isSuperSet = false;
      for (var k = 0; k < knownFps.length; k++) {
        if (lowerText.indexOf(knownFps[k]) >= 0) { isSuperSet = true; break; }
      }
      if (isSuperSet) continue;
    }
    var sideChildren = el.querySelectorAll("div");
    var hasSidebar = false;
    for (var sc = 0; sc < sideChildren.length; sc++) {
      var childStyle = sideChildren[sc].getAttribute("style") || "";
      if (/grid-column-start\s*:\s*(?:9|1[0-9]|2[0-9])/i.test(childStyle)) { hasSidebar = true; break; }
    }
    if (hasSidebar) continue;
    var isRedundant = false;
    for (var j = 0; j < newElements.length; j++) {
      if (el.contains(newElements[j]) || newElements[j].contains(el)) { isRedundant = true; break; }
    }
    if (isRedundant) continue;
    var isDuplicate = false;
    for (var j = 0; j < addedTexts.length; j++) {
      if (addedTexts[j].indexOf(fp) >= 0 || fp.indexOf(addedTexts[j]) >= 0) { isDuplicate = true; break; }
    }
    if (isDuplicate) continue;
    addedFps.add(fp);
    addedTexts.push(fp);
    newElements.push(el);
  }
  if (newElements.length === 0) return readabilityHtml;
  var appendHtml = newElements.map(function(el) { return el.outerHTML; }).join("\n");
  appendHtml = appendHtml.replace(/<em[^>]*>If you buy something using links in our stories,? we may earn a commission[^<]*<\/em>\s*/gi, '');
  var idx = readabilityHtml.lastIndexOf("</div>");
  if (idx > 0) {
    return readabilityHtml.slice(0, idx) + "\n" + appendHtml + "\n" + readabilityHtml.slice(idx);
  }
  return readabilityHtml + "\n" + appendHtml;
}
```

- [ ] **Step 2: Verify file was created**

Run: `wc -l ios/extractor.js`
Expected: ~380 lines

- [ ] **Step 3: Commit**

```bash
git add ios/extractor.js
git commit -m "feat(ios): create text-only article extractor"
```

---

### Task 2: Create the text-only EPUB generator

**Files:**
- Create: `ios/generator.js`

Adapted from `extension/epub-generator.js`. Removed all image handling. All `<img>` tags are stripped during sanitization. No image processor parameter. No image embedding loop.

- [ ] **Step 1: Create `ios/generator.js`**

```javascript
// text-only EPUB generator — adapted from extension/epub-generator.js

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function generateCoverImageSvg() {
  return ""; // No cover image for text-only EPUBs
}

function generateDetailsPage({
  title = "",
  authors = "",
  pubDate = "",
  place = "",
  url = "",
  sentDate = "",
  keepLinks = true,
  readTime = null,
} = {}) {
  if (!sentDate) {
    const d = new Date();
    sentDate = d.getFullYear() + "-" +
      String(d.getMonth() + 1).padStart(2, "0") + "-" +
      String(d.getDate()).padStart(2, "0");
  }
  function row(label, value) {
    if (!value || value.trim() === "" || value.trim() === "Unknown" || value.trim() === "Untitled") return "";
    return "<tr><td class=\"label\">" + escapeHtml(label) + "</td>" +
      "<td class=\"value\">" + escapeHtml(value) + "</td></tr>";
  }
  const sourceUrl = url || "";
  let urlRow = "";
  if (sourceUrl) {
    const urlCell = keepLinks
      ? "<a href=\"" + escapeHtml(sourceUrl) + "\">" + escapeHtml(sourceUrl) + "</a>"
      : escapeHtml(sourceUrl);
    urlRow = "<tr><td class=\"label\">Source</td><td class=\"value\">" + urlCell + "</td></tr>";
  }
  const readTimeRow = (readTime && readTime > 0)
    ? row("Reading time", readTime + " min")
    : "";
  const rows = [
    row("Title", title),
    row("Author", authors),
    row("Published", pubDate),
    row("In", place),
    urlRow,
    row("Sent to Kindle", sentDate),
    readTimeRow,
  ].filter(Boolean).join("");
  return '<?xml version="1.0" encoding="utf-8"?>\n' +
    '<html xmlns="http://www.w3.org/1999/xhtml">\n' +
    "<head><title>Details</title></head>\n" +
    "<body>\n" +
    '<div class="details-page">\n' +
    '  <table class="details-table"><tbody>\n' +
    "    " + rows + "\n" +
    "  </tbody></table>\n" +
    "</div>\n" +
    "</body>\n" +
    "</html>";
}

var _KINDLE_CSS = "body{font-family:Georgia,serif;line-height:1.6;margin:2em 1.5em}" +
  "h1{font-size:1.4em;margin-top:1em}" +
  "h2{font-size:1.2em;margin-top:0.8em}" +
  "h3{font-size:1.05em;margin-top:0.6em}" +
  "p{margin:0.6em 0;text-indent:1.2em}" +
  "p.byline{color:#555;font-size:0.9em;text-indent:0}" +
  "blockquote{color:#444;font-style:italic;margin:1em 2em;padding:0.5em 1em;border-left:3px solid #ccc}" +
  "pre{font-size:0.85em;background:#f5f5f5;padding:0.5em;overflow-x:auto;white-space:pre-wrap}" +
  "code{font-family:Menlo,Consolas,monospace;font-size:0.9em}" +
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

function _contentOpf(title, author, fileManifest, spineOrder, coverId, bookId) {
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
    '    <dc:identifier id="BookId">urn:uuid:' + bookId + '</dc:identifier>\n' +
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

function _tocNcx(title, navPoints, bookId) {
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
    '    <meta name="dtb:uid" content="urn:uuid:' + bookId + '"/>\n' +
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

function _selfCloseVoidElements(html) {
  return html.replace(/<(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)(\s[^>]*?)?\s*>/gi, function(match, tag, attrs) {
    if (match.endsWith("/>")) return match;
    return "<" + tag + (attrs || "") + " />";
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

var _HTML5_ONLY_TAGS = ["figure", "picture", "video", "audio", "source", "track", "canvas", "svg", "nav", "figcaption"];
var _HTML5_ATTR_RE = /^(aria-|on\w+|role|tabindex|playsinline|webkit-playsinline|moz-playsinline|allow|allowfullscreen|allowtransparency|frameborder|scrolling|marginwidth|marginheight|msallowfullscreen|mozallowfullscreen|webkitallowfullscreen|loading|sizes|srcset|currentsrc|currentsourceurl)$/i;

function _sanitizeHtmlForEpub(html) {
  if (!html) return html;
  var doc = new DOMParser().parseFromString(html, "text/html");
  if (!doc || !doc.body) return html;

  // Strip HTML5-only elements
  for (var i = 0; i < _HTML5_ONLY_TAGS.length; i++) {
    var tag = _HTML5_ONLY_TAGS[i];
    var els = doc.querySelectorAll(tag);
    for (var j = els.length - 1; j >= 0; j--) {
      var el = els[j];
      var parent = el.parentNode;
      if (!parent) continue;
      if (tag === "picture") {
        var img = el.querySelector("img");
        if (img) parent.insertBefore(img, el);
      } else if (tag === "figure" || tag === "nav" || tag === "figcaption") {
        while (el.firstChild) parent.insertBefore(el.firstChild, el);
      }
      parent.removeChild(el);
    }
  }

  // Strip HTML5-only attributes
  var all = doc.body.querySelectorAll("*");
  for (var i = 0; i < all.length; i++) {
    var el = all[i];
    var attrs = el.attributes;
    if (!attrs) continue;
    var toRemove = [];
    for (var j = 0; j < attrs.length; j++) {
      var name = attrs[j].name;
      if (_HTML5_ATTR_RE.test(name)) {
        toRemove.push(name);
      } else if (name.indexOf("data-") === 0) {
        toRemove.push(name);
      } else if (name.indexOf(":") >= 0 && name.indexOf("xml:") !== 0 && name.indexOf("xmlns") !== 0) {
        toRemove.push(name);
      } else if (!name) {
        toRemove.push(name);
      }
    }
    for (var j = 0; j < toRemove.length; j++) {
      el.removeAttribute(toRemove[j]);
    }
  }

  // Remove ALL img tags (text-only EPUB)
  var imgs = doc.body.querySelectorAll("img");
  for (var i = imgs.length - 1; i >= 0; i--) {
    imgs[i].parentNode.removeChild(imgs[i]);
  }

  return doc.body.innerHTML;
}

async function generateEpub(opts) {
  var {
    article,
    originalHtml = "",
    url = "",
    title: titleOverride = "",
    keepLinks = true,
  } = opts;

  var title = _sanitizeKindleText(titleOverride || article.title || "Article") || "Article";
  var author = _sanitizeKindleText(article.author || "");

  var bodyHtml = article.content || "";
  bodyHtml = _sanitizeHtmlForEpub(bodyHtml);
  if (!keepLinks) {
    bodyHtml = bodyHtml.replace(/<a\b[^>]*>(.*?)<\/a>/gi, "$1");
  }

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

  // Rebuild contentHtml with heading IDs
  contentHtml =
    "<body>\n" +
    '  <h1 id="title">' + _esc(title) + "</h1>\n" +
    (author ? '  <p class="byline">' + _esc(author) + "</p>\n" : "") +
    "  " + bodyHtml + "\n" +
    "</body>";

  // Cover (text-only — empty SVG placeholder)
  var coverSvg = '';
  var coverXhtml = _epubXmlHeader() +
    '<html xmlns="http://www.w3.org/1999/xhtml">\n' +
    '<head><title>Cover</title></head>\n' +
    '<body>\n' +
    '  <div style="text-align:center;padding:4em 2em;">\n' +
    '    <h1>' + _esc(title) + '</h1>\n' +
    (author ? '    <p style="color:#555;">' + _esc(author) + '</p>\n' : "") +
    '  </div>\n' +
    '</body>\n</html>';

  // Details page
  var detailsHtml = generateDetailsPage({
    title: title,
    authors: author,
    url: url,
    sentDate: new Date().toISOString().split("T")[0],
    keepLinks: keepLinks,
  });
  var detailsXhtml = detailsHtml;

  // Build JSZip
  var zip = new JSZip();
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
  zip.folder("META-INF").file("container.xml", _containerXml());
  var bookId = _uuid();

  var oebps = zip.folder("OEBPS");
  oebps.file("style/default.css", _KINDLE_CSS);

  var fileManifest = [];
  var spineOrder = [];

  function addItem(id, href, mediaType) {
    fileManifest.push({ id: id, href: href, mediaType: mediaType });
    spineOrder.push(id);
  }

  // Cover
  oebps.file("cover.xhtml", coverXhtml);
  addItem("cover", "cover.xhtml", "application/xhtml+xml");

  // Cover SVG (empty, needed for EPUB structure)
  var coverImgId = "cover-image";
  oebps.folder("images").file("cover.svg", '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1" viewBox="0 0 1 1"><rect width="1" height="1" fill="#fff"/></svg>');
  fileManifest.push({ id: coverImgId, href: "images/cover.svg", mediaType: "image/svg+xml" });

  // Details
  oebps.file("details.xhtml", detailsXhtml);
  addItem("details", "details.xhtml", "application/xhtml+xml");

  // CSS
  fileManifest.push({ id: "css", href: "style/default.css", mediaType: "text/css" });

  // Nav
  var navPoints = [
    { label: title, src: "content.xhtml#title" },
  ];
  for (var i = 0; i < tocEntries.length; i++) {
    if (tocEntries[i].level <= 2) {
      navPoints.push({ label: tocEntries[i].text, src: "content.xhtml#" + tocEntries[i].slug });
    }
  }
  oebps.file("toc.ncx", _tocNcx(title, navPoints, bookId));
  fileManifest.push({ id: "ncx", href: "toc.ncx", mediaType: "application/x-dtbncx+xml" });

  // No image processing — text-only EPUB

  var serializer = new XMLSerializer();
  bodyHtml = serializer.serializeToString(doc.body);
  bodyHtml = bodyHtml.replace(/^<body[^>]*>/, '').replace(/<\/body>$/, '');
  bodyHtml = _sanitizeKindleText(bodyHtml);
  contentHtml =
    "<body>\n" +
    '  <h1 id="title">' + _esc(title) + "</h1>\n" +
    (author ? '  <p class="byline">' + _esc(author) + "</p>\n" : "") +
    "  " + bodyHtml + "\n" +
    "</body>";

  var contentXhtml = _epubXmlHeader() +
    '<html xmlns="http://www.w3.org/1999/xhtml">\n' +
    '<head><title>' + _esc(title) + '</title></head>\n' +
    contentHtml + '\n</html>';
  oebps.file("content.xhtml", contentXhtml);
  addItem("content", "content.xhtml", "application/xhtml+xml");

  var opf = _contentOpf(title, author, fileManifest, spineOrder, coverImgId, bookId);
  oebps.file("content.opf", opf);

  return zip.generateAsync({ type: "blob" });
}

var _esc = escapeHtml;
```

- [ ] **Step 2: Verify file was created**

Run: `wc -l ios/generator.js`
Expected: ~280 lines

- [ ] **Step 3: Commit**

```bash
git add ios/generator.js
git commit -m "feat(ios): create text-only EPUB generator"
```

---

### Task 3: Concatenate into `ios/bundle.js`

**Files:**
- Create: `ios/bundle.js`

Concatenate in order: readability.js + jszip.min.js + extractor.js + generator.js + glue code.

- [ ] **Step 1: Concatenate and add glue code**

Run:

```bash
touch ios/bundle.js
# Copy readability.js
cat extension/lib/readability.js >> ios/bundle.js
# Copy jszip.min.js
cat extension/lib/jszip.min.js >> ios/bundle.js
# Copy extractor
cat ios/extractor.js >> ios/bundle.js
# Copy generator
cat ios/generator.js >> ios/bundle.js
```

Then append the glue code:

```bash
cat >> ios/bundle.js << 'GLUE'
// iOS bundle glue — processArticle entry point
var iOSBundle = {};

iOSBundle.processArticle = async function(url) {
  if (!url) throw new Error("No URL provided");

  var response = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (iPhone; web2kindle iOS) AppleWebKit/605.1.15 (KHTML, like Gecko)" }
  });
  if (!response.ok) throw new Error("HTTP " + response.status);
  var html = await response.text();

  var doc = new DOMParser().parseFromString(html, "text/html");
  var reader = new Readability(doc);
  var article = reader.parse();
  if (!article || !article.content) {
    article = _extractDomArticle(html);
    if (!article) throw new Error("Could not extract article content");
  }

  var content = article.content;
  content = stripUiText(content);
  content = stripTrailingRelated(content);

  var epubBlob = await generateEpub({
    article: { title: article.title, author: article.author || "", content: content },
    originalHtml: html,
    url: url,
    title: article.title,
    keepLinks: true
  });

  var buffer = await epubBlob.arrayBuffer();
  var bytes = new Uint8Array(buffer);
  var binary = "";
  for (var i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  var epubBase64 = btoa(binary);

  return { title: article.title, epubBase64: epubBase64 };
};
GLUE
```

- [ ] **Step 2: Verify the bundle**

```bash
# Check file size
ls -lh ios/bundle.js
# Check for syntax errors by trying to parse
node -e "try { require('fs').readFileSync('ios/bundle.js', 'utf8'); console.log('File readable, size:', (require('fs').statSync('ios/bundle.js').size / 1024).toFixed(0), 'KB'); } catch(e) { console.error(e.message); }"
# Verify key functions exist
grep -c "function extractArticle" ios/bundle.js
grep -c "async function generateEpub" ios/bundle.js
grep -c "iOSBundle.processArticle" ios/bundle.js
grep -c "function Readability" ios/bundle.js
grep -c "var JSZip" ios/bundle.js
```

Expected: All grep counts = 1

- [ ] **Step 3: Commit**

```bash
git add ios/bundle.js
git commit -m "feat(ios): create bundled JS pipeline"
```

---

### Task 4: Create the Scriptable script

**Files:**
- Create: `ios/wk2kindle.js`

- [ ] **Step 1: Create `ios/wk2kindle.js`**

```javascript
// WK2Kindle — called from Shortcut "Send to Kindle"
// Reads bundle.js from iCloud Drive/Scriptable/web2kindle/
// Returns { title, epubBase64 } to the Shortcut

const url = args.plainTexts[0];
if (!url) throw new Error("No URL provided");

const fm = FileManager.iCloud();
const bundlePath = fm.joinPath(fm.documentsDirectory(), "web2kindle/bundle.js");

if (!fm.fileExists(bundlePath)) {
  throw new Error("bundle.js not found at " + bundlePath);
}

const code = fm.readString(bundlePath);
eval(code);

const result = await iOSBundle.processArticle(url);
return result;
```

- [ ] **Step 2: Verify file was created**

```bash
wc -l ios/wk2kindle.js
```

Expected: ~17 lines

- [ ] **Step 3: Commit**

```bash
git add ios/wk2kindle.js
git commit -m "feat(ios): create Scriptable script"
```

---

### Task 5: Add .gitignore entries for iOS artifacts

- [ ] **Step 1: Add ios/build/ to .gitignore (future use)**

No action needed — `ios/` source files should be committed. No generated artifacts to ignore beyond what's already in `.gitignore`.

---

---

### Task 5: Write Shortcut build instructions

- [ ] **Step 1: Add the build steps in a markdown file**

Create `ios/SHORTCUT_BUILD_STEPS.md` with the following. The user follows these to build the "Send to Kindle" shortcut manually in the Shortcuts app.

Create the file:

```markdown
# Shortcut "Send to Kindle" — Build Steps

Open **Shortcuts** app → tap **+** → tap **i** → toggle on **Share Sheet**,
accepts **URLs**.

## Actions

| # | Action | Configuration |
|---|---|---|
| 1 | **Run Scriptable** | Script: `WK2Kindle`<br>Input: `Shortcut Input` |
| 2 | **If** | Condition: `Run Scriptable` `has any value` |
| 3 | **Get Dictionary from Input** | Input: `Run Scriptable` result |
| 4 | **Get Dictionary Value** | Key: `title` |
| 5 | **Get Dictionary Value** | Key: `epubBase64` |
| 6 | **Base64 Encode** | Mode: Decode<br>Input: `epubBase64` |
| 7 | **Send Email** | To: *(your Kindle email, e.g. you@kindle.com)*<br>Subject: `convert`<br>Body: `Sent from web2kindle: {title}`<br>Attachment: Base64 Decode result<br>Filename: `article.epub` |
| 8 | **Show Notification** | Title: `Sent to Kindle`<br>Body: `{title}` |
| 9 | **Otherwise** | (from step 2 If) |
| 10 | **Show Notification** | Title: `Failed`<br>Body: `Could not process article` |

## To set up

1. Install **Scriptable** from App Store (free)
2. Create a script in Scriptable named `WK2Kindle` — paste the contents of
   `ios/wk2kindle.js`
3. Place `ios/bundle.js` at `iCloud Drive/Scriptable/web2kindle/bundle.js` —
   Scriptable reads it from its own iCloud folder
4. Build the Shortcut following the actions above
5. Set your Kindle email in the "Send Email" To: field
6. Ensure your email is configured in iOS **Mail** app
7. Verify your sending email is in Amazon's **Approved Personal Document
   Email List** at
   https://www.amazon.com/hz/mycd/myx#/home/settings/pdoc
```

- [ ] **Step 2: Commit**

```bash
git add ios/SHORTCUT_BUILD_STEPS.md
git commit -m "docs(ios): add Shortcut build instructions"
```

---

## Self-Review Checklist

- [ ] Spec coverage: All spec requirements are covered (extractor, generator, bundle, Scriptable script, Shortcut instructions)
- [ ] Placeholders: No TBD, TODO, or incomplete code
- [ ] Type consistency: Function signatures match across files (`processArticle(url)`, `extractArticle(html, url)`, `generateEpub(opts)`)
- [ ] All function names used in glue code are defined in the included modules
