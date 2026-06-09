function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function generateCoverImageSvg({ title = "", authors = "", sitename = "", readTime = null } = {}) {
  var W = 600, H = 800;
  var MARGIN = 50;
  var MAX_W = W - 2 * MARGIN;
  var TITLE_TOP = 140;
  var RULE_H = 6;
  var RULE_GAP = 40;
  var AUTHOR_GAP = 30;
  var FOOTER_GAP = 70;
  var MAX_TITLE_H = 380;

  function wrapText(text, fontSize, maxWidth) {
    var avgW = fontSize * 0.62;
    var maxChars = Math.floor(maxWidth / avgW);
    var words = text.split(/\s+/);
    var lines = [];
    var line = "";
    for (var wi = 0; wi < words.length; wi++) {
      var word = words[wi];
      var test = line ? line + " " + word : word;
      if (test.length <= maxChars) {
        line = test;
      } else {
        if (line) lines.push(line);
        line = word;
      }
    }
    if (line) lines.push(line);
    return lines;
  }

  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  var titleSize = 80;
  var titleLines = [];
  var sizes = [80, 72, 64, 56, 48, 40, 36, 30];
  for (var si = 0; si < sizes.length; si++) {
    var size = sizes[si];
    var lines = wrapText(title, size, MAX_W);
    var lineH = size * 1.3;
    if (lineH * lines.length <= MAX_TITLE_H || size <= 30) {
      titleSize = size;
      titleLines = lines;
      break;
    }
  }
  var titleLineH = titleSize * 1.3;
  var titleBlockH = titleLineH * titleLines.length;

  var hash = 0;
  for (var i = 0; i < title.length; i++) {
    hash = ((hash << 5) - hash) + title.charCodeAt(i);
    hash |= 0;
  }
  var template = Math.abs(hash) % 3;

  var parts = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800" viewBox="0 0 600 800">',
    '<rect width="600" height="800" fill="#ffffff"/>',
  ];

  var footerParts = [];
  if (sitename) footerParts.push(esc(sitename));
  if (readTime) footerParts.push(readTime + " min read");
  var footerText = footerParts.join(" \u00b7 ");

  if (template === 0) {
    var titleY = TITLE_TOP + Math.floor((MAX_TITLE_H - titleBlockH) / 2);
    for (var ti = 0; ti < titleLines.length; ti++) {
      parts.push('<text x="300" y="' + (titleY + ti * titleLineH) + '" text-anchor="middle" font-family="Georgia, \'Times New Roman\', serif" font-size="' + titleSize + '" fill="#16161a">' + esc(titleLines[ti]) + "</text>");
    }
    var ruleY = titleY + titleBlockH + RULE_GAP;
    parts.push('<rect x="210" y="' + ruleY + '" width="180" height="' + RULE_H + '" fill="#505050" rx="3"/>');
    var authorY = ruleY + RULE_H + AUTHOR_GAP;
    if (authors) {
      var authorLines = wrapText(authors, 28, MAX_W);
      for (var ai = 0; ai < authorLines.length; ai++) {
        parts.push('<text x="300" y="' + authorY + '" text-anchor="middle" font-family="\'Helvetica Neue\', Helvetica, Arial, sans-serif" font-size="28" fill="#323236">' + esc(authorLines[ai]) + "</text>");
        authorY += 28 * 1.3;
      }
    }
    if (footerText) {
      parts.push('<text x="300" y="' + (authorY + FOOTER_GAP) + '" text-anchor="middle" font-family="\'Helvetica Neue\', Helvetica, Arial, sans-serif" font-size="14" fill="#8c8c8c">' + footerText + "</text>");
    }
  } else if (template === 1) {
    var titleY = TITLE_TOP + Math.floor((MAX_TITLE_H - titleBlockH) / 2);
    for (var ti = 0; ti < titleLines.length; ti++) {
      parts.push('<text x="' + MARGIN + '" y="' + (titleY + ti * titleLineH) + '" font-family="Georgia, \'Times New Roman\', serif" font-size="' + titleSize + '" fill="#16161a">' + esc(titleLines[ti]) + "</text>");
    }
    var ruleY = titleY + titleBlockH + RULE_GAP;
    parts.push('<rect x="' + MARGIN + '" y="' + ruleY + '" width="120" height="' + RULE_H + '" fill="#505050" rx="3"/>');
    var authorY = ruleY + RULE_H + AUTHOR_GAP;
    if (authors) {
      var authorLines = wrapText(authors, 28, MAX_W);
      for (var ai = 0; ai < authorLines.length; ai++) {
        parts.push('<text x="' + MARGIN + '" y="' + authorY + '" font-family="\'Helvetica Neue\', Helvetica, Arial, sans-serif" font-size="28" fill="#323236">' + esc(authorLines[ai]) + "</text>");
        authorY += 28 * 1.3;
      }
    }
    if (footerText) {
      parts.push('<text x="' + MARGIN + '" y="' + (authorY + FOOTER_GAP) + '" font-family="\'Helvetica Neue\', Helvetica, Arial, sans-serif" font-size="14" fill="#8c8c8c">' + footerText + "</text>");
    }
  } else if (template === 2) {
    var titleY = Math.floor(H * 0.12);
    for (var ti = 0; ti < titleLines.length; ti++) {
      parts.push('<text x="300" y="' + (titleY + ti * titleLineH) + '" text-anchor="middle" font-family="Georgia, \'Times New Roman\', serif" font-size="' + titleSize + '" fill="#16161a">' + esc(titleLines[ti]) + "</text>");
    }
    var ruleY = titleY + titleBlockH + RULE_GAP + 20;
    parts.push('<rect x="' + MARGIN + '" y="' + ruleY + '" width="' + MAX_W + '" height="' + RULE_H + '" fill="#505050" rx="3"/>');
    var lowerCenter = Math.floor(H * 0.60);
    if (authors) {
      var authorLines = wrapText(authors, 28, MAX_W);
      var totalAH = 28 * 1.3 * authorLines.length;
      var authorY = lowerCenter - Math.floor(totalAH / 2);
      for (var ai = 0; ai < authorLines.length; ai++) {
        parts.push('<text x="300" y="' + authorY + '" text-anchor="middle" font-family="\'Helvetica Neue\', Helvetica, Arial, sans-serif" font-size="28" fill="#323236">' + esc(authorLines[ai]) + "</text>");
        authorY += 28 * 1.3;
      }
    }
    if (footerText) {
      parts.push('<text x="300" y="' + Math.floor(H * 0.80) + '" text-anchor="middle" font-family="\'Helvetica Neue\', Helvetica, Arial, sans-serif" font-size="14" fill="#8c8c8c">' + footerText + "</text>");
    }
  }

  parts.push("</svg>");
  return parts.join("\n");
}

function generateDetailsPage({
  title = "",
  authors = "",
  pubDate = "",
  place = "",
  url = "",
  sentDate = "",
  scientificMetadata = {},
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
    if (!value || value.trim() === "" || value.trim() === "Unknown" || value.trim() === "Untitled") {
      return "";
    }
    return "<tr><td class=\"label\">" + escapeHtml(label) + "</td>" +
      "<td class=\"value\">" + escapeHtml(value) + "</td></tr>";
  }

  const resolvedPubDate = (scientificMetadata.published || pubDate || "").trim();
  const resolvedPlace = (scientificMetadata.citation || scientificMetadata.journal || place || "").trim();
  const doi = (scientificMetadata.doi || "").trim();
  const sourceUrl = scientificMetadata.pubmedUrl ||
    scientificMetadata.sourceUrl ||
    url ||
    (doi ? "https://doi.org/" + doi : "");

  let urlRow = "";
  if (sourceUrl) {
    const urlCell = keepLinks
      ? "<a href=\"" + escapeHtml(sourceUrl) + "\">" + escapeHtml(sourceUrl) + "</a>"
      : escapeHtml(sourceUrl);
    urlRow = "<tr><td class=\"label\">Source</td>" +
      "<td class=\"value\">" + urlCell + "</td></tr>";
  }

  let doiRow = "";
  if (doi) {
    const doiValue = "https://doi.org/" + doi;
    const doiCell = keepLinks
      ? "<a href=\"" + escapeHtml(doiValue) + "\">" + escapeHtml(doi) + "</a>"
      : escapeHtml(doi);
    doiRow = "<tr><td class=\"label\">DOI</td>" +
      "<td class=\"value\">" + doiCell + "</td></tr>";
  }

  const readTimeRow = (readTime && readTime > 0)
    ? row("Reading time", readTime + " min")
    : "";

  const rows = [
    row("Title", title),
    row("Author", authors),
    row("Published", resolvedPubDate),
    row("In", resolvedPlace),
    doiRow,
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
  "img{max-width:100%;height:auto;display:block;margin:1em auto}" +
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

var _HTML5_ONLY_TAGS = ["figure", "picture", "video", "audio", "source", "track", "canvas", "svg", "nav"];
var _HTML5_ATTR_RE = /^(aria-|on\w+|role|tabindex|playsinline|webkit-playsinline|moz-playsinline|allow|allowfullscreen|allowtransparency|frameborder|scrolling|marginwidth|marginheight|msallowfullscreen|mozallowfullscreen|webkitallowfullscreen|loading|sizes|srcset|currentsrc|currentsourceurl)$/i;

function _sanitizeHtmlForEpub(html) {
  if (!html) return html;
  var doc = new DOMParser().parseFromString(html, "text/html");
  if (!doc || !doc.body) return html;

  // Strip HTML5-only elements, unwrapping where possible
  for (var i = 0; i < _HTML5_ONLY_TAGS.length; i++) {
    var tag = _HTML5_ONLY_TAGS[i];
    var els = doc.querySelectorAll(tag);
    for (var j = els.length - 1; j >= 0; j--) {
      var el = els[j];
      var parent = el.parentNode;
      if (!parent) continue;
      if (tag === "picture") {
        var img = el.querySelector("img");
        if (img) {
          parent.insertBefore(img, el);
        }
      } else if (tag === "figure" || tag === "nav") {
        while (el.firstChild) {
          parent.insertBefore(el.firstChild, el);
        }
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

  // Remove img elements that have no valid src attribute after sanitization
  var imgs = doc.body.querySelectorAll("img");
  for (var i = imgs.length - 1; i >= 0; i--) {
    var img = imgs[i];
    var src = (img.getAttribute("src") || "").trim();
    if (!src || src.startsWith("data:") || src.startsWith("blob:") || src.startsWith("chrome-extension:")) {
      img.parentNode.removeChild(img);
    }
  }

  return doc.body.innerHTML;
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
    deliveryMode = false,
    imageProcessor = null,
  } = opts;

  var title = _sanitizeKindleText(titleOverride || article.title || "Article") || "Article";
  var author = _sanitizeKindleText(article.author || "");
  var sitename = article.sitename || "";
  var pubDate = article.pubDate || "";
  var readTime = article.readTime || 0;

  var bodyHtml = article.content || "";
  bodyHtml = _sanitizeHtmlForEpub(bodyHtml);
  // FIX: keepLinks condition was inverted — strips links only when keepLinks is false
  if (!keepLinks) {
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
  contentHtml =
    "<body>\n" +
    '  <h1 id="title">' + _esc(title) + "</h1>\n" +
    (author ? '  <p class="byline">' + _esc(author) + "</p>\n" : "") +
    "  " + bodyHtml + "\n" +
    "</body>";

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

  var detailsXhtml = detailsHtml;

  // Build JSZip
  var zip = new JSZip();
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
  zip.folder("META-INF").file("container.xml", _containerXml());
  var bookId = _uuid();

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

  // Images
  if (keepImages && imageProcessor) {
    var imgEls = doc.querySelectorAll("img");
    for (var i = 0; i < imgEls.length; i++) {
      var imgSrc = imgEls[i].getAttribute("src");
      if (!imgSrc || imgSrc.startsWith("data:")) continue;
      var blob;
      try {
        blob = await imageProcessor.fetchImageAsBlob(imgSrc, { referer: url });
      } catch(e) {
        continue;
      }
      var embedBlob = blob;
      try {
        var info = await imageProcessor.getImageInfo(blob);
        if (imageProcessor.shouldSkipImage(info.width, info.height)) continue;
        if (rotateImages && imageProcessor.shouldRotateImage(info.width, info.height)) {
          embedBlob = await imageProcessor.rotateImage(blob);
        }
        if (deliveryMode && imageProcessor.deliveryOptimize) {
          embedBlob = await imageProcessor.deliveryOptimize(embedBlob);
        } else if (embedBlob.type !== "image/jpeg" && embedBlob.type !== "image/png") {
          embedBlob = await imageProcessor.convertFormat(embedBlob, "image/jpeg", { quality: 0.85 });
        }
      } catch(e) {
        // Processing failed, embed raw downloaded blob
        embedBlob = blob;
      }
      imgCounter++;
      var ext = embedBlob.type === "image/png" ? "png" : "jpg";
      var fname = "img" + String(imgCounter).padStart(3, "0") + "." + ext;
      var href = "images/" + fname;
      oebps.folder("images").file(fname, await embedBlob.arrayBuffer(), { binary: true });
      var imgId = "img" + imgCounter;
      fileManifest.push({ id: imgId, href: href, mediaType: embedBlob.type });
      imgEls[i].setAttribute("src", href);
    }
  }

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

  // Generate content.opf with updated manifest (bookId already defined above)
  var opf = _contentOpf(title, author, fileManifest, spineOrder, coverImgId, bookId);
  oebps.file("content.opf", opf);

  return zip.generateAsync({ type: "blob" });
}

var _esc = escapeHtml;
