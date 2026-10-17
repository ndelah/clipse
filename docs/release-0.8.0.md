# Clipse v0.8.0

Implements the six priorities from the initial v0.7.3 review and the requested transcript-panel cleanup.

1. **Correct video targeting.** Timestamp actions and regeneration use the displayed summary's ID. Existing tabs are matched exactly; absent videos are opened. Seeking is checked again inside the content script and has a timestamp-URL fallback.
2. **Accurate language handling.** Removed the ineffective preferred-caption-language UI. Direct requests identify the track actually requested; rendered captions use the selected panel label without guessing. Summary language is a separate persisted preference, carried into single-request and long-video output.
3. **First-run setup.** Missing keys lead to an onboarding state with a Settings action. Both settings surfaces share key/model access validation, saved preferences, and clear API-account/credit wording.
4. **Stable history.** Saved reading is independent of the active video, with explicit return controls. Added search, individual delete, clear-all undo, stricter import validation, and serialized history mutations.
5. **Summary hierarchy and branding.** Overview/recommendation first, takeaways second, expandable summary and learning outcomes, secondary classification estimates, supplied logo, dark theme treatment, focus states, reduced motion, and live status messaging.
6. **Useful controls.** Added copy-summary and Markdown export with source/timestamp links, output language, and brief/detailed generation. Model/language/length participate in cache compatibility and are snapshotted on jobs.

Transcript extraction reuses rendered rows first, then attempts a bounded direct caption fetch. If the transcript panel is required, a `finally` cleanup closes a Clipse-opened panel after success, failure, or cancellation and restores description expansion. A panel already open stays open.

Chrome permission addition: `clipboardWrite` supports the explicit Copy summary action. The original logo file and historical version directories are unchanged. Storage keys and the version-1 history format remain compatible.

Validation: focused Node tests with mocked Chrome, DOM, and OpenAI responses, plus static resource/module/syntax checks and ZIP generation. Live Chrome, real API responses, and visual layout have not been manually verified.

Grounded follow-up questions remain a later feature, as scoped in the original recommendation.
