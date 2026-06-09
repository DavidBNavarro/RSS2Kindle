const DEFAULT_SERVER = "http://127.0.0.1:5001";
const ARCHIVE_DEFAULTS = {
  paywalledHosts: "theverge.com,wired.com,medium.com",
  paywallSelectors: "[data-paywall],[data-locked],.paywall,.paywall-content,.paywall-redirect",
  archiveDomains: "https://archive.org,https://archive.ph,https://archive.is,https://archive.today,https://archive.li,https://archive.vn",
  archiveTimeoutMs: 15000,
  archiveRetries: 2,
  archiveRenderStrategy: "iframe",
};
let SERVER = DEFAULT_SERVER;

function showStatus(msg, type) {
  const el = document.getElementById("status-msg");
  el.textContent = msg;
  el.className = type; // "success" or "error"
}

document.addEventListener("DOMContentLoaded", async () => {
  const stored = await chrome.storage.sync.get({
    serverUrl: DEFAULT_SERVER,
    ...ARCHIVE_DEFAULTS,
  });
  SERVER = stored.serverUrl || DEFAULT_SERVER;
  document.getElementById("server-url").value = SERVER;
  document.getElementById("paywalled-hosts").value = stored.paywalledHosts || ARCHIVE_DEFAULTS.paywalledHosts;
  document.getElementById("paywall-selectors").value = stored.paywallSelectors || ARCHIVE_DEFAULTS.paywallSelectors;
  document.getElementById("archive-domains").value = stored.archiveDomains || ARCHIVE_DEFAULTS.archiveDomains;
  document.getElementById("archive-timeout").value = stored.archiveTimeoutMs || ARCHIVE_DEFAULTS.archiveTimeoutMs;
  document.getElementById("archive-retries").value = stored.archiveRetries || ARCHIVE_DEFAULTS.archiveRetries;
  document.getElementById("archive-render").value = stored.archiveRenderStrategy || ARCHIVE_DEFAULTS.archiveRenderStrategy;

  const kindle = await chrome.storage.sync.get({ kindle_email: "" });
  if (kindle.kindle_email) document.getElementById("kindle-email").value = kindle.kindle_email;

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

  document.getElementById("btn-remove-license").addEventListener("click", async () => {
    await clearLicense();
    licenseKeyInput.value = "";
    licenseStatus.textContent = "License removed.";
    licenseStatus.className = "";
  });
});

document.getElementById("config-form").addEventListener("submit", async (e) => {
  e.preventDefault();

  const newServerUrl = document.getElementById("server-url").value.replace(/\/+$/, "") || DEFAULT_SERVER;
  const paywalledHosts = document.getElementById("paywalled-hosts").value.trim();
  const paywallSelectors = document.getElementById("paywall-selectors").value.trim();
  const archiveDomains = document.getElementById("archive-domains").value.trim();
  const archiveTimeoutMs = Number(document.getElementById("archive-timeout").value) || ARCHIVE_DEFAULTS.archiveTimeoutMs;
  const archiveRetries = Math.max(1, Number(document.getElementById("archive-retries").value) || ARCHIVE_DEFAULTS.archiveRetries);
  const archiveRenderStrategy = document.getElementById("archive-render").value;

  const kindle_email = document.getElementById("kindle-email").value.trim();

  await chrome.storage.sync.set({
    serverUrl: newServerUrl,
    paywalledHosts,
    paywallSelectors,
    archiveDomains,
    archiveTimeoutMs,
    archiveRetries,
    archiveRenderStrategy,
    kindle_email: kindle_email || undefined,
  });
  SERVER = newServerUrl;

  showStatus("Settings saved!", "success");
});
