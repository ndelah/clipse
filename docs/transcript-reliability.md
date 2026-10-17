# Transcript extraction repair — 2026-10-12

The reported error combines two separate failures. These code paths are reproduced with mocked page/Chrome boundaries; the user's failing Chrome session has not been inspected.

- `startJob` wrote a thumbnail's video into the sender tab's binding even though that tab could still be Home or a different watch page. `candidateTabsForJob` trusted those bindings and stored contexts without validating Chrome's current URL. This introduced wrong-video extraction candidates. A null source tab also became numeric tab ID 0.
- The main-world bridge only called `get_transcript`, only searched `engagementPanels` for its command, and was gated on finding that command. Modern YouTube exposes a `get_panel` transcript route that does not need that legacy command. Its timeline segments can use `simpleText` and `timestamp`, which the previous parser discarded. When timedtext returned an empty response, extraction therefore depended on finding a visible Show transcript control.
- Extraction waited a fixed 150 ms for metadata. Newly opened background tabs and SPA navigation can take longer to publish matching player/caption data.

Thumbnail starts now preserve the sender's binding, and source candidates must match Chrome's current/pending video URL. This also handles old persisted bindings. Extraction waits briefly for matching player data, then uses rendered captions or the modern page-session route, followed by legacy page data, timedtext, and the rendered panel. Explicit language choices are independently checked in both worlds. Cancel/time limits release request listeners and timers; panel and temporary-tab cleanup remain covered.

Modern route/parameter reference: [FeedIQ's transcript transport documentation](https://github.com/IvanLLGcoder/feediq/blob/main/docs/ARCHITECTURE.md#the-transcript-route). Timeline response reference: [youtube-transcript-downloader parser](https://github.com/ColinEberhardt/youtube-transcript-downloader/blob/main/popup.js). These are reverse-engineered YouTube interfaces, with the existing DOM fallback retained.

Regression coverage includes modern extraction without a legacy endpoint or visible button, actual timeline timestamp/text fields, legacy fallback after rejection/timeout, signed-in request containment, stale data and bindings, delayed player context, navigation, language verification, cancellation, and temporary-tab ownership.

Reload the extension and existing YouTube tabs to load both updated content-script worlds. A successful live extraction still needs verification in Chrome; the automated fixtures do not establish the failing video's current response or layout.

## Thumbnail-only follow-up

The user confirmed extraction works when the target video is open but fails through thumbnail shortcuts. The thumbnail transport still created a hidden watch page and called `contextForVideo`, which waits for `playerReady` before starting extraction. The successful foreground path did not exercise this dependency. The exact failing background response has not been captured.

Thumbnail jobs now persist their initiating tab ID and request captions directly by video ID from that already-loaded YouTube session. Home, search, and recommendations do not need a matching player response or video URL. This transport only uses params for the requested ID; it cannot reuse the host watch page's legacy endpoint or caption-track metadata. An active target video retains its working extraction path. Video tabs remain a fallback for rejected requests and explicit caption choices that cannot be verified from the direct response.

The worker tracks the active request tab separately from the video's source tab. Cancellation targets the thumbnail job's controller, leaving other thumbnails and player extraction alone. Direct responses retain the supplied card title and report unknown metadata honestly. Regression tests connect both real script worlds on Home and another video's watch page with no target player, DOM button, or timedtext URL; worker tests verify no tab is created on success and cancellation cannot create a fallback tab.
