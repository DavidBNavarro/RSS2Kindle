const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { JSDOM } = require("jsdom");
const JSZip = require("jszip");

var ROOT = path.join(__dirname, "..");

function loadCode(p) {
  return fs.readFileSync(path.join(ROOT, p), "utf8");
}

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const mod = require(url.startsWith("https") ? "https" : "http");
    mod.get(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; Web2Kindle/1.0)" } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fetchUrl(res.headers.location).then(resolve).catch(reject);
        return;
      }
      var d = "";
      res.on("data", (c) => d += c);
      res.on("end", () => resolve(d));
    }).on("error", reject);
  });
}

function createPlaceholderImageBlob(width, height) {
  // Create minimal JPEG blob
  var jpegHeader = Buffer.from([
    0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01,
    0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xFF, 0xDB, 0x00, 0x43,
    0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08, 0x07, 0x07, 0x07, 0x09,
    0x09, 0x08, 0x0A, 0x0C, 0x14, 0x0D, 0x0C, 0x0B, 0x0B, 0x0C, 0x19, 0x12,
    0x13, 0x0F, 0x14, 0x1D, 0x1A, 0x1F, 0x1E, 0x1D, 0x1A, 0x1C, 0x1C, 0x20,
    0x24, 0x2E, 0x27, 0x20, 0x22, 0x2C, 0x23, 0x1C, 0x1C, 0x28, 0x37, 0x29,
    0x2C, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1F, 0x27, 0x39, 0x3D, 0x38, 0x32,
    0x3C, 0x2E, 0x33, 0x34, 0x32, 0xFF, 0xC0, 0x00, 0x0B, 0x08, 0x00, 0x64,
    0x00, 0x64, 0x01, 0x01, 0x11, 0x00, 0xFF, 0xC4, 0x00, 0x1F, 0x00, 0x00,
    0x01, 0x05, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
    0x09, 0x0A, 0x0B, 0xFF, 0xC4, 0x00, 0xB5, 0x10, 0x00, 0x02, 0x01, 0x03,
    0x03, 0x02, 0x04, 0x03, 0x05, 0x05, 0x04, 0x04, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x13,
    0x21, 0x31, 0x41, 0x06, 0x22, 0x51, 0x61, 0x07, 0x14, 0x71, 0x81, 0x15,
    0x32, 0x91, 0xA1, 0x08, 0x23, 0x42, 0xB1, 0xC1, 0xD1, 0xE1, 0x52, 0xF0,
    0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0A, 0x16, 0x17, 0x18, 0x19, 0x1A,
    0x25, 0x26, 0x27, 0x28, 0x29, 0x2A, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39,
    0x3A, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4A, 0x53, 0x54, 0x55,
    0x56, 0x57, 0x58, 0x59, 0x5A, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69,
    0x6A, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7A, 0x83, 0x84, 0x85,
    0x86, 0x87, 0x88, 0x89, 0x8A, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98,
    0x99, 0x9A, 0xA2, 0xA3, 0xA4, 0xA5, 0xA6, 0xA7, 0xA8, 0xA9, 0xAA, 0xB2,
    0xB3, 0xB4, 0xB5, 0xB6, 0xB7, 0xB8, 0xB9, 0xBA, 0xC2, 0xC3, 0xC4, 0xC5,
    0xC6, 0xC7, 0xC8, 0xC9, 0xCA, 0xD2, 0xD3, 0xD4, 0xD5, 0xD6, 0xD7, 0xD8,
    0xD9, 0xDA, 0xE1, 0xE2, 0xE3, 0xE4, 0xE5, 0xE6, 0xE7, 0xE8, 0xE9, 0xEA,
    0xF1, 0xF2, 0xF3, 0xF4, 0xF5, 0xF6, 0xF7, 0xF8, 0xF9, 0xFA, 0xFF, 0xDA,
    0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3F, 0x00, 0x7B, 0x94, 0x11, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xFF, 0xD9
  ]);
  return new Blob([jpegHeader], { type: "image/jpeg" });
}

async function main() {
  var url = "https://www.nbcnews.com/tech/tech-news/openevidence-ai-doctor-medical-physician-login-app-what-npi-uptodate-rcna341064";
  console.log("Fetching...");
  var html = await fetchUrl(url);
  console.log("Fetched " + (html.length / 1024).toFixed(0) + "KB");

  var dom = new JSDOM(html, { url: url });
  var win = dom.window;
  var Readability = require(path.join(ROOT, "extension", "lib", "readability.js"));
  globalThis.document = win.document;
  globalThis.Node = win.Node;
  globalThis.DOMParser = win.DOMParser;
  globalThis.XMLSerializer = win.XMLSerializer;
  globalThis.Element = win.Element;
  globalThis.Readability = Readability;

  // Load article-extractor
  var extCode = loadCode("extension/article-extractor.js");
  var extSandbox = { DOMParser: win.DOMParser, Readability: Readability, window: {}, URL: URL, console: console, Error: Error, Set: Set, Math: Math };
  vm.runInNewContext(extCode + "\n" +
    "this.extractArticle = extractArticle;\n" +
    "this.stripUiText = stripUiText;\n" +
    "this.stripTrailingRelated = stripTrailingRelated;\n" +
    "this.restoreOrderedLists = restoreOrderedLists;\n" +
    "this.restoreBlockquotes = restoreBlockquotes;\n" +
    "this.reinjectImages = reinjectImages;\n" +
    "this.reinjectLinks = reinjectLinks;\n" +
    "this.extractMetadata = extractMetadata;\n",
    extSandbox);

  var article = extSandbox.extractArticle(html, url);
  if (!article) { console.log("extractArticle returned null!"); process.exit(1); }

  var content = article.content;
  content = extSandbox.stripUiText(content);
  content = extSandbox.stripTrailingRelated(content);
  content = extSandbox.restoreOrderedLists(content, html);
  content = extSandbox.restoreBlockquotes(content, html);
  content = extSandbox.reinjectImages(content, html, url);
  content = extSandbox.reinjectLinks(content, html, url);
  article.content = content;

  var metadata = extSandbox.extractMetadata(html, url);
  article.author = article.author || metadata.author || "";
  article.sitename = metadata.sitename || "";
  article.pubDate = metadata.date || "";
  article.readTime = Math.max(1, Math.round((article.textContent || "").trim().split(/\s+/).filter(function(w){ return w.length > 0; }).length / 200));

  // Count images in content
  var imgRe = /<img\b[^>]*>/g;
  var imgMatches = content.match(imgRe);
  console.log("Images in content: " + (imgMatches ? imgMatches.length : 0));

  // Load epub-generator
  var epubCode = loadCode("extension/epub-generator.js");
  var epubSandbox = {
    DOMParser: win.DOMParser, console: console, Error: Error, Math: Math, Set: Set,
    XMLSerializer: win.XMLSerializer, URL: URL, window: {}, chrome: {},
    JSZip: JSZip,
    Promise: Promise,
    setTimeout: setTimeout,
    Blob: Blob,
    Uint8Array: Uint8Array,
    ArrayBuffer: ArrayBuffer,
  };
  vm.runInNewContext(epubCode + "\n" +
    "this.generateEpub = generateEpub;\n" +
    "this._sanitizeHtmlForEpub = _sanitizeHtmlForEpub;\n" +
    "this._sanitizeKindleText = _sanitizeKindleText;\n",
    epubSandbox);

  // Mock image processor that provides placeholder images
  var blobs = {};
  var imageProcessor = {
    fetchImageAsBlob: async function(src, opts) {
      if (blobs[src]) return blobs[src];
      var blob = createPlaceholderImageBlob(100, 100);
      blobs[src] = blob;
      return blob;
    },
    getImageInfo: async function(blob) {
      return { width: 100, height: 100 };
    },
    shouldSkipImage: function(w, h) { return false; },
    shouldRotateImage: function(w, h) { return false; },
    rotateImage: async function(b) { return b; },
    convertFormat: async function(b, fmt, opts) { return b; },
    deliveryOptimize: async function(b) { return b; },
  };

  var epubBlob = await epubSandbox.generateEpub({
    article: article,
    originalHtml: html,
    url: url,
    title: article.title,
    keepImages: true,
    keepLinks: true,
    deliveryMode: true,
    imageProcessor: imageProcessor,
  });

  var buf = await epubBlob.arrayBuffer();
  var zip = await JSZip.loadAsync(buf);

  // Check content.xhtml for issues
  var contentXhtml = await zip.file("OEBPS/content.xhtml").async("string");
  console.log("content.xhtml length: " + contentXhtml.length + " chars");

  // Count images in output
  var localImgs = contentXhtml.match(/src="images\/img/g);
  var remoteImgs = contentXhtml.match(/src="https?:\/\//g);
  console.log("Local images: " + (localImgs ? localImgs.length : 0));
  console.log("Remote images: " + (remoteImgs ? remoteImgs.length : 0));

  // Check for XML issues
  var unescapedAmp = 0;
  var reAmp = /&(?!amp;|lt;|gt;|quot;|apos;|#x?[0-9a-fA-F]+;)/g;
  var match;
  while ((match = reAmp.exec(contentXhtml)) !== null) {
    var ctx = contentXhtml.slice(Math.max(0, match.index-20), match.index+20);
    if (unescapedAmp < 5) console.log("UNESCAPED &: ..." + JSON.stringify(ctx) + "...");
    unescapedAmp++;
  }
  console.log("Unescaped &: " + unescapedAmp);

  // Check for invalid XML control chars (except tab, CR, LF)
  var invalidXmlChars = contentXhtml.replace(/[\t\r\n]/g, "").match(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g);
  console.log("Invalid XML control chars: " + (invalidXmlChars ? invalidXmlChars.length : 0));

  // Check content.xhtml for HTML5 elements
  var cDoc = new win.DOMParser().parseFromString(contentXhtml, "text/html");
  var html5Tags = ["figure", "picture", "video", "audio", "source", "track", "canvas", "svg", "nav", "figcaption", "main", "aside", "header", "footer", "section", "article", "time", "mark", "details", "summary", "dialog", "data", "progress", "meter"];
  for (var tag of html5Tags) {
    var els = cDoc.querySelectorAll(tag);
    if (els.length > 0) console.log("HTML5 element <" + tag + ">: " + els.length);
  }

  // Check for data-* attributes
  var allEls = cDoc.querySelectorAll("*");
  var dataAttrCount = 0;
  for (var i = 0; i < allEls.length; i++) {
    for (var j = 0; j < (allEls[i].attributes || []).length; j++) {
      var name = allEls[i].attributes[j].name;
      if (name.startsWith("data-")) dataAttrCount++;
    }
  }
  console.log("data-* attributes: " + dataAttrCount);

  // Check for colon-in-attr issues
  var colonAttrCount = 0;
  for (var i = 0; i < allEls.length; i++) {
    for (var j = 0; j < (allEls[i].attributes || []).length; j++) {
      var name = allEls[i].attributes[j].name;
      if (name.includes(":") && !name.startsWith("xml:") && name !== "xmlns") colonAttrCount++;
    }
  }
  console.log("Colon attributes: " + colonAttrCount);

  // Validate XML
  try {
    new JSDOM(contentXhtml, { contentType: "application/xhtml+xml" });
    console.log("XHTML parse: OK");
  } catch(e) {
    console.log("XHTML parse FAILED: " + e.message);
  }

  // Save for epubcheck
  var outPath = "/tmp/debug_nbc3.epub";
  fs.writeFileSync(outPath, Buffer.from(buf));
  console.log("Saved to: " + outPath);

  // Run epubcheck
  var JAVA_HOME = "/opt/homebrew/opt/openjdk";
  var epubcheckJar = "/opt/homebrew/Cellar/epubcheck/5.3.0/libexec/epubcheck.jar";
  if (fs.existsSync(epubcheckJar)) {
    console.log("\nRunning epubcheck...");
    const { execSync } = require("child_process");
    try {
      var output = execSync(
        "JAVA_HOME=" + JAVA_HOME + ' java -jar "' + epubcheckJar + '" "' + outPath + '" 2>&1',
        { encoding: "utf8", timeout: 30000 }
      );
      console.log("epubcheck: OK - " + output.trim().split("\n").pop());
    } catch(e) {
      var lines = (e.stdout || "").split("\n").filter(l => l.includes("ERROR") || l.includes("FATAL") || l.includes("WARN"));
      console.log("Epubcheck errors: " + lines.length);
      lines.forEach(l => console.log("  " + l.trim()));
    }
  }

  console.log("\nDone.");
}

main().catch(e => { console.error("Error:", e.message, e.stack); process.exit(1); });
