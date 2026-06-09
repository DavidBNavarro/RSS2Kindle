var _params = new URLSearchParams(location.search);
var ACTION = _params.get("action");
var MODE = _params.get("mode");
var TARGET_URL = _params.get("url") || "";
var SELECTION = _params.get("selection");
var PAGE_TITLE = _params.get("pageTitle") || "";
var TAB_INDEX = parseInt(_params.get("tabIndex") || "0", 10);
var OPENER_TAB_ID = parseInt(_params.get("openerTabId") || "0", 10);

var POPUP_KEEP_IMAGES = _params.get("keepImages") !== "0";
var POPUP_KEEP_LINKS = _params.get("keepLinks") !== "0";
var POPUP_TITLE = _params.get("title") || "";
var POPUP_SERVER_URL = _params.get("serverUrl") || "";

function setStatus(msg, detail) {
  var el = document.getElementById("progress-status");
  if (el) el.textContent = msg;
  var d = document.getElementById("progress-detail");
  if (d && detail) d.textContent = detail;
}

function showSuccess(title, message) {
  document.getElementById("progress").style.display = "none";
  var el = document.getElementById("result-success");
  el.classList.add("show");
  document.getElementById("result-title").textContent = title;
  document.getElementById("result-message").textContent = message;
}

function showError(message, detail) {
  document.getElementById("progress").style.display = "none";
  var el = document.getElementById("result-error");
  el.classList.add("show");
  document.getElementById("error-message").textContent = message;
  var d = document.getElementById("error-detail");
  if (d && detail) d.textContent = detail;
}

function esc(s) { return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }

var _logEl = document.getElementById("log");
function log(msg) { try { if (_logEl) _logEl.textContent += msg + "\n"; } catch(e) {} }
log("processor.js loaded at " + new Date().toISOString());
log("Params: mode=" + _params.get("mode") + " action=" + _params.get("action") + " url=" + (_params.get("url") || "none"));
// FREE_LIMIT imported from conversion-counter.js (const)

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

async function findWaybackSnapshot(url) {
  try {
    var resp = await fetchViaBackground("https://archive.org/wayback/available?url=" + encodeURIComponent(url));
    var data = JSON.parse(resp.text);
    var snap = data.archived_snapshots && data.archived_snapshots.closest;
    if (snap && snap.url) return snap.url;
  } catch(e) {}
  return null;
}

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

function blobToBase64(blob) {
  return new Promise(function(resolve, reject) {
    var reader = new FileReader();
    reader.onloadend = function() { resolve(reader.result.split(",")[1]); };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function sendEmailViaBackground(epubBase64, title, url, filename) {
  return new Promise(function(resolve, reject) {
    filename = (filename || "article").replace(/[^A-Za-z0-9._ -]/g, "").trim() || "article";
    if (!filename.endsWith(".epub")) filename += ".epub";
    chrome.runtime.sendMessage({ action: "sendEmail", epub: epubBase64, title: title, url: url, filename: filename }, function(resp) {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (resp.error) return reject(new Error(resp.error));
      resolve(resp);
    });
  });
}

function formatSendSuccess(result) {
  var base = "Sent to " + result.kindle_email;
  return result.delivery_notice ? base + " (" + result.delivery_notice + ")" : base;
}

function showNotification(title, message) {
  chrome.notifications.create({
    type: "basic",
    iconUrl: "icons/icon48.png",
    title: title,
    message: message,
    priority: 2,
  });
}

async function checkConversionLimit() {
  if (await hasProLicense()) return true;
  var count = await getConversionCount();
  return count < FREE_LIMIT;
}

async function processLink() {
  setStatus("Fetching page…");
  var fetchUrl = await resolveArchiveUrl(TARGET_URL);
  var content = await fetchViaBackground(fetchUrl);
  setStatus("Extracting article…");
  var article = extractArticle(content.text, TARGET_URL);
  if (!article) throw new Error("Could not extract article from this page.");
  return { article: article, html: content.text };
}

function createSelectionArticle() {
  var wrappedHtml = "<html><body><p>" + (SELECTION || "").split("\n\n").map(function(p){ return p.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }).join("</p><p>") + "</p></body></html>";
  var article = extractArticle(wrappedHtml, "");
  if (article) {
    article.title = "Clipped from " + PAGE_TITLE;
    return { article: article, html: wrappedHtml };
  }
  var wordCount = (SELECTION || "").split(/\s+/).filter(function(w){ return w.length > 0; }).length;
  article = {
    title: "Clipped from " + PAGE_TITLE,
    content: wrappedHtml,
    textContent: SELECTION || "",
    length: (SELECTION || "").length,
    readTime: Math.max(1, Math.round(wordCount / 200)),
  };
  return { article: article, html: wrappedHtml };
}

function postProcess(content, html, url) {
  content = stripUiText(content);
  content = stripTrailingRelated(content);
  content = restoreOrderedLists(content, html);
  content = restoreBlockquotes(content, html);
  content = reinjectImages(content, html, url);
  content = reinjectLinks(content, html, url);
  return content;
}

async function buildEpub(article, html, url, keepImages, keepLinks, deliveryMode) {
  setStatus("Processing content…");
  var content = postProcess(article.content || "", html, url);
  article.content = content;
  article.readTime = Math.max(1, Math.round((article.textContent || "").trim().split(/\s+/).filter(function(w){ return w.length > 0; }).length / 200));
  var imageProcessor = keepImages ? {
    fetchImageAsBlob: fetchImageAsBlob,
    getImageInfo: getImageInfo,
    shouldSkipImage: shouldSkipImage,
    shouldRotateImage: shouldRotateImage,
    rotateImage: rotateImage,
    convertFormat: convertFormat,
    deliveryOptimize: deliveryOptimize,
  } : null;
  setStatus("Generating EPUB…");
  var epubBlob = await generateEpub({
    article: article,
    originalHtml: html,
    url: url,
    title: article.title,
    keepImages: keepImages,
    keepLinks: keepLinks,
    deliveryMode: deliveryMode,
    imageProcessor: imageProcessor,
  });
  return epubBlob;
}

async function handleSend(epubBlob, title) {
  var sizeWarn = warnEpubSize(epubBlob);
  if (sizeWarn.oversize) {
    showError(sizeWarn.message);
    return;
  }
  setStatus("Sending to Kindle…");
  var base64 = await blobToBase64(epubBlob);
  var result = await sendEmailViaBackground(base64, title, TARGET_URL, (title || "article") + ".epub");
  await incrementConversion();
  recordSend(title, TARGET_URL, "sent");
  showSuccess("Sent to Kindle", formatSendSuccess(result));
}

function triggerDownload(blob, filename) {
  var url = URL.createObjectURL(blob);
  var a = document.createElement("a");
  a.href = url;
  a.download = filename || "article.epub";
  a.click();
  URL.revokeObjectURL(url);
}

async function handleDownload(epubBlob, title) {
  triggerDownload(epubBlob, (title || "article") + ".epub");
  await incrementConversion();
  showSuccess("Downloaded", '"' + title + '" saved as EPUB');
}

async function handleBatchSend(urls, keepImages, keepLinks) {
  var total = urls.length, done = 0, failed = 0;
  for (var i = 0; i < total; i++) {
    var url = urls[i];
    setStatus("Processing " + (i + 1) + "/" + total + "…", url);
    try {
      var html = (await fetchViaBackground(url)).text;
      var article = extractArticle(html, url);
      if (!article) throw new Error("Could not extract article");
      article.content = postProcess(article.content || "", html, url);
      article.readTime = Math.max(1, Math.round((article.textContent || "").trim().split(/\s+/).filter(function(w){ return w.length > 0; }).length / 200));
      var imageProcessor = keepImages ? {
        fetchImageAsBlob: fetchImageAsBlob, getImageInfo: getImageInfo,
        shouldSkipImage: shouldSkipImage, shouldRotateImage: shouldRotateImage,
        rotateImage: rotateImage, convertFormat: convertFormat, deliveryOptimize: deliveryOptimize,
      } : null;
      setStatus("Generating EPUB for " + (i + 1) + "/" + total + "…", url);
      var epubBlob = await generateEpub({
        article: article, originalHtml: html, url: url, title: article.title,
        keepImages: keepImages, keepLinks: keepLinks, deliveryMode: true,
        imageProcessor: imageProcessor,
      });
      var sizeWarn = warnEpubSize(epubBlob);
      if (sizeWarn.oversize) throw new Error(sizeWarn.message);
      var base64 = await blobToBase64(epubBlob);
      setStatus("Sending " + (i + 1) + "/" + total + "…", url);
      var result = await sendEmailViaBackground(base64, article.title, url, (article.title || "article") + ".epub");
      await incrementConversion();
      recordSend(article.title, url, "sent");
      done++;
    } catch(e) {
      recordSend("", url, "failed", e.message);
      failed++;
    }
  }
  if (failed === 0) showSuccess("All sent!", done + " article" + (done > 1 ? "s" : "") + " sent to Kindle");
  else showSuccess(done + " sent, " + failed + " failed", "Check History for details");
}

async function handleBatchDownload(urls, keepImages, keepLinks) {
  var total = urls.length, done = 0, failed = 0;
  for (var i = 0; i < total; i++) {
    var url = urls[i];
    setStatus("Processing " + (i + 1) + "/" + total + "…", url);
    try {
      var html = (await fetchViaBackground(url)).text;
      var article = extractArticle(html, url);
      if (!article) throw new Error("Could not extract article");
      article.content = postProcess(article.content || "", html, url);
      article.readTime = Math.max(1, Math.round((article.textContent || "").trim().split(/\s+/).filter(function(w){ return w.length > 0; }).length / 200));
      var imageProcessor = keepImages ? {
        fetchImageAsBlob: fetchImageAsBlob, getImageInfo: getImageInfo,
        shouldSkipImage: shouldSkipImage, shouldRotateImage: shouldRotateImage,
        rotateImage: rotateImage, convertFormat: convertFormat, deliveryOptimize: deliveryOptimize,
      } : null;
      setStatus("Generating EPUB for " + (i + 1) + "/" + total + "…", url);
      var epubBlob = await generateEpub({
        article: article, originalHtml: html, url: url, title: article.title,
        keepImages: keepImages, keepLinks: keepLinks, deliveryMode: false,
        imageProcessor: imageProcessor,
      });
      triggerDownload(epubBlob, (article.title || "article-") + (i + 1) + ".epub");
      await incrementConversion();
      done++;
    } catch(e) {
      failed++;
    }
  }
  if (failed === 0) showSuccess("All downloaded!", done + " EPUB" + (done > 1 ? "s" : "") + " saved");
  else showSuccess(done + " downloaded, " + failed + " failed", "Some articles could not be processed");
}

async function handlePreview(epubBlob, article, html, title) {
  var metadata = extractMetadata(html, TARGET_URL);
  article.author = article.author || metadata.author || "";
  article.sitename = metadata.sitename || "";
  article.pubDate = metadata.date || "";
  article.readTime = Math.max(1, Math.round((article.textContent || "").trim().split(/\s+/).filter(function(w){ return w.length > 0; }).length / 200));
  var a = article;
  var today = new Date();
  var sentDate = today.getFullYear() + "-" + String(today.getMonth() + 1).padStart(2, "0") + "-" + String(today.getDate()).padStart(2, "0");
  var metaParts = [];
  if (a.author) metaParts.push(a.author);
  if (a.sitename) metaParts.push(a.sitename);
  if (a.pubDate) metaParts.push(a.pubDate);
  if (a.readTime) metaParts.push(a.readTime + " min read");
  function esc(s) { return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
  function dr(label, value) { if (value && value.trim() && value.trim() !== "Unknown" && value.trim() !== "Untitled") return "<tr><td class=\"label\">" + esc(label) + "</td><td class=\"value\">" + esc(value) + "</td></tr>"; return ""; }
  var detailsRows = "";
  detailsRows += dr("Title", title);
  detailsRows += dr("Author", a.author);
  detailsRows += dr("Published", a.pubDate);
  detailsRows += dr("Source", a.sitename);
  detailsRows += dr("URL", TARGET_URL);
  detailsRows += dr("Sent to Kindle", sentDate);
  if (a.readTime) detailsRows += dr("Reading time", a.readTime + " min");
  var detailsHtml = detailsRows ? "<table class=\"details-table\"><tbody>" + detailsRows + "</tbody></table>" : "";
  await new Promise(function(resolve) {
    chrome.storage.local.set({
      preview_data: {
        title: title,
        content: article.content,
        detailsHtml: detailsHtml,
        metaHtml: metaParts.join(" · "),
        serverUrl: POPUP_SERVER_URL,
        url: TARGET_URL,
        openerTabId: OPENER_TAB_ID,
      }
    }, resolve);
  });
  log("Opening preview tab…");
  chrome.runtime.sendMessage({ action: "openPreview" });
}

async function run() {
  try {
    setStatus("Starting…");
    if (!(await checkConversionLimit())) {
      showError("Free limit reached", "You've used all " + FREE_LIMIT + " free conversions. Upgrade to Pro for unlimited.");
      return;
    }

    if (ACTION === "batch-send" || ACTION === "batch-download") {
      var batchData = await new Promise(function(resolve) {
        chrome.storage.local.get("batch_data", function(data) { resolve(data.batch_data || {}); });
      });
      chrome.storage.local.remove("batch_data");
      var urls = batchData.urls || [];
      var keepImages = batchData.keepImages !== false;
      var keepLinks = batchData.keepLinks !== false;
      if (urls.length === 0) throw new Error("No URLs to process");
      if (ACTION === "batch-send") {
        await handleBatchSend(urls, keepImages, keepLinks);
      } else {
        await handleBatchDownload(urls, keepImages, keepLinks);
      }
      return;
    }

    var keepImages, keepLinks;
    if (MODE === "popup") {
      keepImages = POPUP_KEEP_IMAGES;
      keepLinks = POPUP_KEEP_LINKS;
    } else {
      var stored = await chrome.storage.local.get({ keepImages: true, keepLinks: true });
      keepImages = stored.keepImages;
      keepLinks = stored.keepLinks;
    }

    var result;
    if (MODE === "link" || MODE === "popup") {
      result = await processLink();
    } else if (MODE === "selection") {
      result = createSelectionArticle();
    } else {
      throw new Error("Unknown mode: " + MODE);
    }

    var title = POPUP_TITLE || result.article.title || "Article";

    setStatus("Building EPUB…");
    var epubBlob = await buildEpub(result.article, result.html, TARGET_URL, keepImages, keepLinks, ACTION === "send" || ACTION === "batch-send");

    if (ACTION === "send") {
      await handleSend(epubBlob, title);
    } else if (ACTION === "preview") {
      await handlePreview(epubBlob, result.article, result.html, title);
    } else if (ACTION === "download") {
      await handleDownload(epubBlob, title);
    }
  } catch(err) {
    log("ERROR: " + err.message + "\n" + (err.stack || ""));
    showError(err.message, err.stack || "");
    recordSend("", TARGET_URL, "failed", err.message);
  }
}

run();
