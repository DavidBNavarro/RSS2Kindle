# SMTP Creds in chrome.storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) for syntax tracking.

**Goal:** Migrate SMTP credentials from server `config.json` to `chrome.storage.sync`. Remove `/config` API dependency.

**Architecture:** Extension saves SMTP creds to `chrome.storage.sync`. On each send, reads creds and includes them as form fields in `/send-epub`. Server reads creds from request instead of config.json. `/config` endpoints removed.

**Tech Stack:** Python/Flask, Chrome Extension (MV3), vanilla JS

---

### Task 1: Server — remove /config, accept inline SMTP creds

**Files:**
- Modify: `server.py`

- [ ] **Step 1: Remove `CONFIG_PATH` constant**

Delete line 30: `CONFIG_PATH = Path(__file__).parent / "config.json"` (no longer used anywhere).

- [ ] **Step 2: Remove config.json dependency from `_send_epub_to_kindle()`**

Replace the function signature and body to accept a `cfg` dict parameter instead of reading from disk:

Change lines 225-297 from:
```python
def _send_epub_to_kindle(epub_path: str) -> dict:
    if not CONFIG_PATH.exists():
        raise ValueError("SMTP not configured. Use the Settings page.")
    cfg = json.loads(CONFIG_PATH.read_text())
    missing = [k for k in ("kindle_email", "smtp_host", "smtp_port", "smtp_user", "smtp_password")
               if not cfg.get(k)]
    if missing:
        raise ValueError(f"Missing SMTP config: {', '.join(missing)}")
    ...rest of function using cfg...
```

To:
```python
def _send_epub_to_kindle(cfg: dict, epub_path: str) -> dict:
    missing = [k for k in ("kindle_email", "smtp_host", "smtp_port", "smtp_user", "smtp_password")
               if not cfg.get(k)]
    if missing:
        raise ValueError(f"Missing SMTP config: {', '.join(missing)}")
    ...rest of function using cfg (same logic)...
```

- [ ] **Step 3: Update `/send-epub` route to parse SMTP fields from form**

Change line 306-331 (`send_epub()`):
```python
@app.route("/send-epub", methods=["POST"])
def send_epub():
    file = request.files.get("epub")
    if not file:
        return jsonify({"error": "No EPUB file provided"}), 400
    title = request.form.get("title", "Article")
    url = request.form.get("url", "")
    cfg = {
        "kindle_email": request.form.get("kindle_email", ""),
        "smtp_host": request.form.get("smtp_host", ""),
        "smtp_port": request.form.get("smtp_port", ""),
        "smtp_user": request.form.get("smtp_user", ""),
        "smtp_password": request.form.get("smtp_password", ""),
    }
    send_error = None
    epub_path = None
    try:
        tmp = tempfile.NamedTemporaryFile(suffix=".epub", delete=False)
        tmp_path = tmp.name
        tmp.close()
        file.save(tmp_path)
        epub_path = tmp_path
        result = _send_epub_to_kindle(cfg, epub_path)
        return jsonify({"success": True, **result})
    except ValueError as e:
        send_error = str(e)
        return jsonify({"error": send_error}), 400
    except Exception as e:
        send_error = str(e)
        return jsonify({"error": send_error}), 500
    finally:
        if epub_path:
            _log_sent(title, url, epub_path, status="failed" if send_error else "sent", error=send_error)
            Path(epub_path).unlink(missing_ok=True)
```

- [ ] **Step 4: Update `/send-html` route to parse SMTP fields from JSON**

Change line 334-393 (`send_html()`). After parsing `data`, add:
```python
    cfg = {
        "kindle_email": data.get("kindle_email", ""),
        "smtp_host": data.get("smtp_host", ""),
        "smtp_port": data.get("smtp_port", ""),
        "smtp_user": data.get("smtp_user", ""),
        "smtp_password": data.get("smtp_password", ""),
    }
```
And change line 383 from `_send_epub_to_kindle(tmp_path)` to `_send_epub_to_kindle(cfg, tmp_path)`.

- [ ] **Step 5: Remove `/config` routes**

Delete lines 405-423 (`GET /config` and `POST /config`).

- [ ] **Step 6: Run Python tests to verify**

```bash
python -m pytest tests/ -v
```
Expected: 19 passed.

- [ ] **Step 7: Commit**

```bash
git add server.py
git commit -m "refactor: remove /config endpoints, accept SMTP creds inline in /send-epub"
```

---

### Task 2: Extension options — save/load SMTP from chrome.storage

**Files:**
- Modify: `extension/options.js`
- Modify: `extension/options.html`

- [ ] **Step 1: Replace server config fetch with chrome.storage load**

In `options.js`, replace lines 32-44 (the `fetch(/config)` block) with:
```javascript
  const smtp = await chrome.storage.sync.get({
    kindle_email: "",
    smtp_host: "smtp.gmail.com",
    smtp_port: "587",
    smtp_user: "",
    smtp_password: "",
  });
  if (smtp.kindle_email) document.getElementById("kindle-email").value = smtp.kindle_email;
  if (smtp.smtp_host) document.getElementById("smtp-host").value = smtp.smtp_host;
  if (smtp.smtp_port) document.getElementById("smtp-port").value = smtp.smtp_port;
  if (smtp.smtp_user) document.getElementById("smtp-user").value = smtp.smtp_user;
  if (smtp.smtp_user) document.getElementById("smtp-password").placeholder = "(saved)";
```

- [ ] **Step 2: Replace server config save with chrome.storage save**

Replace lines 90-136 (the form submit handler) with:
```javascript
document.getElementById("config-form").addEventListener("submit", async (e) => {
  e.preventDefault();

  const newServerUrl = document.getElementById("server-url").value.replace(/\/+$/, "") || DEFAULT_SERVER;
  const paywalledHosts = document.getElementById("paywalled-hosts").value.trim();
  const paywallSelectors = document.getElementById("paywall-selectors").value.trim();
  const archiveDomains = document.getElementById("archive-domains").value.trim();
  const archiveTimeoutMs = Number(document.getElementById("archive-timeout").value) || ARCHIVE_DEFAULTS.archiveTimeoutMs;
  const archiveRetries = Math.max(1, Number(document.getElementById("archive-retries").value) || ARCHIVE_DEFAULTS.archiveRetries);
  const archiveRenderStrategy = document.getElementById("archive-render").value;

  const kindle_email = document.getElementById("kindle-email").value.trim();
  const smtp_host = document.getElementById("smtp-host").value.trim();
  const smtp_port = document.getElementById("smtp-port").value.trim();
  const smtp_user = document.getElementById("smtp-user").value.trim();
  const smtp_password = document.getElementById("smtp-password").value.trim();

  const smtpSettings = {
    kindle_email,
    smtp_host: smtp_host || "smtp.gmail.com",
    smtp_port: smtp_port || "587",
    smtp_user,
    smtp_password: smtp_password || undefined,
  };

  await chrome.storage.sync.set({
    serverUrl: newServerUrl,
    paywalledHosts,
    paywallSelectors,
    archiveDomains,
    archiveTimeoutMs,
    archiveRetries,
    archiveRenderStrategy,
    ...smtpSettings,
  });
  SERVER = newServerUrl;

  const pwField = document.getElementById("smtp-password");
  if (pwField.value) { pwField.value = ""; pwField.placeholder = "(saved)"; }

  showStatus("Settings saved!", "success");
});
```

- [ ] **Step 3: Run JS tests**

```bash
node tests/popup.test.js
```
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add extension/options.js
git commit -m "feat: save SMTP config to chrome.storage instead of server /config endpoint"
```

---

### Task 3: Extension popup — include SMTP creds in /send-epub

**Files:**
- Modify: `extension/popup.js`

- [ ] **Step 1: Add `loadSmtpConfig()` helper and `appendSmtpToForm()` helper**

Add these functions near the top of popup.js (after `resolveArchiveUrl`):

```javascript
async function appendSmtpToForm(formData) {
  var smtp = await chrome.storage.sync.get({
    kindle_email: "",
    smtp_host: "",
    smtp_port: "",
    smtp_user: "",
    smtp_password: "",
  });
  if (smtp.kindle_email) formData.append("kindle_email", smtp.kindle_email);
  if (smtp.smtp_host) formData.append("smtp_host", smtp.smtp_host);
  if (smtp.smtp_port) formData.append("smtp_port", smtp.smtp_port);
  if (smtp.smtp_user) formData.append("smtp_user", smtp.smtp_user);
  if (smtp.smtp_password) formData.append("smtp_password", smtp.smtp_password);
}
```

- [ ] **Step 2: Add SMTP fields to `handleConvert()`**

After line 344 (`formData.append("url", url);`), add:
```javascript
    await appendSmtpToForm(formData);
```

- [ ] **Step 3: Add SMTP fields to `handlePasteConvert()`**

After line 460 (`if (isUrl) formData.append("url", pastedContent);`), add:
```javascript
    await appendSmtpToForm(formData);
```

- [ ] **Step 4: Add SMTP fields to `handleBatchSend()`**

After line 538 (`formData.append("url", item.url);`), add:
```javascript
      await appendSmtpToForm(formData);
```

- [ ] **Step 5: Add SMTP fields to `handleBatchRetry()`**

After line 598 (`formData.append("url", item.url);`), add:
```javascript
        await appendSmtpToForm(formData);
```

- [ ] **Step 6: Run JS tests**

```bash
node tests/popup.test.js
```
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add extension/popup.js
git commit -m "feat: include SMTP credentials from chrome.storage in /send-epub requests"
```

---

### Task 4: Update tests and verify

**Files:**
- Modify: `tests/popup.test.js`

- [ ] **Step 1: Add SMTP form data assertion to send test**

In `tests/popup.test.js`, find the send-related test section and add an assertion that form data includes SMTP fields. Add near the existing `SEND_EPUB_ENDPOINT` test (around line 588-590):

```javascript
console.log("\n── SMTP inline config ──");
// Verify appendSmtpToForm adds creds to form data
var testForm = new FormData();
mockChromeStorage({ kindle_email: "test@kindle.com", smtp_host: "smtp.test.com", smtp_port: "587", smtp_user: "user", smtp_password: "pass" });
// Re-initialize chrome.runtime so the popup functions work
// (mockChromeStorage already preserves runtime via Object.assign)
await popupAppendSmtpToForm(testForm);
assertEqual(testForm.get("kindle_email"), "test@kindle.com", "kindle_email added to form");
assertEqual(testForm.get("smtp_host"), "smtp.test.com", "smtp_host added to form");
assertEqual(testForm.get("smtp_port"), "587", "smtp_port added to form");
assertEqual(testForm.get("smtp_user"), "user", "smtp_user added to form");
assertEqual(testForm.get("smtp_password"), "pass", "smtp_password added to form");
```

But wait — `appendSmtpToForm` is defined in popup.js, not in the test file. The test file doesn't import from popup.js. I need to either:
a) Duplicate the function in the test (like we do with other functions)
b) Or just test at a higher level that the send flow includes SMTP fields

Actually, looking at how the test file works, it reimplements snapshots of popup.js functions. So I should duplicate `appendSmtpToForm` in the test.

Replace the test step with:

```javascript
console.log("\n── SMTP inline config ──");
async function popupAppendSmtpToForm(formData) {
  var smtp = await chrome.storage.sync.get({
    kindle_email: "", smtp_host: "", smtp_port: "", smtp_user: "", smtp_password: "",
  });
  if (smtp.kindle_email) formData.append("kindle_email", smtp.kindle_email);
  if (smtp.smtp_host) formData.append("smtp_host", smtp.smtp_host);
  if (smtp.smtp_port) formData.append("smtp_port", smtp.smtp_port);
  if (smtp.smtp_user) formData.append("smtp_user", smtp.smtp_user);
  if (smtp.smtp_password) formData.append("smtp_password", smtp.smtp_password);
}
var testForm = new FormData();
mockChromeStorage({ kindle_email: "test@kindle.com", smtp_host: "smtp.test.com", smtp_port: "587", smtp_user: "user", smtp_password: "pass" });
await popupAppendSmtpToForm(testForm);
assertEqual(testForm.get("kindle_email"), "test@kindle.com", "kindle_email added to form");
assertEqual(testForm.get("smtp_host"), "smtp.test.com", "smtp_host added to form");
assertEqual(testForm.get("smtp_port"), "587", "smtp_port added to form");
assertEqual(testForm.get("smtp_user"), "user", "smtp_user added to form");
assertEqual(testForm.get("smtp_password"), "pass", "smtp_password added to form");
```

- [ ] **Step 2: Run all tests**

```bash
node tests/popup.test.js
python -m pytest tests/ -v
```
Expected: all pass.

- [ ] **Step 3: Commit**

```bash
git add tests/popup.test.js
git commit -m "test: add SMTP inline config assertions to popup tests"
```

---

### Task 5: Final verification

- [ ] **Step 1: Run all tests one final time**

```bash
node tests/popup.test.js
python -m pytest tests/ -v
```

- [ ] **Step 2: Verify no stale config.json references remain**

```bash
rg "config\.json|CONFIG_PATH|/config" server.py smtp_relay.py extension/
```
Expected: No remaining references to `/config` or `config.json` in the send flow (config.json may still exist on disk but is no longer read by the server).

- [ ] **Step 3: Final commit if needed**

```bash
git add -A
git commit -m "chore: final cleanup after SMTP chrome.storage migration"
```
