// scripts/generate-license-key.mjs
// Usage: LICENSE_HMAC_SECRET=your-secret node scripts/generate-license-key.mjs

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
