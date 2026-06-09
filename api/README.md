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
