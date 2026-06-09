const HISTORY_KEY = 'web2kindle_history';
const MAX_ENTRIES = 500;

async function getHistory() {
  const result = await chrome.storage.local.get(HISTORY_KEY);
  return result[HISTORY_KEY] || [];
}

async function addEntry({ title, url, status = 'sent', error = null }) {
  const history = await getHistory();
  const entry = {
    id: Date.now(),
    title: title || '',
    url: url || '',
    sentAt: new Date().toISOString(),
    status,
    error,
  };
  history.unshift(entry);
  if (history.length > MAX_ENTRIES) {
    history.length = MAX_ENTRIES;
  }
  await chrome.storage.local.set({ [HISTORY_KEY]: history });
  return entry;
}

async function recordSend(title, url, status, error) {
  try { await addEntry({ title, url, status, error }); } catch { /* storage failure — non-critical */ }
}

async function getEntries({ q, url } = {}) {
  let entries = await getHistory();
  if (url) {
    return entries.filter(e => e.url === url);
  }
  if (q) {
    const lower = q.toLowerCase();
    return entries.filter(e =>
      (e.title && e.title.toLowerCase().includes(lower)) ||
      (e.url && e.url.toLowerCase().includes(lower))
    );
  }
  return entries;
}

async function removeEntry(id) {
  let entries = await getHistory();
  entries = entries.filter(e => e.id !== id);
  await chrome.storage.local.set({ [HISTORY_KEY]: entries });
}

const MIGRATED_KEY = 'web2kindle_history_migrated';

async function migrateFromServer(serverUrl) {
  const { [MIGRATED_KEY]: done } = await chrome.storage.local.get(MIGRATED_KEY);
  if (done) return;
  try {
    const resp = await fetch(`${serverUrl}/history`, { signal: AbortSignal.timeout(5000) });
    if (!resp.ok) return;
    const rows = await resp.json();
    if (!Array.isArray(rows) || rows.length === 0) {
      await chrome.storage.local.set({ [MIGRATED_KEY]: true });
      return;
    }
    const entries = rows.map(r => ({
      id: r.id,
      title: r.title || '',
      url: r.url || '',
      sentAt: r.sent_at,
      status: r.status || 'sent',
      error: r.error || null,
    }));
    await chrome.storage.local.set({ [HISTORY_KEY]: entries, [MIGRATED_KEY]: true });
  } catch {
    /* server not reachable — skip migration */
  }
}
