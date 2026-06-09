# Wire Extension to smtp_relay.py — Design Spec

## Problem

The extension sends EPUBs to `server.py` port 5001 via multipart FormData (`/send-epub`), making `server.py` a required dependency. A dedicated SMTP relay (`smtp_relay.py` port 5002) already exists and accepts JSON POST with base64 EPUB + inline SMTP creds. The extension should use it directly.

## Architecture

Extension sends EPUBs to `smtp_relay.py` port 5002 via JSON POST (`/send`). EPUB Blob is converted to base64 client-side. SMTP creds read from `chrome.storage` (set up in task 8). Health check uses relay's `/health`. History lives in `chrome.storage` exclusively. Server.py is no longer required.

```
Before:
  Extension → POST /send-epub (multipart, port 5001) → server.py reads form → sends SMTP
  
After:
  Extension → POST /send (JSON base64, port 5002) → smtp_relay.py sends SMTP
  Extension → GET /health (port 5002) → smtp_relay.py
  History → chrome.storage.local (no server dependency)
```

## Changes

### extension/popup.js
- Add `DEFAULT_RELAY = "http://127.0.0.1:5002"` constant
- Add `RELAY_URL` variable, `loadRelayUrl()` function
- Add `blobToBase64()` helper using FileReader
- Modify `handleConvert()`: POST JSON to `RELAY_URL + "/send"` instead of multipart to `SERVER + "/send-epub"`
- Same for `handlePasteConvert()`, `handleBatchSend()`, `handleBatchRetry()`
- Modify `checkServer()`: use `RELAY_URL` for `/health` instead of `SERVER`

### extension/options.js + options.html
- Add "SMTP relay URL" field (default `http://127.0.0.1:5002`)
- Save/load from `chrome.storage.sync`

### extension/history.js
- Remove `RESEND_ENDPOINT`, `formatResendSuccess()`  
- Remove resend button from `renderList()` template
- Remove `resend()` function entirely
- Keep `SERVER` load only for `migrateFromServer()` (one-time import, fails gracefully)

### smtp_relay.py
- No changes needed

### server.py
- No changes needed — fully optional, runs only for legacy users

### Tests
- Update popup tests for base64 blob conversion
- Remove resend-related history tests
- Update send endpoint assertions

## Error Handling
- Base64 conversion failure: reject with error shown to user
- Relay `/health` failure: same "Server offline" UX as before
- Relay `/send` failure: same error display as before
