# Web2Kindle Monetization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a 10-conversion free tier cap and Pro license key system to the extension.

**Architecture:** Three new modules — `conversion-counter.js` (local storage counter), `license.js` (key verification + storage), and a Vercel verification endpoint. Existing `popup.js` gets wired with cap checks before send/download actions. Settings page gets a license key input section. Popup gets upgrade nudge, block card, and PRO badge.

**Tech Stack:** Chrome Extension APIs (chrome.storage.local/sync), Vercel serverless functions, Lemon Squeezy for payment processing.

---

### Task 1: Conversion Counter Module

**Files:**
- Create: `extension/conversion-counter.js`
- Test: `tests/popup.test.js` (add new test section)

- [ ] **Step 1: Create `extension/conversion-counter.js`**

```js
const CONVERSION_KEY = 'web2kindle_conversion_count';
const FREE_LIMIT = 10;

async function getConversionCount() {
  const result = await chrome.storage.local.get(CONVERSION_KEY);
  return result[CONVERSION_KEY] || 0;
}

async function incrementConversion() {
  const count = await getConversionCount();
  const newCount = count + 1;
  await chrome.storage.local.set({ [CONVERSION_KEY]: newCount });
  return newCount;
}

async function getConversionsRemaining() {
  const [count, hasLicense] = await Promise.all([
    getConversionCount(),
    typeof hasProLicense !== 'undefined' ? hasProLicense() : Promise.resolve(false),
  ]);
  if (hasLicense) return Infinity;
  return Math.max(0, FREE_LIMIT - count);
}
```

- [ ] **Step 2: Add conversion counter tests to `tests/popup.test.js`**

Append before the `runTests()` function call:

```js
// ── Conversion counter ──
async function testConversionCounter() {
  console.log("\n── Conversion counter ──");
  let storageData = {};

  globalThis.chrome = {
    storage: {
      local: {
        get(keys, cb) {
          const keysArr = Array.isArray(keys) ? keys : [keys];
          const result = {};
          for (const k of keysArr) result[k] = storageData[k];
          if (cb) return cb(result);
          return Promise.resolve(result);
        },
        set(items, cb) {
          Object.assign(storageData, items);
          if (cb) cb();
          return Promise.resolve();
        },
      },
    },
  };

  // We need to eval the module in context
  const fs2 = require("node:fs");
  const counterCode = fs2.readFileSync(
    path.join(__dirname, "..", "extension", "conversion-counter.js"), "utf8"
  );
  // Remove the export line if present, eval the rest
  const evalCode = counterCode.replace(/^export\s+\{.*\};\s*$/m, '');
  eval(evalCode);

  assertEqual(await getConversionCount(), 0, "starts at 0");
  assertEqual(await incrementConversion(), 1, "increments to 1");
  assertEqual(await getConversionCount(), 1, "persists at 1");
  assertEqual(await incrementConversion(), 2, "increments to 2");
  assertEqual(await getConversionCount(), 2, "persists at 2");
  storageData = {};
  assertEqual(await getConversionCount(), 0, "resets when storage cleared");
}
```

- [ ] **Step 3: Wire `testConversionCounter` into the test runner**

In `tests/popup.test.js`, add `await testConversionCounter();` before the results line:

```js
// Find this line:
console.log(`\n── Results: ${passed} passed, ${failed} failed ──\n`);

// And add before it:
await testConversionCounter();
```

- [ ] **Step 4: Run tests to verify both pass and fail correctly**

Run: `node tests/popup.test.js`
Expected: all existing tests pass, conversion counter tests pass

- [ ] **Step 5: Commit**

```bash
git add extension/conversion-counter.js tests/popup.test.js
git commit -m "feat: add conversion counter module with 10-conversion cap"
```

---

### Task 2: License Key Module

**Files:**
- Create: `extension/license.js`
- Test: `tests/popup.test.js`

- [ ] **Step 1: Create `extension/license.js`**

```js
const LICENSE_KEY_STORAGE = 'web2kindle_license_key';
const LICENSE_VERIFIED_STORAGE = 'web2kindle_license_verified';
const VERIFY_ENDPOINT = 'https://web2kindle-verify.vercel.app/api/verify';

async function hasProLicense() {
  const result = await chrome.storage.sync.get(LICENSE_VERIFIED_STORAGE);
  return result[LICENSE_VERIFIED_STORAGE] === true;
}

async function getStoredLicenseKey() {
  const result = await chrome.storage.sync.get(LICENSE_KEY_STORAGE);
  return result[LICENSE_KEY_STORAGE] || '';
}

async function verifyLicenseKey(key) {
  if (!key || typeof key !== 'string') return false;
  if (!/^WK-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(key.trim())) return false;
  try {
    const resp = await fetch(VERIFY_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ license_key: key.trim() }),
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) throw new Error('Server error');
    const data = await resp.json();
    if (data.valid) {
      await chrome.storage.sync.set({
        [LICENSE_KEY_STORAGE]: key.trim(),
        [LICENSE_VERIFIED_STORAGE]: true,
      });
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

async function clearLicense() {
  await chrome.storage.sync.set({
    [LICENSE_KEY_STORAGE]: '',
    [LICENSE_VERIFIED_STORAGE]: false,
  });
}
```

- [ ] **Step 2: Add license key tests**

Add a new `testLicenseSystem()` function in `tests/popup.test.js`:

```js
async function testLicenseSystem() {
  console.log("\n── License system ──");
  let syncData = {};
  let fetchCalls = [];

  globalThis.chrome = {
    storage: {
      sync: {
        get(keys, cb) {
          const keysArr = Array.isArray(keys) ? keys : [keys];
          const result = {};
          for (const k of keysArr) result[k] = syncData[k];
          if (cb) return cb(result);
          return Promise.resolve(result);
        },
        set(items, cb) {
          Object.assign(syncData, items);
          if (cb) cb();
          return Promise.resolve();
        },
      },
    },
  };

  globalThis.fetch = async (url, opts) => {
    fetchCalls.push({ url, opts });
    const body = JSON.parse(opts.body);
    if (body.license_key === 'WK-AAAA-BBBB-CCCC') {
      return { ok: true, json: async () => ({ valid: true }) };
    }
    return { ok: true, json: async () => ({ valid: false }) };
  };

  if (!AbortSignal.timeout) {
    AbortSignal.timeout = (ms) => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), ms);
      return controller.signal;
    };
  }

  const fs3 = require("node:fs");
  const licenseCode = fs3.readFileSync(
    path.join(__dirname, "..", "extension", "license.js"), "utf8"
  );
  const evalCode = licenseCode.replace(/^export\s+\{.*\};\s*$/m, '');
  eval(evalCode);

  assertEqual(await hasProLicense(), false, "no license by default");
  assertEqual(await getStoredLicenseKey(), '', "no key stored by default");

  const result1 = await verifyLicenseKey('invalid');
  assertEqual(result1, false, "invalid key returns false");
  assertEqual(await hasProLicense(), false, "still unverified after invalid key");

  const result2 = await verifyLicenseKey('WK-AAAA-BBBB-CCCC');
  assertEqual(result2, true, "valid key returns true");
  assertEqual(await hasProLicense(), true, "verified after valid key");
  assertEqual(await getStoredLicenseKey(), 'WK-AAAA-BBBB-CCCC', "key stored after verification");
  assertEqual(fetchCalls.length, 2, "two verification API calls made");

  await clearLicense();
  assertEqual(await hasProLicense(), false, "cleared license is unverified");
  assertEqual(await getStoredLicenseKey(), '', "cleared key is empty");
}
```

- [ ] **Step 3: Wire `testLicenseSystem` into test runner**

Add `await testLicenseSystem();` before the results line (after `testConversionCounter()`).

- [ ] **Step 4: Run tests**

Run: `node tests/popup.test.js`
Expected: all tests pass including conversion counter and license system tests

- [ ] **Step 5: Commit**

```bash
git add extension/license.js tests/popup.test.js
git commit -m "feat: add license key verification module"
```

---

### Task 3: License Verification Endpoint (Vercel)

**Files:**
- Create: `api/verify.js`

- [ ] **Step 1: Create `api/verify.js`**

```js
// Vercel serverless function for license key verification
// Deploy to Vercel at web2kindle-verify.vercel.app
// Set LICENSE_HMAC_SECRET env var in Vercel dashboard

import crypto from 'crypto';

const SECRET = process.env.LICENSE_HMAC_SECRET || 'dev-secret-change-in-production';

// Key format: WK-XXXX-XXXX-XXXX
// The last 4 chars are a HMAC-SHA256 signature (first 4 hex chars)
function generateKey() {
  const parts = [];
  for (let i = 0; i < 2; i++) {
    parts.push(crypto.randomBytes(2).toString('hex').toUpperCase());
  }
  const payload = parts.join('-');
  const sig = crypto.createHmac('sha256', SECRET)
    .update(payload)
    .digest('hex')
    .substring(0, 4)
    .toUpperCase();
  return `WK-${payload}-${sig}`;
}

function verifyKey(key) {
  const match = key.match(/^WK-([A-Z0-9]{4})-([A-Z0-9]{4})-([A-Z0-9]{4})$/);
  if (!match) return false;
  const payload = `${match[1]}-${match[2]}`;
  const sig = match[3];
  const expected = crypto.createHmac('sha256', SECRET)
    .update(payload)
    .digest('hex')
    .substring(0, 4)
    .toUpperCase();
  return sig === expected;
}

export default function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const { license_key } = req.body || {};
  if (!license_key || typeof license_key !== 'string') {
    return res.status(400).json({ valid: false, error: 'Missing license_key' });
  }
  const valid = verifyKey(license_key.trim());
  return res.status(200).json({ valid });
}

// Expose for local testing
export { generateKey, verifyKey };
```

- [ ] **Step 2: Generate at least one key for your use**

Run this locally to produce a key you can test with:

```js
// Run with: node -e "const m = require('./api/verify.js'); console.log(m.generateKey());"
```

Or just run a quick Node command:

```bash
node -e "
const crypto = require('crypto');
const secret = 'dev-secret-change-in-production';
const p1 = crypto.randomBytes(2).toString('hex').toUpperCase();
const p2 = crypto.randomBytes(2).toString('hex').toUpperCase();
const payload = p1 + '-' + p2;
const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex').substring(0, 4).toUpperCase();
console.log('WK-' + payload + '-' + sig);
"
```

Expected output: a key like `WK-1A2B-3C4D-5E6F`

- [ ] **Step 3: Commit**

```bash
git add api/verify.js
git commit -m "feat: add license key verification endpoint (Vercel)"
```

---

### Task 4: License Key UI in Settings

**Files:**
- Modify: `extension/options.html`
- Modify: `extension/options.js`

- [ ] **Step 1: Add license section to Settings HTML**

Add this before the closing `</form>` in `extension/options.html`:

```html
      <div class="section">
        <h2>License</h2>
        <p class="help">Unlock unlimited conversions with a Web2Kindle Pro license.</p>
        <label for="license-key">License key</label>
        <input type="text" id="license-key" placeholder="WK-XXXX-XXXX-XXXX" spellcheck="false">
        <button type="button" id="btn-verify-license" class="btn btn-primary" style="margin-top:8px">Verify License</button>
        <button type="button" id="btn-buy-license" class="btn btn-ghost" style="margin-top:4px">Buy Pro License</button>
        <p id="license-status" class="hidden" style="margin-top:8px;font-size:12.5px"></p>
      </div>
```

- [ ] **Step 2: Add license logic to Settings JS**

Add at the end of `DOMContentLoaded` listener in `extension/options.js` (before the closing `});`):

```js
  // License
  const licenseKeyInput = document.getElementById("license-key");
  const licenseStatus = document.getElementById("license-status");

  try {
    const storedKey = await getStoredLicenseKey();
    if (storedKey) licenseKeyInput.value = storedKey;
    if (await hasProLicense()) {
      licenseStatus.textContent = "✓ Pro license active — unlimited conversions";
      licenseStatus.className = "success";
    }
  } catch {}

  document.getElementById("btn-verify-license").addEventListener("click", async () => {
    const key = licenseKeyInput.value.trim();
    if (!key) {
      licenseStatus.textContent = "Enter a license key first.";
      licenseStatus.className = "error";
      return;
    }
    licenseStatus.textContent = "Verifying…";
    licenseStatus.className = "";
    const valid = await verifyLicenseKey(key);
    if (valid) {
      licenseStatus.textContent = "✓ License verified! Unlimited conversions unlocked.";
      licenseStatus.className = "success";
    } else {
      licenseStatus.textContent = "✗ Invalid license key. Check the key and try again.";
      licenseStatus.className = "error";
    }
  });

  document.getElementById("btn-buy-license").addEventListener("click", () => {
    chrome.tabs.create({ url: "https://web2kindle.com/upgrade" });
  });
```

- [ ] **Step 3: Load license.js in options.html**

Add this script tag after the existing `options.js` script in `extension/options.html`:

```html
  <script src="license.js"></script>
  <script src="options.js"></script>
```

(Order matters — license.js must load first)

- [ ] **Step 4: Run tests to verify nothing broke**

Run: `node tests/popup.test.js`
Expected: all tests pass

- [ ] **Step 5: Commit**

```bash
git add extension/options.html extension/options.js
git commit -m "feat: add license key input to Settings page"
```

---

### Task 5: Upgrade UI in Popup

**Files:**
- Modify: `extension/popup.html`
- Modify: `extension/popup.css`

- [ ] **Step 1: Add PRO badge and upgrade elements to popup HTML**

In `extension/popup.html`:

Add PRO badge next to the title in the header (change the `<h1>` line):

```html
      <h1>Web2Kindle <span id="pro-badge" class="pro-badge hidden">PRO</span></h1>
```

Add the nudge text (after the `mode-note` element):

```html
    <p id="conversion-nudge" class="nudge hidden" style="margin-top:0;margin-bottom:6px"></p>
```

Add the upgrade card (after the `options` div and before `progress`):

```html
    <div id="upgrade-card" class="upgrade-card hidden">
      <div class="upgrade-card-content">
        <h3>Unlimited Conversions</h3>
        <p>You've reached the free limit of 10 conversions. Get a Pro license for unlimited use.</p>
        <button id="btn-upgrade" class="btn btn-primary">Get Pro License</button>
        <button id="btn-enter-key" class="btn btn-ghost">Enter License Key</button>
      </div>
    </div>
```

- [ ] **Step 2: Add CSS for PRO badge and upgrade card**

Append to `extension/popup.css`:

```css
/* ── PRO badge ── */
.pro-badge {
  font-size: 9px;
  font-weight: 700;
  background: #f59e0b;
  color: #fff;
  padding: 1px 5px;
  border-radius: 3px;
  vertical-align: middle;
  margin-left: 4px;
  letter-spacing: 0.3px;
}

/* ── Upgrade card ── */
.upgrade-card {
  background: #fffbeb;
  border: 1px solid #fde68a;
  border-radius: 8px;
  padding: 14px;
  margin-bottom: 10px;
  text-align: center;
}

.upgrade-card h3 {
  font-size: 14px;
  font-weight: 700;
  margin: 0 0 6px;
  color: #92400e;
}

.upgrade-card p {
  font-size: 12px;
  color: #92400e;
  margin: 0 0 10px;
  line-height: 1.45;
}

.upgrade-card .btn-primary {
  margin-bottom: 4px;
}

/* ── Nudge text ── */
.nudge {
  font-size: 11.5px;
  color: #d97706;
  text-align: center;
  line-height: 1.4;
}
```

- [ ] **Step 3: Run tests to verify nothing broke**

Run: `node tests/popup.test.js`
Expected: all tests pass

- [ ] **Step 4: Commit**

```bash
git add extension/popup.html extension/popup.css
git commit -m "feat: add PRO badge, nudge, and upgrade card to popup"
```

---

### Task 6: Wire Counter + License into Conversion Flow

**Files:**
- Modify: `extension/popup.js`

- [ ] **Step 1: Add conversion check as guard at the start of each conversion action**

Add a shared guard function at the top of the functions section in `popup.js` (after the `showPdfNotice` function or wherever feels natural):

```js
async function checkConversionLimit() {
  const count = await getConversionCount();
  const hasLicense = await hasProLicense();
  if (hasLicense) return true;
  if (count >= 10) {
    hide("actions");
    hide("options");
    hide("progress");
    show("upgrade-card");
    return false;
  }
  if (count >= 8) {
    const remaining = 10 - count;
    $("conversion-nudge").textContent = `Nearing the free limit (${remaining} conversion${remaining > 1 ? 's' : ''} remaining). Upgrade for unlimited use.`;
    show("conversion-nudge");
  }
  return true;
}
```

Add increment calls at the success points. In `handleConvert`, after the success line:

```js
    await incrementConversion();
```

In `handleDownload`, after `triggerDownload(resp)`:

```js
    await incrementConversion();
```

In `handlePasteConvert`, after the success block for `ARTICLE_SEND_ENDPOINT` (around line 270):

```js
    await incrementConversion();
```

In `handlePasteDownload`, after `triggerDownload(resp, ...)` (around line 569):

```js
    await incrementConversion();
```

- [ ] **Step 2: Add the guard check at the top of each conversion action**

At the start of `handleConvert`:

```js
  if (!(await checkConversionLimit())) return;
```

At the start of `handleDownload`:

```js
  if (!(await checkConversionLimit())) return;
```

At the start of `handlePasteConvert` (inside the section after the paste-text conversion, just before the `try` or at the very top):

At the start of `handlePasteDownload`:

```js
  if (!(await checkConversionLimit())) return;
```

- [ ] **Step 3: Wire PRO badge display**

At the end of `initPopup()`, after `show("actions")` and `show("options")`:

```js
  if (await hasProLicense()) {
    show("pro-badge");
  }
```

- [ ] **Step 4: Wire upgrade card buttons**

After the button click handlers at the end of `initPopup()`:

```js
  $("btn-upgrade").onclick = () => chrome.tabs.create({ url: "https://web2kindle.com/upgrade" });
  $("btn-enter-key").onclick = () => chrome.runtime.openOptionsPage();
```

- [ ] **Step 5: Load the new script files in popup.html**

Ensure these `<script>` tags exist in `extension/popup.html` in this order (before popup.js):

```html
  <script src="conversion-counter.js"></script>
  <script src="license.js"></script>
  <script src="history-store.js"></script>
  <script src="popup.js"></script>
```

- [ ] **Step 6: Run tests**

Run: `node tests/popup.test.js`
Expected: all tests pass

- [ ] **Step 7: Commit**

```bash
git add extension/popup.js extension/popup.html
git commit -m "feat: wire conversion limit checks and PRO badge into popup flow"
```

---

### Task 7: Chrome Web Store Listing Compliance

**Files:**
- Modify: `extension/manifest.json` (if needed)

- [ ] **Step 1: Verify manifest description is accurate**

Read `extension/manifest.json` to confirm the name and description don't promise unlimited free conversions. Current description is "Send web articles to Kindle-friendly EPUBs" — this is accurate since it can send up to 10 for free and unlimited with Pro.

- [ ] **Step 2: Commit**

No code changes needed for this task. Just a mental note for when you submit to CWS: the listing description must include:

> "Free tier: 10 EPUB conversions (send to Kindle or download). Unlimited conversions with a one-time Pro license."

### Task 8: Verification Script and Deployment Docs

**Files:**
- Create: `scripts/generate-license-key.mjs`
- Create: `api/README.md`

- [ ] **Step 1: Create license key generator script**

```js
// scripts/generate-license-key.mjs
// Usage: node scripts/generate-license-key.mjs

import crypto from 'crypto';

const secret = process.env.LICENSE_HMAC_SECRET || 'dev-secret-change-in-production';

const parts = [];
for (let i = 0; i < 2; i++) {
  parts.push(crypto.randomBytes(2).toString('hex').toUpperCase());
}
const payload = parts.join('-');
const sig = crypto.createHmac('sha256', secret)
  .update(payload)
  .digest('hex')
  .substring(0, 4)
  .toUpperCase();

console.log(`WK-${payload}-${sig}`);
```

- [ ] **Step 2: Create API deployment README**

```md
# License Key Verification API

Deploy to Vercel:

```bash
cd api
npm init -y
npm pkg set type="module"
npm install vercel --dev
```

Set environment variable in Vercel dashboard:
- `LICENSE_HMAC_SECRET` — a random string (generate with `openssl rand -hex 32`)

Deploy:
```bash
npx vercel deploy --prod
```

Generate license keys:
```bash
LICENSE_HMAC_SECRET=your-secret node ../scripts/generate-license-key.mjs
```
```

(Keep the backtick escapes correct in the actual file)

- [ ] **Step 3: Commit**

```bash
git add scripts/generate-license-key.mjs api/README.md
git commit -m "docs: add license key generator and API deployment instructions"
```
