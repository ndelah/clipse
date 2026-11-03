# Category-aware summary routing

The video's purpose selects a summary lens before the summary is generated. The starter set includes 20 categories plus Other. Classification selects the dominant purpose using the most specific matching definition; mixed formats with a clear dominant purpose use that category while preserving important material from other formats. Other is a protected catch-all for unmatched formats, mixed purposes, insufficient evidence, uncertain results, and classification failures.

Both the side panel settings and standalone options page support adding, editing, and removing categories. Each has a stable internal ID, a user-visible name, a classification definition, and summary instructions. Other's fields can be edited, but it cannot be removed. Settings are saved explicitly; incomplete or duplicate-name drafts are rejected. The local cap is 50 categories.


## Starter categories

| Category | What belongs here | What the summary should preserve |
| --- | --- | --- |
| Recipes and cooking | Dishes, baking, drinks, meal preparation | Quantities, servings, ordered steps, temperatures, times, doneness cues, substitutions, storage |
| DIY, crafts, and repairs | Making, restoring, or fixing physical objects | Tools, materials, measurements, prerequisites, steps, warnings, mistakes, finished result |
| Software tutorials | Coding, app tasks, configuration, troubleshooting | Versions, setup, commands/code, settings, steps, verification, demonstrated fixes |
| Fitness and movement | Workouts, yoga, stretching, technique | Exercise order, sets, repetitions, duration, rest, equipment, form, modifications, stated cautions |
| Lessons and explainers | Concepts, skills, theories, history | Objective, definitions, reasoning, examples, misconceptions, takeaway |
| Research presentations | Studies, scientific talks, research conferences | Question, methods, sample, results, limitations, uncertainty, evidence versus interpretation |
| News reports | Current events and developments | Events, people, places, dates, sources, confirmed/disputed claims, open questions |
| Opinion and analysis | Essays, criticism, commentary | Thesis, arguments, evidence, assumptions, counterarguments, attributed views |
| Interviews and conversations | Guest interviews, podcasts, oral histories | Speakers, questions, answers, experiences, disagreements, qualifications, quotes |
| Debates and panel discussions | Competing positions and multiple viewpoints | Question, positions, arguments, rebuttals, agreement, unresolved issues |
| Documentaries and investigations | Developed factual narratives and investigations | Subject, chronology, discoveries, evidence, sources, competing accounts, limits |
| Product reviews | Evaluation of one primary product | Model/version, price context, testing, strengths, weaknesses, verdict, audience |
| Comparisons and buying guides | Choosing between alternatives | Options, criteria, differences, price context, tradeoffs, recommendations by use case |
| Travel and destination guides | Visit planning, itineraries, logistics | Places, routes, transport, costs, timing, bookings, seasonality, tips |
| Personal vlogs and life updates | Personal experiences and reflection | Events, context, chronology, decisions, emotions, attributed reflections |
| Gaming guides and walkthroughs | Strategies, missions, builds, puzzles | Game/version, objective, prerequisites, build, steps, decisions, spoiler labels |
| Sports matches and competitions | Matches, highlights, races, recaps | Participants, event/date, result, turning points, performances, statistics, consequences |
| Business and product announcements | Launches, updates, roadmaps, earnings | Announcements, availability, prices, specifications, commitments, dates, current versus planned |
| Fiction and scripted storytelling | Films, episodes, animation, narrative sketches | Setting, characters, motivations, plot, conflict, turns, ending, explicit spoiler labels |
| Live performances | Music, comedy, theatre, dance, spoken word | Performer, act type, segment order, themes, moments, audience interaction, supported performance details |

All summaries preserve consequential numbers and units, attribution, and uncertainty. Missing details stay missing, including visual, musical, and code details absent from captions. Non-educational content can return no learning outcomes.

Existing profiles with the exact untouched six-category starter set plus Other upgrade when settings are loaded. Any edited, removed, or added category preserves the existing set. Saved results and in-flight job configurations retain their original categories; the changed category set invalidates cache compatibility until regeneration.

## Providers and data flow

OpenAI is the default classifier, using the existing API key and model. It adds one structured classification request before summarization. Its probabilities and confidence are model-generated estimates; they have not been established as calibrated.

Selecting Jev requires a separate TypeSafe key. One request to `POST https://api.typesafe.ai/v1/systemone` asks one Choice and three Score questions. The model is pinned to `jev-1.13.0`. If only Other remains, the Choice is omitted. The TypeSafe API key is only sent in that service's authorization header; the OpenAI key remains exclusive to OpenAI.

Both classifiers receive a bounded transcript state plus title and channel when available. Up to 18,000 transcript characters are sent in full; longer transcripts use eight equally spaced character windows covering the beginning, middle, and end. Sampling can miss a format change. The summary and section-analysis stages still receive all transcript text. Sampled classification is identified in the saved metadata and result UI.

Each category also selects a goal-based summary format that sets the Markdown layout; see [Summary formats](summary-formats.md). Category definitions are used only for classification. The chosen category's summary instructions guide both short-video summaries and long-video section notes and final synthesis. Guidance explicitly asks the model to preserve substantive material outside the primary format as well. The final content-type schema is narrowed to the actual chosen category name, allowing custom categories.

## Independent scores

Three fixed, descriptive rubrics each have levels indexed 0–2:

| Dimension | 0 | 1 | 2 |
| --- | --- | --- | --- |
| Assumed prior knowledge | Defines foundations | Assumes working familiarity | Assumes specialist knowledge |
| Content density | Mostly promotion/repetition/digression | Some distinct substance | Sustained distinct substance |
| Instruction specificity | No instructions or general principles | Concrete recommendations | Executable steps and conditions |

These are qualitative whole-video estimates from the supplied text, not measurements or percentages. This first version does not compute a density score for every section. No-instruction content is not penalized as low quality, and entertainment density is not equated with educational value.

Knowledge is judged independently of the viewer and never changes the category. A future viewer profile can adapt explanations and recommendations while retaining the same purpose classification. Confident specialist knowledge prompts preservation of technical distinctions; low density prompts condensation of repetition; specific instructions prompt preservation of steps and conditions, including in interviews and reviews.

The UI shows qualitative labels rather than fractional scores. Uncertain knowledge and density appear as unclear; uncertain specificity is omitted. TypeSafe returns a probability-weighted mean for a Score. Incoming distributions, score consistency, and selected category membership are checked before use.

## Uncertainty, persistence, and validation

The provisional category and score confidence threshold is 0.5. This is a configurable code constant, not an empirically validated accuracy guarantee. Uncertain category selection uses Other. A failed classifier request does not prevent summarization; cancellation does prevent further work. The UI identifies uncertain or unavailable classification.

Jobs snapshot category definitions, prompt instructions, provider selection, and routing version with generation preferences. These enter cache compatibility checks; editing categories or changing provider causes an existing result to be marked as using different preferences until regenerated. Saved results retain the chosen category ID/name, provider/model, scores, confidence, sampling status, and fallback reason. Renaming or deleting a category does not rewrite old results. API keys are excluded from configuration snapshots and history exports/imports.

Automated checks cover category management and form persistence, custom-category routing, both provider paths, long-video prompt propagation, fallback and cancellation, cache invalidation, and history sanitization. They use mocked provider responses. Live Jev/OpenAI requests, threshold calibration, multilingual accuracy, and browser layout remain unverified.

Official references: [API](https://docs.typesafe.ai/api), [Models](https://docs.typesafe.ai/models), [Choice](https://docs.typesafe.ai/primitives/choice), [Score](https://docs.typesafe.ai/primitives/score), [Confidence](https://docs.typesafe.ai/confidence).
