# Clipse product website

- Homepage: https://clipse.delahousse.xyz/
- Privacy policy URL for Chrome Web Store: https://clipse.delahousse.xyz/privacy
- Store listing: pending; replace the coming-soon text when the real listing URL is available.

Static source is in `website/dist`. It uses the existing marketing identity, actual extension UI captures with illustrative content, and the 33-second Remotion promo. The privacy policy reflects the reviewed 0.8.0 implementation.

## Hosting

The public custom domain serves Cloudflare Workers static assets. Configuration: `scripts/clipse-site.wrangler.jsonc`. Cloudflare manages the custom domain's DNS and TLS certificate. Deploy from the repository root with:

```sh
npx wrangler deploy --config scripts/clipse-site.wrangler.jsonc
```

The same source is saved and published through Sites at https://clipse.ndelahou.chatgpt.site. Its project identity is persisted in `website/.openai/hosting.json`; `website` has its own Sites source Git repository. Keep both published copies synchronized when changing the site. Use the Sites source workflow to push source, package static assets, save a version, and deploy it. Never store source credentials in files.

Initial source commit: `6aa78899058ff3d66c06093d28824f58c39ed06b`.
Initial Cloudflare version: `d46ad714-c119-453a-aed6-f338f623c483`.

## Verification

Homepage and privacy policy passed automated Chromium checks at 1440, 390, and 320 px, including no horizontal overflow, accessible example-tab controls, and FAQ expansion. Published custom-domain pages returned HTTP 200 after the privacy URL's normal trailing-slash redirect. The live MP4 played successfully, reporting 33 seconds and 1920 × 1080. Cloudflare and Google public DNS resolvers returned the newly created hostname.

Review the policy whenever provider requests, retained data, permissions, analytics, or hosting change. API key requirements must remain visible beside the install action when it is added.
