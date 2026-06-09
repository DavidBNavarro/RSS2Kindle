# SMTP Relay Server — Design Spec

## Problem

The existing `server.py` bundles article fetching, EPUB generation, preview, and SMTP delivery into one process. The roadmap calls for a browser-native article pipeline (Readability + JSZip) that generates EPUBs inside the extension, removing the need for server-side article processing. But the extension still needs a way to send EPUBs to Kindle via SMTP — it can't do SMTP from the browser.

A separate minimal SMTP relay decouples delivery from article processing, so the server side shrinks to a single responsibility: accept an EPUB + SMTP config, send it.

## Design

**File:** `smtp_relay.py` — standalone Flask server.

**Port:** 5002 (alongside `server.py` on 5001). Configurable via `PORT` env var.

**Dependencies:** `flask`, `flask-cors`. No `trafilatura`, `ebooklib`, `Pillow`, `bs4`, or `requests`.

### API

#### `GET /health`

Returns `{"status":"ok","service":"smtp-relay","version":"1.0.0"}`.

#### `POST /send`

Accepts JSON body with:

```json
{
  "epub": "<base64-encoded EPUB bytes>",
  "kindle_email": "user@free.kindle.com",
  "smtp_host": "smtp.gmail.com",
  "smtp_port": 587,
  "smtp_user": "user@gmail.com",
  "smtp_password": "app-password"
}
```

- `epub` — required, base64-encoded string of the EPUB binary.
- `kindle_email` — required, destination Kindle email.
- `smtp_host` — required, SMTP server hostname.
- `smtp_port` — required, SMTP server port.
- `smtp_user` — required, SMTP login username.
- `smtp_password` — required, SMTP login password.

Returns `200` on success:

```json
{
  "success": true,
  "kindle_email": "user@free.kindle.com",
  "estimated_size_bytes": 123456,
  "notice": null
}
```

Returns `4xx`/`5xx` on failure:

```json
{
  "error": "EPUB too large (30.0 MB). Kindle limit is 50 MB."
}
```

### SMTP logic

Directly adapted from `server.py`'s `_send_epub_to_kindle` / `_build_epub_email_message`:

1. Decode base64 EPUB into bytes.
2. Enforce 50 MB Kindle limit on raw EPUB size.
3. Build MIME multipart message with EPUB as base64-encoded attachment (`application/octet-stream`).
4. Set `Subject: convert`, `From: <smtp_user>`, `To: <kindle_email>`.
5. Connect via `smtplib.SMTP`, upgrade with STARTTLS, login, send.
6. No delivery optimization (recompression/downscaling — separate roadmap item).
7. Basic Gmail-esque sanity check: if estimated message size exceeds 25 MB, return a warning but still attempt delivery.

### What it does NOT do

- No article pipeline (fetching, extraction, cleaning)
- No EPUB generation
- No preview generation
- No `config.json` — config is per-request
- No `history.db` — no persistence
- No image optimization / delivery optimization
- No conversion limits or licensing

### Tests

**File:** `tests/test_smtp_relay.py`

- Mock `smtplib.SMTP` to avoid real network calls.
- Test successful send path.
- Test missing required fields.
- Test EPUB too large (>50 MB).
- Test bad SMTP credentials / connection failure.
- Test Gmail size warning (>25 MB).

### CORS

Same as `server.py` — `flask-cors` with `CORS(app)` to allow extension origin.

## Future

- **Delivery optimization** — recompress JPEGs to q75, downscale >1600px (separate roadmap item, depends on image pipeline).
- **Multi-send** — accept array of `kindle_email` addresses (or BCC).
- **Deployment** — Dockerfile, pip package, serverless adapter.
