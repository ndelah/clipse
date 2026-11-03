# Summary formats

Every full summary is a Markdown document shaped by the **viewer's goal**, not by the video's topic. A recipe, a furniture repair, and a workout share one goal ("do this myself"), so they share one format. Categories still decide *what to preserve*; formats decide *how the summary is laid out*.

The format definitions (field schemas, Knap templates) and category mapping live in `extension/formats.js`; `extension/format-render.js` renders them. This document explains the design.

## Formats

| Format | Viewer goal | Starter categories | Body sections |
| --- | --- | --- | --- |
| **Follow-along** | Do this myself while the video is closed | Recipes, DIY, Fitness, Gaming | Key-facts line → What you need (task list) → Steps (numbered, ### phases) → Tips & variations → Storage/aftercare. Workouts use an Exercise / Sets × reps / Rest / Form cue table. |
| **Article** | Learn to do this by reading before trying | Software tutorials | What you'll build → Before you start → numbered ## phases with prose and code blocks → Common pitfalls → Wrapping up. Reads like a Medium post. |
| **Explainer** | Understand an idea | Lessons, Research | The big idea → Key concepts → How it works → Example → Misconceptions. Research: Question → Method → Findings → Caveats → Why it matters. |
| **Verdict** | Decide what to buy or choose | Product reviews, Comparisons | Verdict (Best for / Skip if) → Pros/cons table → How it was tested → Comparison table → Specs and price. |
| **Briefing** | Know what happened or what's new | News, Announcements, Sports | What happened → Key facts → Timeline → Confirmed vs. disputed → What's next. Sports open with the result; announcements use a table. |
| **Argument** | Weigh a position | Opinion, Debates | Thesis → numbered argument chain → Counterpoints → Assumptions. Debates: Question → position table → Agreement → Unresolved. |
| **Conversation** | Keep what was said that's worth remembering | Interviews | Guest/host line → one ## section per theme with attributed bullets and verbatim quotes → Recommendations mentioned. |
| **Story** | Get the story without watching it all | Documentaries, Vlogs, Fiction, Performances | Premise → Key people → How it unfolds (beats) or Set list → Ending (spoiler block) → Themes. |
| **Trip plan** | Plan a visit | Travel | At-a-glance line → Itinerary by day → Getting around → Costs table → Local tips. |
| **General** | Get the substance in a clear structure | Other, new custom categories | Overview → Main points. |

Each category has a `format` field, editable in **Settings → Summary categories → Summary format**. Built-in categories default to the table above; new custom categories default to General. Categories saved before formats existed receive their default format when settings load.

## Fields, then template

The model does not write the Markdown. Each format declares a set of **fields** (`fields` in `formats.js`), sent as `summary_fields` in the structured-output schema. Every field can be left empty (`null` or `[]`), and the prompt tells the model to fill only what the source clearly supports. The fields are a menu, not a checklist.

The format's **Knap template** (the same template language as the Obsidian note) then renders the Markdown body. Every section is wrapped in `{% if %}`, so empty fields produce nothing, and a video with only ingredients and steps gets only those two sections. Variants such as workouts, research talks, sports, announcements, debates, and live performances are extra fields in the same format rather than alternative templates. The model fills whichever variant applies.

The rendered Markdown is stored as `preview.full_summary`, and the raw fields are discarded. Everything downstream (panel rendering, history, export, Obsidian) is unchanged.

Template filters (`format-render.js`): `line` collapses a value to one line, `cell` also escapes pipes and shows `—` for an empty table cell, and `prefix`, `suffix`, `label`, and `facts` join optional text. Knap trims whitespace next to `{% %}` tags, so optional inline text goes through these filters instead of inline conditionals.

## Shared rules

The side panel already shows the title, one-sentence summary, worth-watching note, key takeaways, and metadata, so the Markdown body starts directly with the format's first section. For every format:

- Unfilled fields render nothing. Comparison-style tables keep their columns and show `—` for an empty cell.
- Numbered lists for order, tables for items that share attributes, blockquotes only for verbatim quotes or step tips, bold for key terms and numbers. Structure comes from the template; field values are plain prose with inline bold, italic, and code.
- Brief length fills only the essential fields; detailed length fills every field the source supports.
- The category's own instructions (exact quantities, attribution, spoiler labels, and so on) still apply on top of the format.

## Timestamps

Timestamps appear only in key takeaways (and the recipe card's steps), never in the formatted summary body. Format fields carry no segment IDs, the prompt tells the model not to write clock times, and `stripCitations` removes any `[[S12]]` or `[[t:SECONDS]]` token the model writes anyway. Saved summaries from before this change have their body timestamps removed when loaded.

## Rendering and safety

`extension/markdown.js` supports one deliberately small subset: headings, paragraphs, bold, italic, inline code, fenced code, bullet/numbered/task lists (nested), blockquotes, pipe tables, rules, and `:::spoiler Label … :::` blocks. It builds DOM nodes with `textContent` only. HTML appears as literal text, links are reduced to their label, and images are not supported. In the panel, `##` renders as `h3` so the document sits below the panel's own headings. Task-list checkboxes are interactive but not saved; the recipe card remains the place for persistent checklists.

Downloaded Markdown converts spoiler blocks into `<details>`, so the file works in any Markdown viewer.

## Compatibility

Summaries record `preview.format`. Without it, the summary is a legacy prose summary and keeps the old paragraph rendering and export. Because categories now include a format, existing saved summaries show as made with different preferences; **Regenerate** produces the formatted version. The recipe card's structured extraction is unchanged and runs alongside the Follow-along Markdown.

## Not yet verified

Automated tests cover format mapping, editor persistence, prompt routing, citation stripping, the Markdown parser and renderer, history round trips, and export, strict-schema validity of every format, empty fields rendering nothing, and partial fills rendering only their sections, all using mocked model responses. How well live models leave fields empty rather than padding them, and how the formats read across many real videos and output languages, has not yet been evaluated.
