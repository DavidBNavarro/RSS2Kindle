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
