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

  // Supplement content when Readability truncates at DOM boundary (e.g. WIRED's multi-grid layout)
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

function _norm(text) { return (text || "").split(/\s+/).join(" "); }

function _indexQuoteTexts(quotes) {
  var texts = new Set();
  for (var i = 0; i < quotes.length; i++) {
    var full = _norm(quotes[i].textContent);
    if (full) texts.add(full);
    var paras = quotes[i].querySelectorAll("p");
    for (var j = 0; j < paras.length; j++) {
      var pt = _norm(paras[j].textContent);
      if (pt) texts.add(pt);
    }
  }
  return texts;
}

function _matchConsecutive(tags, startIdx, quoteTexts) {
  var matched = [];
  for (var i = startIdx; i < tags.length; i++) {
    var tag = tags[i];
    if (tag.querySelector("img, figure, table, ul, ol")) break;
    if (quoteTexts.has(_norm(tag.textContent))) {
      matched.push(tag);
    } else {
      break;
    }
  }
  return matched;
}

function restoreBlockquotes(extractedHtml, sourceHtml) {
  var srcDoc = new DOMParser().parseFromString(sourceHtml, "text/html");
  var quotes = srcDoc.querySelectorAll("blockquote");
  var quoteTexts = _indexQuoteTexts(quotes);
  if (quoteTexts.size === 0) return extractedHtml;

  var extDoc = new DOMParser().parseFromString(extractedHtml, "text/html");
  var tags = extDoc.querySelectorAll("p, div");
  for (var i = 0; i < tags.length; i++) {
    var tag = tags[i];
    if (tag.parentNode && tag.parentNode.tagName === "BLOCKQUOTE") continue;
    if (tag.querySelector("img, figure, table, ul, ol")) continue;
    if (!quoteTexts.has(_norm(tag.textContent))) continue;
    var group = _matchConsecutive(tags, i, quoteTexts);
    if (group.length === 0) continue;
    var bq = extDoc.createElement("blockquote");
    var parent = group[0].parentNode;
    parent.insertBefore(bq, group[0]);
    for (var g = 0; g < group.length; g++) {
      bq.appendChild(group[g]);
    }
    i += group.length - 1;
  }
  return extDoc.body ? extDoc.body.innerHTML : extractedHtml;
}

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
  
  try {
    var url = new URL(resolved);
    var host = url.hostname.toLowerCase();
    
    if (host === "substackcdn.com" || host === "substack.com") {
      return resolved;
    }
    
    var pathname = url.pathname;
    var m2 = pathname.match(/^(.+)[-_]\d+x\d+(\.[a-zA-Z0-9]+)$/);
    if (m2) {
      var newPathname = m2[1] + m2[2];
      var newUrl = url.protocol + "//" + url.host + newPathname;
      return newUrl;
    }
  } catch(e) {}
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
  if (!src) {
    var srcset = _parseSrcset(tag.getAttribute("srcset") || "");
    if (srcset) {
      return { src: _normalizeImageUrl(srcset, url), reason: "accepted" };
    }
    return { src: "", reason: "no_src" };
  }
  if (!skipSizeCheck) {
    var w = parseInt(tag.getAttribute("width")), h = parseInt(tag.getAttribute("height"));
    if ((w && w < 50) || (h && h < 50)) return { src: "", reason: "tiny" };
  }
  if (src.startsWith("data:")) return { src: "", reason: "data_uri" };
  var low = src.toLowerCase();
  if (/(?:^|\/)(?:w_32|w_24|w_16)(?:\/|$|[?#])|\/(?:icon|avatar|favicon|button|share|social|toolbar|sprite|emoji|logo)s?(?:\/|$|[?#.])/i.test(low)) {
    return { src: "", reason: "ui_like_url" };
  }
  if (_isUiChrome(tag)) return { src: "", reason: "ui_chrome" };
  return { src: _normalizeImageUrl(src, url), reason: "accepted" };
}

function _normText(text) {
  if (!text) return "";
  return text.replace(/\s+/g, " ").trim().toLowerCase().replace(/[^a-z0-9 ]/g, "");
}

function reinjectImages(extractedHtml, originalHtml, url) {
  var origDoc = new DOMParser().parseFromString(originalHtml, "text/html");
  var container = _findArticleContainer(origDoc);
  if (!container) return extractedHtml;

  var article = container.el;
  var seenSrcs = new Set();
  var placements = [];

  var extDoc = new DOMParser().parseFromString(extractedHtml, "text/html");
  var existingImgs = extDoc.querySelectorAll("img");
  for (var i = 0; i < existingImgs.length; i++) {
    var src = existingImgs[i].getAttribute("src");
    if (src) {
      var normalized = _normalizeImageUrl(src, url);
      seenSrcs.add(normalized);
    }
  }

  // Lead images: walk up from article looking for preceding siblings with images
  function _collectMedia(node) {
    if (!node || !node.querySelectorAll) return;
    var imgs = node.querySelectorAll("img, picture, [data-src], [data-lazy-src]");
    for (var i = 0; i < imgs.length; i++) {
      var el = imgs[i];
      if (el.tagName === "SOURCE") continue;
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
    if (el.tagName === "SOURCE") continue;
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

  // Open graph fallback — only when absolutely no images found
  if (seenSrcs.size === 0 && placements.length === 0) {
    var metas = origDoc.querySelectorAll('meta[property="og:image"], meta[name="twitter:image"]');
    for (var i = 0; i < metas.length; i++) {
      var content = (metas[i].getAttribute("content") || "").trim();
      if (content) {
        var resolved = _resolveUrl(content, url);
        var normalized = _normalizeImageUrl(resolved, url);
        if (!seenSrcs.has(normalized)) {
          seenSrcs.add(normalized);
          placements.push({ text: "", src: normalized });
        }
      }
    }
  }

  if (placements.length === 0) return extDoc.body ? extDoc.body.innerHTML : extractedHtml;

  // Match to extracted document
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

var _SUPPRESS_NON_CONTENT_RE = /^(featured video|to view this video|loaded:|the live event has ended|captions\/subtitles|share this article|share on|tweet|email|read more|sponsored|advertisement|select your language|wired is obsessed|copyright|all rights reserved|we may earn a commission|skip to main content|comments|back to top|you might also like|courtesy of|buy this book at|photo-illustration:|subscribe to|newsletter)/i;

var _BYLINE_DATE_RE = /\b(?:january|february|march|april|may|june|july|august|september|october|november|december) \d{1,2}, \d{4}\b/i;

function _isArticleContentElement(el, articleH1) {
  var text = (el.textContent || "").replace(/\s+/g, " ").trim();
  var wordCount = text.split(/\s+/).length;
  if (wordCount === 0) return false;

  if (el.tagName === "H1") return false;
  if (el.tagName === "DIV" && wordCount < 20) return false;
  if ((el.tagName === "P" || el.tagName === "LI" || el.tagName === "BLOCKQUOTE" || el.tagName === "FIGCAPTION") && wordCount < 3) return false;
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

function _supplementContent(readabilityHtml, originalHtml) {
  var origDoc = new DOMParser().parseFromString(originalHtml, "text/html");
  for (var sel of ["script", "style", "noscript", "template", "iframe"]) {
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
        if (lowerText.indexOf(knownFps[k]) >= 0) {
          isSuperSet = true;
          break;
        }
      }
      if (isSuperSet) continue;
    }

    var sideChildren = el.querySelectorAll("div");
    var hasSidebar = false;
    for (var s = 0; s < sideChildren.length; s++) {
      var childStyle = sideChildren[s].getAttribute("style") || "";
      if (/grid-column-start\s*:\s*(?:9|1[0-9]|2[0-9])/i.test(childStyle)) {
        hasSidebar = true;
        break;
      }
    }
    if (hasSidebar) continue;

    var isRedundant = false;
    for (var j = 0; j < newElements.length; j++) {
      if (el.contains(newElements[j]) || newElements[j].contains(el)) {
        isRedundant = true;
        break;
      }
    }
    if (isRedundant) continue;

    var isDuplicate = false;
    for (var j = 0; j < addedTexts.length; j++) {
      if (addedTexts[j].indexOf(fp) >= 0 || fp.indexOf(addedTexts[j]) >= 0) {
        isDuplicate = true;
        break;
      }
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
