# Architecture and development boundaries

## Runtime

1. `page-context.js` reads YouTube's player response in the main world and publishes metadata through `window.postMessage`. Its transcript bridge calls modern `get_panel` and legacy `get_transcript` in the page's session, parses timeline/legacy caption shapes, and bounds/cancels requests. Session authentication stays in the main world; cookies and authorization headers never enter extension messages or storage.
2. `content-script.js` relays metadata, reuses/fetches captions, falls back to the transcript DOM, restores UI it opened, and validates video identity before seeking.
3. `player-button.js`/`.css` embed the supplied logo in YouTube player controls, with an overlay fallback when controls are absent. A trusted click starts a job and opens the history panel. The button follows SPA navigation/control replacement and polls sanitized status while processing.
   `thumbnail-button.js`/`.css` add a separate hover/focus action to legacy and modern video cards, following infinite scrolling and recycled video links. Thumbnail jobs preserve the feed tab's existing binding. Their normal transport is a main-world `get_panel` request with the explicit thumbnail video ID from the already-loaded YouTube session. This requires no matching player or transcript DOM. An active matching video can use its usual extraction path; matching/background video tabs remain fallback transports. Current/pending tab URLs are authoritative; stale bindings and stored contexts cannot select a different video's tab. If needed, the worker creates a temporary background tab, mutes it before navigation, pauses playback during context acquisition, and closes it after extraction or cancellation. Tabs the user activates or navigates elsewhere are retained. Temporary tab IDs persist for cancellation/restart cleanup; video-tab fallbacks refresh metadata before synthesis. Direct feed requests retain the card title and leave unavailable channel/duration/track metadata unknown. They never borrow metadata or legacy commands from another video.
4. `sidepanel.js` opens directly to History, with Settings and pinned saved-summary/background-job reading states. Completed summaries enter the list without automatically opening. Explicit user actions leave saved reading.
5. `service-worker.js` coordinates persistent jobs, finds video-specific tabs, serializes job/history mutations, and validates key/model access on request.
6. `offscreen.js` receives a transcript, applies the job's generation configuration, calls OpenAI, and sends progress/completion to the worker.
7. `shared.js` holds defaults, configuration comparison, exact video identity, history normalization/merge, and Markdown export. `settings-form.js` shares settings behavior between the panel and options page.

Firefox loads the same files from `extension-firefox/` with a separate manifest. The background script is an event page (`background.scripts` with `type: "module"`) rather than a service worker. The toolbar action toggles `sidebar_action` because Firefox has no side panel. `sidebarAction.open()` only succeeds from a browser user gesture, so player and thumbnail clicks start the job and the toolbar button opens the sidebar. Firefox also has no offscreen documents. When summarization starts, the worker opens a minimized popup pointed at `offscreen.html`. That page is a separate extension context, so the existing offscreen message protocol keeps running after the sidebar closes and can wake the event page. Chrome keeps using `chrome.offscreen` when `runtime.getContexts` and `offscreen.createDocument` exist.

For long transcripts, offscreen processing produces section notes then a whole-video synthesis. Settings snapshot model, caption/output language, length, and category/provider configuration; API keys are retrieved separately and never included in summary configuration or exports. Legacy summaries remain readable. Generation reuses cached summaries only when their configuration matches current settings. See [UI redesign](ui-redesign.md) for current behavior and validation boundaries.

## Local state

| Key | Purpose |
| --- | --- |
| `apiKey`, `model`, `captionLanguage`, `outputLanguage`, `summaryLength` | User settings |
| `jobs` | Status, progress, metadata, generation configuration, errors, thumbnail initiator and active request tab IDs |
| `summaries` | Latest summary by video ID and linked caption excerpts |
| `tabBindings`, `latestContexts` | Source-tab/job relationships and metadata |
| `historyUndo` | One deleted record set retained for undo |

All job/history read-modify-write operations use `mutateState` in the worker. Undo and imports merge by video ID and retain newer records. The old `preferredLanguages` key may remain in upgraded profiles but no longer affects extraction.

History portability retains `video-preview-history`, version 1. Import picks supported summary fields and canonicalizes source URLs; keys/settings are excluded. The raw transcript and intermediate section notes stay in offscreen memory; only linked excerpts are persisted, so restart may repeat API work.

On Chrome, storage access is restricted to trusted extension contexts. Firefox has no equivalent restriction. Content scripts obtain only the messages they need in both browsers. Runtime requests from YouTube content scripts are limited to metadata updates, player/thumbnail job starts, and sanitized video status. Player requests validate the top-level sender and video URL; job context comes from the sender tab. Thumbnail requests validate a top-level HTTPS YouTube sender and an exact video ID; URLs are built by the worker, and caption metadata comes from the video tab. Both buttons require trusted clicks. Side-panel opening happens before asynchronous work to preserve the [user gesture](https://developer.chrome.com/docs/extensions/reference/api/sidePanel#method-open). See [Chrome storage API](https://developer.chrome.com/docs/extensions/reference/api/storage). Video-tab lookup, activation, creation, and messaging use the [Chrome tabs API](https://developer.chrome.com/docs/extensions/reference/api/tabs).

## Maintenance

- `extension/` is loaded directly without bundling. All runtime assets and modules live inside it. `extension-firefox/` mirrors those files, plus its own manifest. Regenerate the mirror with `npm run sync:firefox` after editing `extension/`.
- `assets/brand/eclipse.svg` remains the unchanged supplied logo; its runtime copy is `extension/assets/eclipse.svg`.
- Keep package/manifest versions aligned. No npm lockfile is needed until dependencies are introduced.
- Historical `video-preview-extension*` folders stay ignored and are excluded from ZIP output.
- Run focused regression tests for affected behavior, then static checks/package. Browser/API/visual verification is separate.
- Old direct-caption parsing helpers remain in `offscreen.js`; the active direct request is in the YouTube content script, with DOM fallback there.
