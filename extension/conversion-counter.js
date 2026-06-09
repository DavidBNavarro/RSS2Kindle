const CONVERSION_KEY = 'web2kindle_conversion_count';
const FREE_LIMIT = 10;

async function getConversionCount() {
  const result = await chrome.storage.local.get(CONVERSION_KEY);
  return result[CONVERSION_KEY] || 0;
}

async function incrementConversion() {
  const count = await getConversionCount();
  const newCount = count + 1;
  await chrome.storage.local.set({ CONVERSION_KEY: newCount });
  return newCount;
}

async function resetConversionCount() {
  await chrome.storage.local.remove(CONVERSION_KEY);
}

