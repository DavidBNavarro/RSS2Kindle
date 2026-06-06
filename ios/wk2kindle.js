// WK2Kindle — called from Shortcut "Send to Kindle"
// Reads bundle.js from iCloud Drive/Scriptable/web2kindle/
// Returns { title, epubBase64 } to the Shortcut

const url = args.plainTexts[0];
if (!url) throw new Error("No URL provided");

const fm = FileManager.iCloud();
const bundlePath = fm.joinPath(fm.documentsDirectory(), "web2kindle/bundle.js");

if (!fm.fileExists(bundlePath)) {
  throw new Error("bundle.js not found at " + bundlePath);
}

const code = fm.readString(bundlePath);
eval(code);

const result = await iOSBundle.processArticle(url);
return result;
