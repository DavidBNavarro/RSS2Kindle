// Vercel serverless function for license key verification
// Deploy to Vercel at web2kindle-verify.vercel.app
// Set LICENSE_HMAC_SECRET env var in Vercel dashboard
// Note: Configure rate limiting in Vercel dashboard or add a WAF
// to prevent brute-force attacks on the 16-bit HMAC signature.

import crypto from 'crypto';

const SECRET = process.env.LICENSE_HMAC_SECRET || 'dev-secret-change-in-production';

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

export { generateKey, verifyKey };
