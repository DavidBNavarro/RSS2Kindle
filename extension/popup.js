var DEFAULT_SERVER = "http://127.0.0.1:5001";

var SERVER = DEFAULT_SERVER;
var pasteMode = false;
var currentTab = null;
var batchUrls = [];

function $(id) { return document.getElementById(id); }
function show(id) { $(id).classList.remove("hidden"); }
function hide(id) { $(id).classList.add("hidden"); }
function esc(s) { return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }

async function processArticle(url, opts, titleOverride) {
  setProgress("Fetching page…", 10);
  var html;
  try {
    var fetchUrl = await resolveArchiveUrl(url);
    var content = await fetchViaBackground(fetchUrl);
    html = content.text;
  } catch(e) {
    if (currentTab && currentTab.id) {
      html = await fetchRenderedHtml(currentTab.id);
    }
    if (!html) throw new Error("Could not fetch page content. Try opening it in a tab first.");
  }

  setProgress("Extracting article…", 30);
  var article = extractArticle(html, url);
  if (!article) throw new Error("Could not extract article content from this page. Try a page with a clear article body.");

  setProgress("Processing…", 50);
  var title = titleOverride || _getPreviewTitle() || article.title;
  var content = article.content;

  content = stripUiText(content);
  content = stripTrailingRelated(content);
  content = restoreOrderedLists(content, html);
  content = restoreBlockquotes(content, html);
  content = reinjectImages(content, html, url);
  content = reinjectLinks(content, html, url);
  article.content = content;

  var metadata = extractMetadata(html, url);
  article.title = title;
  article.author = article.author || metadata.author || "";
  article.sitename = metadata.sitename || "";
  article.pubDate = metadata.date || "";
  article.readTime = Math.max(1, Math.round((article.textContent || "").trim().split(/\s+/).filter(function(w){ return w.length > 0; }).length / 200));

  setProgress("Generating EPUB…", 70);
  var deliveryMode = opts.deliveryMode === true;
  var epubBlob = await generateEpub({
    article: article,
    originalHtml: html,
    url: url,
    title: title,
    keepImages: opts.keepImages !== false,
    keepLinks: opts.keepLinks !== false,
    deliveryMode: deliveryMode,
    imageProcessor: {
      fetchImageAsBlob: fetchImageAsBlob,
      getImageInfo: getImageInfo,
      shouldSkipImage: shouldSkipImage,
      shouldRotateImage: shouldRotateImage,
      rotateImage: rotateImage,
      convertFormat: convertFormat,
      deliveryOptimize: deliveryOptimize,
    },
  });

  return { epubBlob: epubBlob, title: title, content: content, article: article };
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

function openProcessingTab(action, url, titleOverride, tabIndex, tabId) {
  var params = new URLSearchParams();
  params.set("mode", "popup");
  params.set("action", action);
  params.set("url", url);
  params.set("keepImages", $("keep-images").checked ? "1" : "0");
  params.set("keepLinks", $("keep-links").checked ? "1" : "0");
  params.set("serverUrl", SERVER);
  if (titleOverride) params.set("title", titleOverride);
  params.set("tabIndex", String(tabIndex || 0));
  params.set("openerTabId", String(tabId || ""));
  chrome.tabs.create({
    url: chrome.runtime.getURL("processor.html") + "?" + params.toString(),
    active: false,
    index: (tabIndex || 0) + 1,
  });
  showResult("Processing in new tab…");
  setTimeout(function(){ window.close(); }, 500);
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

async function findWaybackSnapshot(url) {
  try {
    var resp = await fetchViaBackground("https://archive.org/wayback/available?url=" + encodeURIComponent(url));
    var data = JSON.parse(resp.text);
    var snap = data.archived_snapshots && data.archived_snapshots.closest;
    if (snap && snap.url) return snap.url;
  } catch(e) {}
  return null;
}

function setProgress(text, pct) {
  var el = $("progress-text");
  var fill = $("progress-fill");
  if (el) el.textContent = text;
  if (fill) fill.style.width = Math.min(100, Math.max(0, pct)) + "%";
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

function blobToBase64(blob) {
  return new Promise(function(resolve, reject) {
    var reader = new FileReader();
    reader.onloadend = function() { resolve(reader.result.split(",")[1]); };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function sendEpubViaServer(epubBlob, title, url) {
  return new Promise(function(resolve, reject) {
    var filename = (title || "article").replace(/[^A-Za-z0-9._ -]/g, "").trim() || "article";
    if (!filename.endsWith(".epub")) filename += ".epub";
    var formData = new FormData();
    formData.append("epub", epubBlob, filename);
    formData.append("title", title || "Article");
    formData.append("url", url || "");
    fetch(SERVER + "/send-epub", { method: "POST", body: formData })
      .then(function(r) {
        var ct = (r.headers.get("content-type") || "").toLowerCase();
        if (!ct.includes("application/json")) {
          return r.text().then(function(body) {
            var snippet = body.replace(/<[^>]+>/g, "").trim().slice(0, 80);
            throw new Error("Server returned " + r.status + " (" + snippet + "). Try restarting the server: python3 server.py");
          });
        }
        if (!r.ok) {
          return r.json().then(function(d) { throw new Error(d.error || "Server error " + r.status); });
        }
        return r.json();
      })
      .then(function(d) { resolve(d); })
      .catch(function(e) { reject(e); });
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
  var title = $("preview-title") ? $("preview-title").value.trim() : "";
  openProcessingTab("send", url, title || undefined, currentTab ? currentTab.index : 0, tabId);
}

async function handleDownload(url, tabId) {
  if (!(await checkConversionLimit())) return;
  openProcessingTab("download", url, undefined, currentTab ? currentTab.index : 0, tabId);
}

async function handlePreview(url, tabId, tabIndex) {
  var title = $("preview-title") ? $("preview-title").value.trim() : "";
  openProcessingTab("preview", url, title || undefined, tabIndex, tabId);
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
    var title = $("paste-title").value.trim() || undefined;
    if (isUrl) {
      openProcessingTab("send", pastedContent, title, 0);
      return;
    }
    // Pasted text (non-URL) — process inline
    var opts = Object.assign(getOptions(), { deliveryMode: true });
    var htmlWrapped = "<html><body>" + pastedContent.split("\n\n").map(function(p){ return "<p>" + p + "</p>"; }).join("") + "</body></html>";
    var article = extractArticle(htmlWrapped, "");
    if (!article) throw new Error("Could not extract article from pasted text.");
    article.title = title || article.title;
    var content = article.content;
    content = stripUiText(content);
    content = reinjectLinks(content, htmlWrapped, "");
    var metadata = extractMetadata(htmlWrapped, "");
    article.sitename = metadata.sitename || "";
    article.pubDate = metadata.date || article.publishedTime || "";
    article.readTime = Math.max(1, Math.round((article.textContent || "").trim().split(/\s+/).filter(function(w){ return w.length > 0; }).length / 200));
    var result = {
      epubBlob: await generateEpub({
        article: article, originalHtml: htmlWrapped, url: "", title: article.title,
        keepImages: false, keepLinks: opts.keepLinks !== false, imageProcessor: null,
      }),
      title: article.title,
    };
    var sizeWarn = warnEpubSize(result.epubBlob);
    if (sizeWarn.oversize) {
      showError(sizeWarn.message);
      show("actions"); show("options");
      return;
    }
    setProgress("Sending to Kindle…", 85);
    var data = await sendEpubViaServer(result.epubBlob, result.title, "");
    setProgress("Done!", 100);
    showResult(formatSendSuccess(data));
    recordSend(result.title, "", "sent");
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
    var title = $("paste-title").value.trim() || undefined;
    if (isUrl) {
      openProcessingTab("download", pastedContent, title, 0);
      return;
    }
    // Pasted text (non-URL) — process inline
    var opts = getOptions();
    var htmlWrapped = "<html><body>" + pastedContent.split("\n\n").map(function(p){ return "<p>" + p + "</p>"; }).join("") + "</body></html>";
    var article = extractArticle(htmlWrapped, "");
    if (!article) throw new Error("Could not extract article from pasted text.");
    article.title = title || article.title;
    var content = article.content;
    content = stripUiText(content);
    content = reinjectLinks(content, htmlWrapped, "");
    var result = {
      epubBlob: await generateEpub({
        article: article, originalHtml: htmlWrapped, url: "", title: article.title,
        keepImages: false, keepLinks: opts.keepLinks !== false, imageProcessor: null,
      }),
      title: article.title,
    };
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
  var urls = getBatchUrls();
  if (urls.length === 0) { showError("No URLs to process"); return; }
  await new Promise(function(resolve) {
    chrome.storage.local.set({
      batch_data: {
        urls: urls,
        keepImages: $("keep-images").checked,
        keepLinks: $("keep-links").checked,
      }
    }, resolve);
  });
  var params = new URLSearchParams();
  params.set("mode", "popup");
  params.set("action", "batch-send");
  chrome.tabs.create({
    url: chrome.runtime.getURL("processor.html") + "?" + params.toString(),
    active: false,
    index: (currentTab ? currentTab.index : 0) + 1,
  });
  showResult("Processing " + urls.length + " URLs in new tab…");
  setTimeout(function(){ window.close(); }, 500);
}

async function handleBatchDownload() {
  if (!(await checkConversionLimit())) return;
  var urls = getBatchUrls();
  if (urls.length === 0) { showError("No URLs to process"); return; }
  await new Promise(function(resolve) {
    chrome.storage.local.set({
      batch_data: {
        urls: urls,
        keepImages: $("keep-images").checked,
        keepLinks: $("keep-links").checked,
      }
    }, resolve);
  });
  var params = new URLSearchParams();
  params.set("mode", "popup");
  params.set("action", "batch-download");
  chrome.tabs.create({
    url: chrome.runtime.getURL("processor.html") + "?" + params.toString(),
    active: false,
    index: (currentTab ? currentTab.index : 0) + 1,
  });
  showResult("Processing " + urls.length + " URLs in new tab…");
  setTimeout(function(){ window.close(); }, 500);
}

async function handleBatchRetry(failedItems, mode) {
  if (!failedItems || failedItems.length === 0) return;
  var urls = failedItems.map(function(item){ return item.url; });
  await new Promise(function(resolve) {
    chrome.storage.local.set({
      batch_data: {
        urls: urls,
        keepImages: $("keep-images").checked,
        keepLinks: $("keep-links").checked,
      }
    }, resolve);
  });
  var params = new URLSearchParams();
  params.set("mode", "popup");
  params.set("action", mode === "download" ? "batch-download" : "batch-send");
  chrome.tabs.create({
    url: chrome.runtime.getURL("processor.html") + "?" + params.toString(),
    active: false,
  });
  showResult("Retrying " + urls.length + " URL" + (urls.length > 1 ? "s" : "") + " in new tab…");
  setTimeout(function(){ window.close(); }, 500);
}

async function checkAuth() {
  try {
    var token = await new Promise(function(resolve, reject) {
      chrome.identity.getAuthToken({ interactive: false }, function(t) {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(t);
      });
    });
    return { authed: !!token };
  } catch(e) {
    return { authed: false };
  }
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

async function checkConversionLimit() {
  return true;
}

async function initPopup() {
  await loadServerUrl();
  await loadOptions();

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
    initPopup();
  });

  $("settings-link").addEventListener("click", function(e){ e.preventDefault(); chrome.runtime.openOptionsPage(); });
  $("history-link").addEventListener("click", function(e){ e.preventDefault(); chrome.tabs.create({ url: chrome.runtime.getURL("history.html") }); });
  $("paste-toggle").addEventListener("click", function(e){ e.preventDefault(); togglePasteMode(); });
  $("paste-input").addEventListener("input", updatePasteBadge);

  $("keep-images").addEventListener("change", function(){ chrome.storage.local.set({ keepImages: $("keep-images").checked }); });
  $("keep-links").addEventListener("change", function(){ chrome.storage.local.set({ keepLinks: $("keep-links").checked }); });
});
