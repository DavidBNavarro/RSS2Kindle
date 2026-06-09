# SMTP Relay Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A standalone Flask server (`smtp_relay.py`) that accepts an EPUB blob + SMTP config via JSON POST and sends it to Kindle via SMTP.

**Architecture:** Minimal Flask app with two routes (`/health`, `/send`). No article pipeline, no config.json, no history.db. SMTP config is per-request JSON body. Uses stdlib `smtplib` + `email.mime`. No `requests`, no `trafilatura`, no `ebooklib`, no `Pillow`, no `bs4`.

**Tech Stack:** Flask, flask-cors, stdlib smtplib/email/base64.

---

### Task 1: Create test infrastructure and health endpoint test

**Files:**
- Create: `tests/test_smtp_relay.py`

- [ ] **Write the test file with health endpoint test + FakeSMTP helper**

```python
"""Tests for the SMTP relay server."""

import base64
import os
import smtplib
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


class FakeSMTP:
    """Mock smtplib.SMTP that records calls instead of sending."""
    def __init__(self, host, port):
        self.host = host
        self.port = port
        self.sent_messages = []
        self.ehlo_count = 0
        self.starttls_count = 0
        self.login_user = None
        self.login_password = None

    def __enter__(self):
        return self

    def __exit__(self, *args):
        pass

    def ehlo(self):
        self.ehlo_count += 1

    def starttls(self):
        self.starttls_count += 1

    def login(self, user, password):
        self.login_user = user
        self.login_password = password

    def send_message(self, msg):
        self.sent_messages.append(msg)


def test_health():
    import smtp_relay

    client = smtp_relay.app.test_client()
    resp = client.get("/health")

    assert resp.status_code == 200
    payload = resp.get_json()
    assert payload["status"] == "ok"
    assert payload["service"] == "smtp-relay"
    assert payload["version"] == smtp_relay.APP_VERSION
```

- [ ] **Run test to verify it fails**

Run: `python -m pytest tests/test_smtp_relay.py::test_health -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'smtp_relay'`

### Task 2: Implement smtp_relay.py skeleton with health endpoint

**Files:**
- Create: `smtp_relay.py`

- [ ] **Write minimal smtp_relay.py**

```python
#!/usr/bin/env python3
"""SMTP Relay — minimal Flask server that sends EPUBs to Kindle via SMTP."""

import base64
import os
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.base import MIMEBase
from email import encoders

from flask import Flask, request, jsonify
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

APP_VERSION = "1.0.0"
KINDLE_MAX_EPUB_BYTES = 50 * 1024 * 1024
GMAIL_MESSAGE_LIMIT_BYTES = 25 * 1024 * 1024
GMAIL_SAFETY_MARGIN_BYTES = 256 * 1024

REQUIRED_FIELDS = [
    "epub", "kindle_email", "smtp_host", "smtp_port",
    "smtp_user", "smtp_password",
]


@app.route("/health")
def health():
    return jsonify({
        "status": "ok",
        "service": "smtp-relay",
        "version": APP_VERSION,
    })
```

- [ ] **Run test to verify it passes**

Run: `python -m pytest tests/test_smtp_relay.py::test_health -v`
Expected: PASS

- [ ] **Commit**

```bash
git add smtp_relay.py tests/test_smtp_relay.py
git commit -m "feat: add SMTP relay skeleton with health endpoint"
```

### Task 3: Write tests for /send validation

**Files:**
- Modify: `tests/test_smtp_relay.py`

- [ ] **Add validation tests to test file**

Append to `tests/test_smtp_relay.py`:

```python
def test_send_missing_body():
    import smtp_relay

    client = smtp_relay.app.test_client()
    resp = client.post("/send", data="not json", content_type="text/plain")
    assert resp.status_code == 400
    assert "JSON" in resp.get_json()["error"]


def test_send_missing_fields():
    import smtp_relay

    client = smtp_relay.app.test_client()
    resp = client.post("/send", json={})
    assert resp.status_code == 400
    error = resp.get_json()["error"]
    for field in smtp_relay.REQUIRED_FIELDS:
        assert field in error


def test_send_invalid_base64():
    import smtp_relay

    client = smtp_relay.app.test_client()
    resp = client.post("/send", json={
        "epub": "not-valid-base64!!!",
        "kindle_email": "test@free.kindle.com",
        "smtp_host": "smtp.gmail.com",
        "smtp_port": 587,
        "smtp_user": "user@gmail.com",
        "smtp_password": "password",
    })
    assert resp.status_code == 400
    assert "base64" in resp.get_json()["error"].lower()


def test_send_epub_too_large():
    import smtp_relay

    client = smtp_relay.app.test_client()
    # Create base64 of bytes > 50MB — use a small string that decodes to large size
    big_bytes = b"X" * (smtp_relay.KINDLE_MAX_EPUB_BYTES + 1)
    resp = client.post("/send", json={
        "epub": base64.b64encode(big_bytes).decode(),
        "kindle_email": "test@free.kindle.com",
        "smtp_host": "smtp.gmail.com",
        "smtp_port": 587,
        "smtp_user": "user@gmail.com",
        "smtp_password": "password",
    })
    assert resp.status_code == 413
    assert "too large" in resp.get_json()["error"].lower()
```

- [ ] **Run validation tests to verify they fail**

Run: `python -m pytest tests/test_smtp_relay.py -v`
Expected: All 4 validation tests FAIL (POST /send returns 404)

### Task 4: Implement /send validation

**Files:**
- Modify: `smtp_relay.py`

- [ ] **Add /send route with validation**

Append before `if __name__` block:

```python
@app.route("/send", methods=["POST"])
def send():
    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "Request body must be JSON"}), 400

    missing = [f for f in REQUIRED_FIELDS if not data.get(f)]
    if missing:
        return jsonify({"error": f"Missing required fields: {', '.join(missing)}"}), 400

    try:
        epub_bytes = base64.b64decode(data["epub"])
    except Exception:
        return jsonify({"error": "epub must be valid base64"}), 400

    if len(epub_bytes) > KINDLE_MAX_EPUB_BYTES:
        return jsonify({
            "error": f"EPUB too large ({len(epub_bytes) / (1024 * 1024):.1f} MB). Kindle limit is 50 MB."
        }), 413
```

- [ ] **Run validation tests to verify they pass**

Run: `python -m pytest tests/test_smtp_relay.py -v`
Expected: test_health PASS + all 4 validation tests PASS

- [ ] **Commit**

```bash
git add smtp_relay.py tests/test_smtp_relay.py
git commit -m "feat: add /send endpoint with JSON validation and size check"
```

### Task 5: Write tests for /send success and error paths

**Files:**
- Modify: `tests/test_smtp_relay.py`

- [ ] **Add success and error tests**

Append to `tests/test_smtp_relay.py`:

```python
def test_send_success(monkeypatch):
    import smtp_relay

    fake_smtp = FakeSMTP("smtp.gmail.com", 587)
    monkeypatch.setattr(smtplib, "SMTP", lambda host, port: fake_smtp)

    client = smtp_relay.app.test_client()
    small_epub = b"<fake epub content>"
    resp = client.post("/send", json={
        "epub": base64.b64encode(small_epub).decode(),
        "kindle_email": "test@free.kindle.com",
        "smtp_host": "smtp.gmail.com",
        "smtp_port": 587,
        "smtp_user": "user@gmail.com",
        "smtp_password": "app-password",
    })

    assert resp.status_code == 200
    payload = resp.get_json()
    assert payload["success"] is True
    assert payload["kindle_email"] == "test@free.kindle.com"
    assert payload["estimated_size_bytes"] > 0
    assert payload["notice"] is None

    assert len(fake_smtp.sent_messages) == 1
    msg = fake_smtp.sent_messages[0]
    assert msg["To"] == "test@free.kindle.com"
    assert msg["From"] == "user@gmail.com"
    assert msg["Subject"] == "convert"
    assert fake_smtp.login_user == "user@gmail.com"
    assert fake_smtp.login_password == "app-password"
    assert fake_smtp.ehlo_count == 2
    assert fake_smtp.starttls_count == 1


def test_send_auth_failure(monkeypatch):
    import smtp_relay

    def failing_login(host, port):
        raise smtplib.SMTPAuthenticationError(535, b"Authentication failed")

    monkeypatch.setattr(smtplib, "SMTP", failing_login)

    client = smtp_relay.app.test_client()
    resp = client.post("/send", json={
        "epub": base64.b64encode(b"data").decode(),
        "kindle_email": "test@free.kindle.com",
        "smtp_host": "smtp.gmail.com",
        "smtp_port": 587,
        "smtp_user": "user@gmail.com",
        "smtp_password": "wrong",
    })
    assert resp.status_code == 401
    assert "authentication" in resp.get_json()["error"].lower()


def test_send_smtp_error(monkeypatch):
    import smtp_relay

    def failing_send(host, port):
        raise smtplib.SMTPException("Connection refused")

    monkeypatch.setattr(smtplib, "SMTP", failing_send)

    client = smtp_relay.app.test_client()
    resp = client.post("/send", json={
        "epub": base64.b64encode(b"data").decode(),
        "kindle_email": "test@free.kindle.com",
        "smtp_host": "smtp.gmail.com",
        "smtp_port": 587,
        "smtp_user": "user@gmail.com",
        "smtp_password": "password",
    })
    assert resp.status_code == 502
    assert "SMTP error" in resp.get_json()["error"]
```

- [ ] **Run new tests to verify they fail**

Run: `python -m pytest tests/test_smtp_relay.py -v`
Expected: test_send_success, test_send_auth_failure, test_send_smtp_error FAIL

### Task 6: Implement SMTP send logic with error handling

**Files:**
- Modify: `smtp_relay.py`

- [ ] **Add SMTP send logic after validation**

Replace the `# Currently empty after validation` section with the full send logic:

Find the comment after the size check and replace with:

```python
    msg = MIMEMultipart()
    msg["From"] = data["smtp_user"]
    msg["To"] = data["kindle_email"]
    msg["Subject"] = "convert"

    part = MIMEBase("application", "octet-stream")
    part.set_payload(epub_bytes)
    encoders.encode_base64(part)
    safe_name = "document.epub"
    part.add_header("Content-Disposition", f'attachment; filename="{safe_name}"')
    msg.attach(part)

    estimated_size = len(msg.as_bytes())

    notice = None
    gmail_budget = GMAIL_MESSAGE_LIMIT_BYTES - GMAIL_SAFETY_MARGIN_BYTES
    if "gmail" in data["smtp_host"].lower() and estimated_size > gmail_budget:
        notice = (
            f"Estimated message size ({estimated_size / (1024 * 1024):.1f} MB) "
            "exceeds Gmail's ~25 MB limit. Delivery may fail."
        )

    try:
        with smtplib.SMTP(data["smtp_host"], int(data["smtp_port"])) as server:
            server.ehlo()
            server.starttls()
            server.ehlo()
            server.login(data["smtp_user"], data["smtp_password"])
            server.send_message(msg)
    except smtplib.SMTPAuthenticationError:
        return jsonify({"error": "SMTP authentication failed. Check your username and password."}), 401
    except smtplib.SMTPException as e:
        return jsonify({"error": f"SMTP error: {e}"}), 502
    except Exception as e:
        return jsonify({"error": str(e)}), 500

    result = {
        "success": True,
        "kindle_email": data["kindle_email"],
        "estimated_size_bytes": estimated_size,
        "notice": notice,
    }
    return jsonify(result), 200
```

- [ ] **Add entrypoint at bottom of file**

```python
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5002))
    app.run(host="0.0.0.0", port=port, debug=os.environ.get("P2K_DEBUG", ""))
```

- [ ] **Run all tests to verify they pass**

Run: `python -m pytest tests/test_smtp_relay.py -v`
Expected: All 8 tests PASS

- [ ] **Commit**

```bash
git add smtp_relay.py tests/test_smtp_relay.py
git commit -m "feat: implement SMTP send logic with error handling"
```

### Task 7: Update ROADMAP.md

**Files:**
- Modify: `ROADMAP.md`

- [ ] **Move SMTP relay from "Ready now" to "Done"**

```markdown
| **SMTP relay server** — standalone `smtp_relay.py` (port 5002). Accepts EPUB + SMTP config via JSON POST → smtplib. | SMTP relay | Small | 2026-05-14 |
```

Add a new row under the Done table with the current date.

- [ ] **Also update "What to tackle next" priority list** to remove SMTP relay from recommendation #4, or move it to done.

- [ ] **Commit**

```bash
git add ROADMAP.md
git commit -m "docs: mark SMTP relay complete in roadmap"
```

---

### Self-review checklist

- Plan covers all spec requirements: health, /send, validation, SMTP send, error handling, size limits
- All test code is complete (no "write tests" without actual code)
- All implementation code is complete (no "implement later" placeholders)
- File paths and method names are consistent across tasks
- Test structure follows project conventions (sys.path.insert, monkeypatch, Flask test_client)
