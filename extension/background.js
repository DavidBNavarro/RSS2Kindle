function base64UrlSafe(str) {
  return str.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function buildMimeMessage(from, to, subject, epubBase64, filename) {
  var boundary = "boundary_" + Date.now() + "_" + Math.random().toString(36).slice(2);
  var body = "";
  body += "From: " + from + "\r\n";
  body += "To: " + to + "\r\n";
  body += "Subject: " + subject + "\r\n";
  body += "MIME-Version: 1.0\r\n";
  body += "Content-Type: multipart/mixed; boundary=\"" + boundary + "\"\r\n\r\n";
  body += "--" + boundary + "\r\n";
  body += "Content-Type: text/plain; charset=\"UTF-8\"\r\n\r\n";
  body += "Article sent from Web2Kindle\r\n\r\n";
  body += "--" + boundary + "\r\n";
  body += "Content-Type: application/octet-stream\r\n";
  body += "Content-Disposition: attachment; filename=\"" + (filename || "article.epub") + "\"\r\n";
  body += "Content-Transfer-Encoding: base64\r\n\r\n";
  body += (epubBase64.match(/.{1,76}/g) || []).join("\r\n") + "\r\n";
  body += "--" + boundary + "--";
  return body;
}

chrome.runtime.onInstalled.addListener(function() {
  chrome.contextMenus.create({
    id: "send-to-kindle",
    title: "Send to Kindle",
    contexts: ["link", "selection"],
  });
  chrome.contextMenus.create({
    id: "send-to-kindle-preview",
    title: "Send to Kindle (Preview)",
    contexts: ["link", "selection"],
  });
});

chrome.contextMenus.onClicked.addListener(function(info, tab) {
  var params = new URLSearchParams();
  if (info.linkUrl) {
    params.set("mode", "link");
    params.set("url", info.linkUrl);
  } else if (info.selectionText) {
    params.set("mode", "selection");
    params.set("selection", info.selectionText);
    params.set("pageTitle", tab ? tab.title || "" : "");
  } else {
    return;
  }
  params.set("action", info.menuItemId === "send-to-kindle" ? "send" : "preview");
  params.set("tabIndex", tab ? String(tab.index) : "0");
  params.set("openerTabId", tab ? String(tab.id) : "");
  var processorUrl = chrome.runtime.getURL("processor.html") + "?" + params.toString();
  chrome.tabs.create({ url: processorUrl, active: false, index: (tab ? tab.index : 0) + 1 });
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "processorDone" && sender.tab) {
    chrome.tabs.remove(sender.tab.id);
    return;
  }

  if (msg.action === "openPreview" && sender.tab) {
    chrome.tabs.update(sender.tab.id, { url: chrome.runtime.getURL("preview.html"), active: true });
    return;
  }

  if (msg.action === "fetchPageContent") {
    fetch(msg.url)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const contentType = (r.headers.get("content-type") || "").split(";", 1)[0].trim().toLowerCase();
        if (contentType.startsWith("text/html")) {
          return r.text().then((text) => {
            sendResponse({ text, contentType: contentType || "text/html", sourceMode: "html-fetch" });
          });
        }
        return r.arrayBuffer().then((buf) => {
          const bytes = new Uint8Array(buf);
          let binary = "";
          const chunk = 8192;
          for (let i = 0; i < bytes.length; i += chunk) {
            binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
          }
          sendResponse({
            base64: btoa(binary),
            contentType: contentType || "application/octet-stream",
            sourceMode: contentType === "application/pdf" ? "pdf" : "html-fetch",
          });
        });
      })
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }

  if (msg.action === "sendEmail") {
    (async () => {
      try {
        var token = await new Promise(function(resolve, reject) {
          chrome.identity.getAuthToken({ interactive: true }, function(t) {
            if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
            else resolve(t);
          });
        });

        var profileResp = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
          headers: { Authorization: "Bearer " + token },
        });
        if (!profileResp.ok) throw new Error("Failed to get Gmail profile");
        var profile = await profileResp.json();
        var fromEmail = profile.emailAddress;

        var smtp = await chrome.storage.sync.get({ kindle_email: "" });
        if (!smtp.kindle_email) throw new Error("Kindle email not configured. Set it in Settings.");
        var toEmail = smtp.kindle_email;

        var mime = buildMimeMessage(fromEmail, toEmail, "convert", msg.epub, msg.filename || "article.epub");
        var raw = base64UrlSafe(btoa(unescape(encodeURIComponent(mime))));

        var sendResp = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
          method: "POST",
          headers: {
            Authorization: "Bearer " + token,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ raw: raw }),
        });
        var sendData = await sendResp.json();
        if (!sendResp.ok) {
          var apiErr = sendData.error?.message || sendData.error || "";
          throw new Error("Gmail API error (" + sendResp.status + ")" + (apiErr ? ": " + apiErr : ""));
        }
        sendResponse({ success: true, kindle_email: toEmail });
      } catch (err) {
        sendResponse({ error: err.message });
      }
    })();
    return true;
  }
});
