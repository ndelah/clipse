# Current features: v0.9.0

> This inventory describes the earlier implementation. See [the UI redesign](ui-redesign.md) for the current navigation, evidence, caption selection, library controls, and validation boundaries.

Implementation inventory. Focused regression checks use mocked browser and API boundaries; live Chrome behavior is a separate verification step.

## Summaries and reading

- One-sentence overview first, then the full summary as a goal-based Markdown document (see [Summary formats](summary-formats.md)), then collapsible timestamped takeaways.
- Brief output keeps only each format's essential sections and up to three takeaways/outcomes. Detailed output includes every section the source supports.
- Configurable output language, independent of YouTube's caption language.
- Configurable OpenAI model, defaulting to `gpt-4.1-mini`.
- Copy summary as Markdown and export a Markdown file, including the source video and timestamp links on key takeaways.
- Saved-summary timestamps find/open the correct video. Content scripts reject mismatched video IDs.
- Regenerate targets the displayed video, opening it in a background tab if needed.
- Saved reading stays stable through tab/navigation/storage updates. A back-to-History control returns to browsing; the panel opens to history without Video/History tabs.
- Supplied Clipse logo embedded in the YouTube player starts summarization with one click. Processing/failure status stays accessible and completed summaries appear in history for the user to open.
- Supplied Clipse logo, system light/dark colors, keyboard focus, active navigation semantics, progress/error announcements, and reduced-motion support.

## Caption extraction and processing

- Reads video ID, title, channel, duration, and available caption-track metadata.
- Reuses rendered transcript rows without opening YouTube's panel.
- Otherwise tries a five-second direct JSON3 caption request from the YouTube tab using its session. Empty/blocked responses fall back to rendered transcript extraction.
- Opens YouTube's transcript panel only when required and closes it in cleanup if Clipse opened it. A user-opened panel stays open. Description expansion is also restored when Clipse expanded it.
- Direct-caption language metadata comes from the requested track. Rendered-caption metadata comes from the selected transcript label; unknown labels stay explicitly unknown.
- No misleading preferred-caption-language setting. To choose a specific caption language, select it in YouTube's transcript panel before summarizing.
- Direct OpenAI Responses API calls with strict JSON output; no application backend.
- Whole-transcript requests up to 26,000 characters; approximately 11,000-character sequential sections and final synthesis above that threshold.
- Snapshot model/language/length when a job starts. Cached results/running jobs are reused only with compatible preferences; changed preferences require a new result.
- Stage estimates, elapsed time, section counts for long videos, and stage-specific guidance about keeping the source tab open.
- Background/offscreen processing, persistent job records, restart attempts, stop, retry, regeneration, heartbeats, and timeouts.

## History and settings

- Local profile history stores the latest summary per video ID and presents newest first.
- Search by title, channel, overview, or full summary.
- Read, open source, delete individual records, or clear all. Summaries enter history automatically; there is no separate Save feature or Saved filter.
- Summary actions use copy and Markdown download icons at the top. Takeaways have plain text without dividers; only timestamps are clickable. Caption language, caption type, and transcript limitations appear as one quiet note at the bottom of the header card, with no source dropdowns or duplicate playback links.
- Persistent single-level undo for deletion/clear. Undo preserves summaries saved or imported more recently. Deleted records remain locally available for undo until the next deletion or restoration.
- Versioned JSON backup/import; compatible with `video-preview-history` version 1.
- Imports validate supported fields, dates, YouTube IDs/links, and takeaway shapes; report skipped records. File selection is limited to 10 MB.
- History import/delete/undo share the service worker's state queue with job completion to avoid lost updates.
- API keys and settings are excluded from history backups.
- First-run setup appears before a missing-key job error.
- Shared side-panel and standalone options settings: key show/hide, model, summary language, brief/detailed length, explicit key/model-access check, and Save.
- Key/model access checks do not prove summary credit, model structured-output support, or generation success.
- Credential storage is restricted to trusted extension contexts. Summarization still sends transcript data to OpenAI using the user's API account.

## Remaining limits

- Needs readable captions; visual demonstrations without spoken description are not analyzed.
- YouTube DOM changes and transcript virtualization can affect extraction. Shorts/live/redirect variants need live validation.
- Keep the source video open through extraction. Direct caption requests can fail depending on the YouTube session.
- Local history has no cross-device sync, favorites, folders, or retention/pruning policy.
- No follow-up chat, transcript library/search, quizzes, batch queue, or playlist workflow.
- Job restart repeats work rather than restoring partially completed section notes. Token/cost reporting and request budgets are not yet implemented.
- One cached summary per video; regenerating in another language/length replaces it.
