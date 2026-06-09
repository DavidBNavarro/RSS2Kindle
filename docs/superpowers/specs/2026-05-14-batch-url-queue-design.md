# Batch URL Queue — Design

## Problem

Users want to send multiple articles to Kindle at once. The current popup only handles
one URL at a time (current page detection or single-URL paste mode).

## Scope

Extension-only. No server changes. No "merge into one EPUB" — each URL is processed
individually through existing server endpoints (`/article/send-to-kindle`, `/convert`).

## Approach: Auto-detect batch in paste mode

No new UI toggle. The existing paste textarea (`#paste-input`) already exists. When
multiple URLs are detected (separated by newlines), the UI adapts to show a batch
queue. Single URL or text behaves exactly as today.

## Detection

When `#paste-input` changes:
1. Split value by newlines, trim each line
2. Filter lines matching `/^https?:\/\//i` 
3. Exclude PDF/file URLs (same rules as single paste)
4. If 0 or 1 URL → current single-item behavior unchanged
5. If 2+ URLs → batch mode engaged

## Batch UI (in paste mode)

When batch is detected:

- **Badge**: Shows "BATCH N" instead of "URL" where N is the URL count
- **Queue list**: A compact list appears below the textarea. Each row shows:
  - Status dot: pending (gray), processing (blue spinner), done (green check), failed (red X)
  - Truncated URL (one line, ellipsis overflow) — no title fetches, keep round trips minimal
- **Title field**: Hidden in batch mode (titles are fetched per-URL from server response)
- **Buttons**: 
  - "✉ Send All to Kindle" — processes each URL sequentially via `/article/send-to-kindle`
  - "⬇ Save All EPUBs" — processes each URL sequentially via `/convert`

When batch is NOT detected (0-1 URL), paste mode looks and works exactly as it does today.

## Processing model

1. Parse and validate all URLs from textarea
2. For each URL, call existing server endpoint (sequentially, not parallel)
3. Update queue UI per-item:
   - Set item to "processing", update aggregate progress "Converting 3/5…"
   - On success: set item to "done", update aggregate count
   - On failure: set item to "failed", record error message, continue
4. Show result summary:
   - All succeeded: "✓ 5 sent to kindle@example.com" (or "✓ 5 EPUBs downloaded")
   - Some failed: "✓ 3 sent, 2 failed" with "Retry Failed" button
5. Conversion counter increments per-item (each URL = one conversion)

## Conversion counter

- Each URL = one conversion (counter increments per successful send/download)
- Check limit before each item (not upfront) — if user has 3 remaining and tries 5 URLs,
  first 3 succeed, next 2 fail with "Free limit reached"

## Error handling

- Continue on error — process remaining URLs
- Collect all failures with URL + error message
- Show summary with individual failure details
- "Retry Failed" button re-processes only failed URLs

## File changes

- **`extension/popup.js`**: Add batch detection, queue state management, sequential processing
- **`extension/popup.html`**: Add queue list container, per-item template
- **`extension/popup.css`**: Add queue list styles, per-item status indicators
- **`tests/popup.test.js`**: Add batch detection + processing tests

## Testing

- Batch detection: 0/1/2+ URLs, mixed valid/invalid, PDF exclusion
- Sequential processing: all succeed, some fail, all fail
- UI state: queue display, progress updates, summary rendering
- Conversion counter: each URL increments counter
