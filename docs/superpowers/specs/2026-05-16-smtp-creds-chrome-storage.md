# SMTP Creds in chrome.storage — Design Spec

## Problem

SMTP credentials live in `config.json` on the server. The extension calls `GET /config` and `POST /config` to view/edit them. This ties the extension to `server.py` for config management, blocking the goal of making `server.py` optional.

## Architecture

SMTP config moves from server `config.json` to `chrome.storage.sync` in the extension. On each send, the extension reads creds from storage and includes them as form fields in the `/send-epub` request. The server reads creds from the request instead of from disk. The `/config` endpoint is removed.

```
Before:
  Options page → POST /config → server saves to config.json
  Send EPUB → server reads config.json for SMTP creds

After:
  Options page → chrome.storage.sync (no server call)
  Send EPUB → extension reads chrome.storage → includes creds in /send-epub form
  Server reads SMTP creds from request fields
```

## Changes

### server.py
- Remove `CONFIG_PATH = Path(__file__).parent / "config.json"`
- Remove `GET /config` route
- Remove `POST /config` route
- Change `_send_epub_to_kindle()` to accept a `cfg` dict parameter instead of reading from config.json
- `/send-epub`: parse `kindle_email`, `smtp_host`, `smtp_port`, `smtp_user`, `smtp_password` from form data, validate, pass to `_send_epub_to_kindle()`
- `/send-html`: parse same fields from JSON body, pass to `_send_epub_to_kindle()`

### extension/popup.js
- Add `loadSmtpConfig()` function that reads SMTP creds from chrome.storage
- In `handleConvert()`: add SMTP form fields to `/send-epub` request
- In `handlePasteConvert()`: same
- In `handleBatchSend()`: same  
- In `handleBatchRetry()`: same

### extension/options.js
- Remove `fetch(GET /config)` on page load
- Remove `fetch(POST /config)` on form submit
- Save SMTP fields (kindle_email, smtp_host, smtp_port, smtp_user, smtp_password) to chrome.storage.sync directly
- Show saved password indicator from chrome.storage instead of server response

### extension/options.html
- Unchanged (SMTP fields already exist)
- Fields populated from chrome.storage instead of server

### Tests
- Remove tests for GET/POST /config endpoints in test_smtp_relay.py
- Update popup tests for SMTP creds in send form data

## Error Handling
- If SMTP creds are missing from the request, `/send-epub` returns 400 "SMTP not configured"
- The extension's `handleConvert()` etc show the error to the user
- Users configure creds once via Settings, then they persist in chrome.storage

## Testing
- options.js: SMTP fields save to and load from chrome.storage
- popup.js: send requests include SMTP form fields
- server.py: /send-epub rejects missing SMTP fields with 400
