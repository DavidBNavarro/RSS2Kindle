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
