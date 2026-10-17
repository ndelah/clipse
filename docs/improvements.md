# Improvement priorities

Historical v0.7.3 review. The six initial user-facing priorities are implemented in v0.8.0; see [release notes](release-0.8.0.md). The proposals below preserve the original review, including later work that remains open.

## First: make existing behavior dependable

| Priority | Finding | Proposed change |
| --- | --- | --- |
| 1 | Saved-summary timestamps seek the active tab; Regenerate also reads that tab. | Bind summary actions to their video ID. Find or open that video before seeking; regenerate the displayed video explicitly. |
| 1 | Reading history shares Current and can be replaced by active-video refreshes. | Keep the selected saved summary stable, with a clear back-to-history action and a separate return to the current video. |
| 1 | Preferred languages label metadata without selecting the rendered transcript language. | Read the actual selected language; implement real selection or remove the misleading setting. Add a separate output-language setting. |
| 1 | Missing key becomes an error after the user starts a job. | Guide first use through a short setup state with a direct Settings action and an explicit key-validation action. Explain that OpenAI processing uses the user's API account. |
| 1 | Progress percentages are stage estimates; the text always says tabs can be switched. | Show accurate stage wording: “Reading captions — keep this video open,” then “Creating summary — you can leave this tab.” Show section counts for long videos. |
| 1 | Clear removes all history immediately. | Add individual deletion and undo, or a deliberate confirmation for clear-all. |
| 1 | Import accepts only a minimal record shape and arbitrary link strings. | Validate the full versioned data shape, timestamps, YouTube URLs/video IDs, and file size. Report skipped records and useful validation errors. |

## Next: make the summary easier to use

- Keep the side panel as the primary surface. Use a small Clipse mark, video title, channel, duration, and a single main action. Avoid repeating page headings inside each view.
- Put the one-sentence overview and watch recommendation first. Follow with takeaways and expandable detail so a viewer can decide quickly or read deeply.
- Give classifications understandable labels, such as “High information density,” and keep them visually secondary. Treat AI difficulty and value judgments as estimates.
- Offer **Copy summary** and Markdown export with the source URL and timestamp links. Keep portable JSON in History as backup/restore.
- Add history search by title/channel/content and lightweight favorites. Avoid folders or elaborate organization until the history size justifies them.
- Add brief/detailed summary choices and an explicit output language. Cache keys should include relevant settings so different configurations do not silently reuse incompatible results.
- Show actionable errors: transcript unavailable, video changed, reload required, invalid credentials, rate limit, and interrupted processing should lead to different next steps.
- Add selected-state semantics for navigation, live announcements for progress/errors, visible keyboard focus, and reduced-motion support. Verify narrow-panel wrapping and light/dark contrast when UI implementation begins.
- Use the supplied eclipse mark consistently. Prepare toolbar-size raster exports and a contrasting dark-theme treatment; verify its play cutout remains legible at 16–32 pixels.

## Later: add features around the transcript

1. Transcript search with source-linked passages to check a summary's evidence.
2. Follow-up questions grounded in the transcript, with timestamp citations.
3. Optional learning mode: saved notes or a small quiz derived from selected takeaways.
4. A queue for multiple videos, with a visible request budget and cancellation. Add playlists only after single-video extraction is reliable.
5. Optional sync if users need it; local history and explicit exports are a useful initial model.

## Engineering work supporting the product

- Keep the current plain-JavaScript extension for now. A framework migration is unnecessary for the initial cleanup and correctness fixes.
- Consolidate settings defaults and state writes. History import/clear currently write outside the service worker's mutation queue, which can race with job completion.
- Restrict credential storage to trusted extension contexts. Chrome documents that `storage.local` is exposed to content scripts by default and supports `setAccessLevel()` to limit that exposure: [Chrome storage API](https://developer.chrome.com/docs/extensions/reference/api/storage).
- Add token usage reporting and a user-set request budget; long videos can make many sequential API calls. Retry transient failures with bounded backoff and retain completed section notes for resuming.
- Prune completed jobs, obsolete tab bindings, and cached contexts; surface storage failures rather than losing summaries silently.
- Remove unused direct-caption fetch/parsing code after regression coverage confirms the rendered-transcript path. It currently remains in `offscreen.js` despite being absent from the active flow.
- Add focused tests when implementing fixes: wrong-video actions, import/clear versus completion, cancellation, long-video synthesis, and transcript extraction fixtures. Keep live Chrome checks separate from static checks.

Suggested next scope: correct saved-summary actions, fix language reporting, then improve first-run setup and summary hierarchy. That gives Clipse a dependable foundation before adding chat or batch features.
