# Web2Kindle Monetization

## Goal

Monetize Web2Kindle through a freemium model: free tier with a 10-conversion
cap and a one-time Pro license key that unlocks unlimited conversions. The
extension must work fully self-contained (no local server dependency) for both
tiers.

## Conversion Counter

A counter in `chrome.storage.local` (`conversion_count`) that:

- Increments on two actions: "Send to Kindle" success and "Download EPUB" success
- Does NOT increment on preview renders, paste-mode attempts, or failed conversions
- Default cap: 10 conversions for users without a valid Pro license
- Unlimited for users with a verified Pro license
- Persists across browser restarts

A hash of URL + timestamp is stored alongside each counted conversion to
prevent trivial replay (re-sending the same URL gets a different timestamp
hash each time). Full storage clear is still possible but accepted friction.

## License Key System

### Purchase Flow

1. User buys "Web2Kindle Pro" on Lemon Squeezy (one-time, ~$7)
2. Lemon Squeezy handles payment processing, EU VAT, US sales tax
3. Lemon Squeezy emails the license key to the buyer automatically
4. Optionally: Lemon Squeezy pings a verification webhook (not required for core flow)

### Entry & Storage

- User pastes the license key into a new "License" section in Settings
- Stored in `chrome.storage.sync` (syncs across Chrome installs)
- On first entry, extension pings a verification endpoint with the key
- If valid, sets `pro_license_verified: true` in `chrome.storage.sync`
- Prevents single-key sharing across unlimited machines

### Verification

- One-time web verification on first key entry (tiny endpoint — Vercel function
  or similar lightweight host)
- After verified, the `pro_license_verified` flag is trusted offline
- No daily pings, no phone-home, no DRM

## Upgrade UX

- **Conversions 8-9**: subtle "nudge" under action buttons: "Nearing the free
  limit. Upgrade for unlimited conversions."
- **Conversion 10**: buttons disabled. Upgrade card replaces them: "You've
  reached the free limit of 10 conversions. Enter a license key or upgrade to
  continue using Web2Kindle." Includes two buttons: "Upgrade to Pro" (opens
  Lemon Squeezy checkout) and "Enter License Key" (opens Settings).
- **With valid Pro license**: "PRO" badge next to the Web2Kindle header in
  popup. Counter still tracks but never blocks.
- **History**: all previous conversions remain visible regardless of tier.

## Chrome Web Store Compliance

The model is fully compliant with current CWS policies (2026):

- **Not using CWS Payments** (deprecated 2020) — external processor is standard
- **Extension listed as free** on CWS, with honest disclosure in the listing
- **Listing description** must clearly state: *"Free tier includes 10 EPUB conversions. Unlimited conversions available via one-time Pro license at web2kindle.com/upgrade."*
- **Privacy policy** required for the Chrome Web Store listing since the extension stores URL data for conversion tracking
- **No deceptive behavior** — the free cap is clearly communicated, no hidden limits
- **Customer support** — must be provided (GitHub issues is sufficient)
- **External payments allowed** — CWS developer agreement explicitly says: *"If you charge a fee for your Product, you assume sole responsibility and liability for all related transactions"*

## Pipeline Dependency

The monetization model depends on the extension working without a local server.
The browser-native article processing pipeline (Mozilla Readability + JSZip)
must be completed first, or at least in parallel.

## ROADMAP Changes

### New items

| Task | Area | Effort |
|---|---|---|
| Conversion counter (`chrome.storage.local` + increment points) | Extension core | Small |
| License key UI (Settings input, verify button, storage) | Extension UX | Small |
| Pro upgrade UI (nudge at 8-9, block at 10, badge, upgrade links) | Extension UX | Small |
| License verification endpoint (Vercel function or equivalent) | Infrastructure | Small |

### Reordered priorities

1. Browser-native article processing (enables the whole model)
2. Conversion counter + license system (enables revenue)
3. Wire image-processor.js
4. SMTP relay server
5. Everything else (multi-send, paste mode, cover image, etc.)
