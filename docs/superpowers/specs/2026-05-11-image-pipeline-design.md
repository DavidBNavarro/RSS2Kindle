# Image Pipeline — Canvas-based image processor

## Summary

Port the server-side image pipeline (Pillow-based in `server.py` + `w2k_epub.py`) to a browser-side module `extension/image-processor.js` using OffscreenCanvas, `createImageBitmap`, and the Fetch API.

## Exports

| Function | Params | Returns | Purpose |
|---|---|---|---|
| `fetchImageAsBlob(url, opts?)` | `url: string`, `opts: { referer?, signal? }` | `Promise<Blob>` | Fetch image with Referer header |
| `getImageInfo(blob)` | `blob: Blob` | `Promise<{ width, height, type }>` | Decode dimensions |
| `shouldSkipImage(w, h, opts?)` | `w, h: number`, `opts: { minDim? }` | `boolean` | Skip tiny/extreme-ratio images |
| `shouldRotateImage(w, h, opts?)` | `w, h: number`, `opts: { minWidth?, minDim?, ratio? }` | `boolean` | Heuristic for rotation |
| `processImage(blob, opts?)` | `blob: Blob`, `opts: { maxDimension?, format?, quality? }` | `Promise<Blob>` | Decode + resize + re-encode |
| `rotateImage(blob, degrees?)` | `blob: Blob`, `degrees: number` | `Promise<Blob>` | Canvas rotation → PNG |
| `convertFormat(blob, format, opts?)` | `blob: Blob`, `format: string`, `opts: { quality? }` | `Promise<Blob>` | GIF→PNG, WebP→JPEG, etc. |

## Core pattern

```
blob → createImageBitmap(blob) → ImageBitmap
  → OffscreenCanvas(w, h) → ctx.drawImage(bitmap)
  → canvas.convertToBlob({ type, quality })
```

- `processImage` resizes along longest edge (maintaining aspect ratio) to `maxDimension` (default 1600px), then exports as JPEG (quality 85) by default.
- `rotateImage` rotates via `ctx.rotate(degrees * Math.PI / 180)` with `expand: true` semantics (matching PIL's `expand=True`), exports as PNG.
- `convertFormat` is a thin wrapper around processImage — just changes output format.

## Heuristics (ported thresholds)

| Rule | Condition | Source |
|---|---|---|
| Skip tiny | `min(w, h) < 50` | `server.py:1481` |
| Skip aspect ratio | `max(w, h) > 4 * min(w, h)` | `server.py:1487` |
| Rotate threshold | `w > 400 && minDim >= 120 && w/h > 1.3` | `w2k_epub._should_rotate_image` |
| WebP→JPEG quality | 85 | `server.py:1501` |
| GIF→PNG | RGBA encoding | `server.py:1496` |

## Error handling

- `ImageFetchError` — network failure, bad status, timeout
- `ImageProcessError` — un-decodable blob, oversized (>50MP), OOM
- SVG rejection — caller responsibility (content-type check), not handled here

## Implementation file

`extension/image-processor.js` — single file, no dependencies, ~180 lines.
