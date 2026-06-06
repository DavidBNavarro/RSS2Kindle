# iOS2Kindle

Convert any web article to EPUB and send it to your Kindle, right from the iOS Share Sheet.

Powered by an iOS Shortcut + [Scriptable](https://apps.apple.com/app/scriptable/id1405459188).

## What's here

| File | Purpose |
|---|---|
| `ios/wk2kindle.js` | Scriptable script called by the Shortcut |
| `ios/bundle.js` | Bundled engine: Readability + article extractor + EPUB generator (loaded by wk2kindle.js) |
| `ios/extractor.js` | Article extraction source |
| `ios/generator.js` | Text-only EPUB generator source |
| `ios/SHORTCUT_BUILD_STEPS.md` | Step-by-step instructions to build the Shortcut |

## Quick start

1. Install **Scriptable** from the App Store
2. Create a script named `WK2Kindle` in Scriptable, paste `ios/wk2kindle.js`
3. Place `ios/bundle.js` at `iCloud Drive/Scriptable/web2kindle/bundle.js`
4. Follow `ios/SHORTCUT_BUILD_STEPS.md` to create the Share Sheet shortcut
5. Set your Kindle email in the shortcut's **Send Email** action

## License

Apache 2.0
