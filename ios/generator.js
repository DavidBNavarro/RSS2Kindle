// text-only EPUB generator — adapted from extension/epub-generator.js

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function generateCoverImageSvg() {
  return "";
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

  var detailsHtml = generateDetailsPage({
    title: title,
    authors: author,
    url: url,
    sentDate: new Date().toISOString().split("T")[0],
    keepLinks: keepLinks,
  });
  var detailsXhtml = detailsHtml;

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

  oebps.file("cover.xhtml", coverXhtml);
  addItem("cover", "cover.xhtml", "application/xhtml+xml");

  var coverImgId = "cover-image";
  oebps.folder("images").file("cover.svg", '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1" viewBox="0 0 1 1"><rect width="1" height="1" fill="#fff"/></svg>');
  fileManifest.push({ id: coverImgId, href: "images/cover.svg", mediaType: "image/svg+xml" });

  oebps.file("details.xhtml", detailsXhtml);
  addItem("details", "details.xhtml", "application/xhtml+xml");

  fileManifest.push({ id: "css", href: "style/default.css", mediaType: "text/css" });

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
