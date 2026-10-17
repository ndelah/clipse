# Clipse Chrome Web Store assets

The upload-ready files are in `store/`. The editable Remotion project is in `remotion/` and is separate from the dependency-free extension.

## Deliverables

- `description.txt`: full listing description.
- `short-description.txt`: 117-character summary, also applied to the extension manifest.
- `icon-128.png`: 128 × 128 PNG; 96 × 96 forest-green artwork with 16 px transparent padding on every side. Uses Clipse's existing eclipse/play mark. The extension includes matching 16, 32, and 48 px icons.
- `screenshots/`: exactly five 1280 × 800 JPEGs, ordered overview, timestamps, recipes, history, categories.
- `tiles/small-promo-440x280.jpg`: small promo tile.
- `tiles/marquee-promo-1400x560.jpg`: marquee promo tile.
- `clipse-promo-1080p.mp4`: 33-second, 1920 × 1080, 30 fps H.264/AAC promotional video.
- `video-poster.png`: preview/YouTube thumbnail artwork, separate from the five screenshots.
- `video-description.txt`: suggested copy for the video upload.
- `asset-manifest.json`: measured output dimensions, formats, video details, and validation.

Screenshots use the actual shipped side panel with synthetic example summaries, identified in the artwork. They are not evidence of live API classification or summary quality. No real keys, personal history, third-party video footage, or third-party audio recordings are included. The instrumental score is generated from the included original synthesis script.

## Upload

Upload the extension ZIP separately from the store-media ZIP. Use `store/description.txt` for the detailed description and upload the images in numeric order. Upload the MP4 to YouTube, then put its video URL in the Chrome Web Store promo-video field. The video has no narration and uses English on-screen copy.

This bundle prepares the requested listing assets; it does not submit the extension or upload the video. Publisher account details, support/homepage URLs, and any required privacy-policy and dashboard disclosures still need to be supplied in the publishing workflow.

Official specifications checked October 12, 2026:
- [Chrome Web Store listing fields](https://developer.chrome.com/docs/webstore/cws-dashboard-listing)
- [Icon, screenshot, and promotional image specifications](https://developer.chrome.com/docs/webstore/images)
- [OpenAI API billing is separate from ChatGPT](https://help.openai.com/en/articles/9039756-managing-billing-settings-on-chatgpt-web-and-platform)

## Reproduce the assets

Requires Node.js 20+, Python 3, and Google Chrome on macOS. Set `CLIPSE_CHROME` to another Chrome executable for rendering on a different setup; update the Playwright launch channel if Chrome is installed differently.

```sh
cd marketing/remotion
npm ci
npm run capture
python3 score.py
npm run render
npm run validate
```

`npm run studio` opens the editable Remotion composition. `node render.mjs --stills-only` renders the five screenshots and both tiles. `node render.mjs --video-only` renders just the MP4 and its poster. `CLIPSE_NODE_MODULES` optionally points to an external directory containing Playwright.

To regenerate extension icons, run the root `scripts/icons.mjs` with `SHARP_MODULE` pointing to the installed Sharp entrypoint. Copy `extension/assets/icon-128.png` to `marketing/store/icon-128.png` afterward.

The video storyboard is 0–4s brand/promise, 4–10s summary, 10–16s timestamps, 16–22s recipes, 22–28s history, 28–33s closing/setup requirement. The render is driven by frame-indexed Remotion animation; the output is reproducible from the lockfile and captured UI assets.
