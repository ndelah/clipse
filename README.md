# Clipse

Clipse summarizes captioned YouTube videos so you can decide what to watch and revisit useful moments. **v0.8.2** builds on the supplied v0.7.3 baseline.

## Project structure

```text
extension/             Load this directory as an unpacked Chrome extension
  manifest.json        Permissions and entrypoints
  service-worker.js    Jobs, video targeting, and serialized history writes
  offscreen.html/js    Background OpenAI summarization
  page-context.js      YouTube player metadata
  content-script.js    Direct captions, transcript fallback/cleanup, playback
  player-button.js/css Embedded Clipse player control and status
  thumbnail-button.js/css One-click summaries from YouTube video cards
  sidepanel.html/js/css
  options.html/js      Standalone settings
  settings-form.js     Shared settings controls
  shared.js            Configuration, video identity, history format, Markdown
  evidence.js          Transcript segment references and actual excerpts
  languages.js         Named caption tracks and output-language suggestions
  recovery.js          Actionable failure categories
  assets/              Supplied logo plus toolbar/extension raster icons
assets/brand/           Original logo, copied unchanged
scripts/                Dependency-free checks and ZIP packaging
tests/                  Focused Node regression tests
docs/                   Features, architecture, and release notes
dist/                   Generated archives; ignored by Git
```

Historical `video-preview-extension*` folders stay on disk and are ignored by Git. Only root-level `extension/` is active source.

## Install or reload

1. Open `chrome://extensions` in Chrome 116 or later and enable Developer mode.
2. Choose **Load unpacked** and select this project's root-level `extension/` folder, or reload its existing entry.
3. Reload open YouTube tabs after each extension update.
4. Open Clipse and choose **Connect OpenAI** to add your OpenAI API key, or inspect the illustrative sample first. **Test connection** checks key/model access without generating a summary. Saving a new key or model also checks access; available API credit is still required.
5. Choose caption language, summary language (Same as captions by default for new profiles), and brief/detailed length in **Settings**. Hover over a video thumbnail on Home, search, subscriptions, or recommendations and click **Summarize**, or open a captioned video and click the **Clipse logo in the player controls**. The thumbnail action also appears on keyboard focus and stays visible on touch devices.
6. Clipse opens to **History**. Completed videos appear automatically; click a title to read its summary. Processing and failed jobs are accessible above the list, with stop/retry controls. There are no Video/History navigation tabs.

The default model remains `gpt-4.1-mini`; your API project must support the selected model and have available credit. Clipse sends transcripts directly to OpenAI. It has no application backend.

Clipse waits for matching video data, then reuses rendered rows or reads captions through YouTube's modern `get_panel` endpoint in the page's own session. This path does not depend on a visible Show transcript button and supports timeline rows containing `simpleText` and `timestamp`. A rejected or empty response falls back to the current video's legacy transcript endpoint, then a direct caption request. Explicit language choices are accepted only when the returned track can be verified. When YouTube requires the transcript panel, Clipse waits for the description and its transcript control to render, then closes a panel it opened immediately after extraction, including after cancellation or failure. A panel opened by the user stays open. Keep the video tab open during extraction; afterward, processing can continue while you switch tabs or close Clipse.

Caption extraction supports both legacy transcript rows and modern attributed text, including transcript panels without a `target-id` and the consolidated timeline panel. Empty or blocked caption endpoint responses fall back to the rendered transcript. A missing transcript control is reported as an extraction failure, rather than proof that captions are absent. If extraction fails, reload the YouTube tab and retry; the error gives caption-specific recovery steps. The current changes have automated coverage; extraction in the user's live Chrome session still needs verification.

Thumbnail summaries keep you on your current page. Clipse requests the thumbnail's video ID directly through the already-loaded YouTube session, without waiting for a hidden watch page's player, description, or transcript UI. An active tab already showing that video can use its existing extraction path. If the direct request is unavailable or cannot verify your explicit caption choice, Clipse falls back to a matching video tab or a temporary, muted background tab. Its temporary tab closes after caption extraction, including failures or cancellation, unless you activate it or navigate it elsewhere. Cached summaries and running jobs are reused without creating another tab. Thumbnail clicks preserve the feed/watch tab's existing video binding; transcript sources are checked against each tab's current and pending URL, including stale bindings from previous versions. Thumbnail cancellation is scoped to its job, so other thumbnail jobs and player extraction continue. Live YouTube compatibility still needs browser verification.

Loading from a different folder may create a new unpacked extension ID and separate profile storage. Export existing history first, then import it into Clipse. Keys and settings are excluded from backups and must be entered again.

## Category-aware summaries

In **Settings → Summary categories**, add, edit, or remove categories and customize their definitions and summary instructions. The starter set covers 20 distinct video categories, including recipes and cooking, plus a mandatory Other fallback. Each category defines what belongs there and what its summary must preserve. Untouched older starter sets upgrade automatically; customized sets and saved summaries stay intact. Save settings to apply changes to new or regenerated summaries.

Classification runs before summarization and scores assumed prior knowledge, information density, and instruction specificity independently of the viewer's experience. OpenAI Decisions (`gpt-6-luna`) classifies videos, and the summary language model writes summaries. Both use the same OpenAI API key. Onboarding accepts and verifies that key directly; connection checks make small paid requests to both endpoints. Classification failure or uncertainty uses the Other prompt automatically.

See [routing design and limitations](docs/category-routing.md). Automated integration checks use mocked provider responses; live API behavior and browser presentation still require verification.

## Development

Use Node.js 20+. There are no npm dependencies, build step, or application server.

```sh
npm test
npm run check
npm run package
```

`test` covers video targeting, stable saved reading, caption cleanup, configuration-aware caching, history/undo/import concurrency, output prompts, and exports with mocked Chrome/DOM/API boundaries. `check` validates syntax, module imports, resources, and version consistency. `package` includes the static check and writes `dist/clipse-0.8.2.zip` with the manifest at the ZIP root; it requires the system `zip` utility.

These checks do not prove live YouTube DOM compatibility, real OpenAI access, or visual rendering in Chrome.

See [transcript diagnosis and regression coverage](docs/transcript-reliability.md), [implemented UI redesign and validation](docs/ui-redesign.md), [current features](docs/current-features.md), [v0.8.0 changes](docs/release-0.8.0.md), and [architecture](docs/architecture.md).

