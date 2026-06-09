const DEFAULT_SERVER = "http://127.0.0.1:5001";
let SERVER = DEFAULT_SERVER;
let debounceTimer;

function $(id) { return document.getElementById(id); }
function hide(id) { $(id).classList.add("hidden"); }
function show(id) { $(id).classList.remove("hidden"); }

function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function getDomain(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
}

function renderList(items) {
  const list = $("history-list");
  list.innerHTML = "";
  if (!items.length) { show("empty-state"); return; }
  hide("empty-state");
  for (const item of items) {
    const failed = item.status === "failed";
    const li = document.createElement("li");
    li.className = "history-item" + (failed ? " failed" : "");
    li.dataset.id = item.id;
    const titleText = item.title || "(untitled)";
    const copyIcon = `<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M4 1.5H3a2 2 0 0 0-2 2V14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V3.5a2 2 0 0 0-2-2h-1v1h1a1 1 0 0 1 1 1V14a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1h1v-1z"/><path d="M9.5 1a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-.5.5h-3a.5.5 0 0 1-.5-.5v-1a.5.5 0 0 1 .5-.5h3zm-3-1A1.5 1.5 0 0 0 5 1.5v1A1.5 1.5 0 0 0 6.5 4h3A1.5 1.5 0 0 0 11 2.5v-1A1.5 1.5 0 0 0 9.5 0h-3z"/></svg>`;
    const titleSpan = item.url
      ? `<span class="item-title-text clickable" title="Open source">${titleText}</span><button class="btn-copy" title="Copy URL">${copyIcon}</button>`
      : `<span class="item-title-text">${titleText}</span>`;
    const badgeHtml = failed
      ? `<span class="badge-failed" title="${item.error ? item.error.replace(/"/g, '&quot;') : 'Send failed'}">Failed</span>`
      : "";
    li.innerHTML = `
      <div class="item-meta">
        <div class="item-title">${titleSpan}${badgeHtml}</div>
        <div class="item-sub">${item.url ? getDomain(item.url) + " · " : ""}${formatDate(item.sentAt)}</div>
      </div>
      <div class="item-actions">
        <button class="btn-delete" title="Remove from history">✕</button>
      </div>`;
    li.querySelector(".btn-delete").addEventListener("click", () => deleteItem(item.id, li));
    const titleEl = li.querySelector(".item-title-text.clickable");
    if (titleEl) {
      titleEl.addEventListener("click", () => {
        chrome.tabs.getCurrent(tab => {
          chrome.tabs.create({ url: item.url, index: tab.index + 1 });
        });
      });
    }
    const copyBtn = li.querySelector(".btn-copy");
    if (copyBtn) {
      copyBtn.addEventListener("click", () => {
        navigator.clipboard.writeText(item.url).then(() => {
          copyBtn.title = "Copied!";
          copyBtn.style.color = "#16a34a";
          setTimeout(() => { copyBtn.title = "Copy URL"; copyBtn.style.color = ""; }, 1500);
        });
      });
    }
    list.appendChild(li);
  }
}

async function loadHistory(q = "") {
  try {
    const entries = await getEntries({ q });
    renderList(entries);
  } catch {
    $("history-list").innerHTML =
      `<li style="color:#ef4444;font-size:13px;padding:16px 0">Could not load history.</li>`;
  }
}

async function deleteItem(id, li) {
  await removeEntry(id);
  li.remove();
  if (!$("history-list").children.length) show("empty-state");
}

$("search-input").addEventListener("input", e => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => loadHistory(e.target.value.trim()), 250);
});

chrome.storage.sync.get({ serverUrl: DEFAULT_SERVER }, async ({ serverUrl }) => {
  SERVER = serverUrl;
  await migrateFromServer(SERVER);
  loadHistory();
});