// Summary formats are chosen by the viewer's goal, not the video's topic. Each category points at one format.
// The model fills a format's fields, leaving unsupported ones null or empty; a Knap template renders only the filled fields.
// Only key takeaways carry timestamps; the formatted summary body has none.

const text = description => ({type: ["string", "null"], ...(description ? {description} : {})});
const list = (items, description) => ({type: "array", items, ...(description ? {description} : {})});
const strings = description => list({type: "string"}, description);
const object = properties => ({type: "object", additionalProperties: false, properties, required: Object.keys(properties)});
const labeled = description => list(object({label: {type: "string"}, value: {type: "string"}}), description);

const FORMAT_LIST = [
  {id: "follow_along", name: "Follow-along", goal: "Do this myself while the video is closed",
    fields: {
      key_facts: labeled("Facts stated in the source such as servings, prep/cook time, difficulty, duration, or game version."),
      needs_heading: text("Heading for what is needed, named for the domain: Ingredients, Tools & materials, Equipment, or Loadout & prerequisites."),
      needs: list(object({item: {type: "string"}, quantity: text("Exact quantity as stated, or null.")}), "Each thing needed."),
      phases: list(object({name: text("Phase name; null when the procedure has a single phase."),
        steps: list(object({action: {type: "string", description: "Short action name."}, details: text("Exact quantities, temperatures, times, and settings."),
          tip: text("A doneness cue, warning, or check stated for this step.")}))}), "Ordered steps, grouped into phases only for long procedures."),
      workout: list(object({exercise: {type: "string"}, sets_reps: text("Sets × reps or time."), rest: text(null), form_cue: text(null)}), "Workouts only: exercises in order, instead of steps."),
      tips: strings("Tips and variations."),
      aftercare_heading: text("Heading such as Storage, Cleanup, or Aftercare."),
      aftercare: strings(null)
    },
    template: `{% if key_facts %}
{{ key_facts | facts }}
{% endif %}

{% if needs %}
## {% if needs_heading %}{{ needs_heading | line }}{% else %}What you need{% endif %}

{% for need in needs %}
- [ ] {{ need.quantity | suffix:" " }}{{ need.item | line }}
{% endfor %}
{% endif %}

{% if phases %}
## Steps

{% for phase in phases %}
{% if phase.name %}
### {{ phase.name | line }}

{% endif %}
{% for step in phase.steps %}
{{ loop.index }}. **{{ step.action | line }}.**{{ step.details | prefix:" " }}
{% if step.tip %}
   > Tip: {{ step.tip | line }}
{% endif %}
{% endfor %}

{% endfor %}
{% endif %}

{% if workout %}
## Workout

| Exercise | Sets × reps / time | Rest | Form cue |
| --- | --- | --- | --- |
{% for row in workout %}
| {{ row.exercise | cell }} | {{ row.sets_reps | cell }} | {{ row.rest | cell }} | {{ row.form_cue | cell }} |
{% endfor %}
{% endif %}

{% if tips %}
## Tips & variations

{% for tip in tips %}
- {{ tip | line }}
{% endfor %}
{% endif %}

{% if aftercare %}
## {% if aftercare_heading %}{{ aftercare_heading | line }}{% else %}Storage & aftercare{% endif %}

{% for item in aftercare %}
- {{ item | line }}
{% endfor %}
{% endif %}`},
  {id: "article", name: "Article", goal: "Learn to do this by reading before trying",
    fields: {
      outcome: text("Two or three sentences: the end result and why it is useful."),
      prerequisites: strings("Prerequisites, tools, accounts, and versions."),
      phases: list(object({title: {type: "string"}, explanation: text("Short explanatory prose."),
        code: list(object({language: text("Language tag such as bash or js."), content: {type: "string"}}), "Exact commands, code, or settings shown.")}), "Phases in order."),
      pitfalls: list(object({problem: {type: "string"}, fix: text(null)}), "Errors shown or warned about."),
      wrap_up: text("What the viewer now has."),
      next_steps: strings("Next steps the speaker suggests.")
    },
    template: `{% if outcome %}
## What you'll build

{{ outcome }}
{% endif %}

{% if prerequisites %}
## Before you start

{% for item in prerequisites %}
- {{ item | line }}
{% endfor %}
{% endif %}

{% for phase in phases %}
## {{ loop.index }}. {{ phase.title | line }}

{% if phase.explanation %}
{{ phase.explanation }}
{% endif %}

{% for block in phase.code %}
\`\`\`{{ block.language | line }}
{{ block.content }}
\`\`\`

{% endfor %}
{% endfor %}

{% if pitfalls %}
## Common pitfalls

{% for pitfall in pitfalls %}
- **{{ pitfall.problem | line }}**{{ pitfall.fix | prefix:" " }}
{% endfor %}
{% endif %}

{% if wrap_up or next_steps %}
## Wrapping up

{% if wrap_up %}
{{ wrap_up }}

{% endif %}
{% for step in next_steps %}
- {{ step | line }}
{% endfor %}
{% endif %}`},
  {id: "explainer", name: "Explainer", goal: "Understand an idea",
    fields: {
      big_idea: text("One paragraph stating the central idea plainly."),
      research_question: text("Research presentations only: the question studied."),
      method: text("Research presentations only: sample and method."),
      concepts: list(object({term: {type: "string"}, definition: {type: "string", description: "The speaker's own definition."}}), "Key terms."),
      sections: list(object({heading: {type: "string"}, body: {type: "string"}}), "How it works: ideas that build on each other in the source's order."),
      findings: list(object({finding: {type: "string", description: "Bold the key numbers."}}), "Research presentations only."),
      example: text("The worked example from the video, step by step."),
      misconceptions: strings("Misconceptions the speaker corrects."),
      caveats: strings("Limitations stated in the source."),
      why_it_matters: text(null)
    },
    template: `{% if big_idea %}
## The big idea

{{ big_idea }}
{% endif %}

{% if research_question %}
## The question

{{ research_question }}
{% endif %}

{% if method %}
## How they studied it

{{ method }}
{% endif %}

{% if concepts %}
## Key concepts

{% for concept in concepts %}
- **{{ concept.term | line }}**: {{ concept.definition | line }}
{% endfor %}
{% endif %}

{% if sections %}
## How it works

{% for section in sections %}
### {{ section.heading | line }}

{{ section.body }}

{% endfor %}
{% endif %}

{% if findings %}
## What they found

{% for item in findings %}
- {{ item.finding | line }}
{% endfor %}
{% endif %}

{% if example %}
## Example

{{ example }}
{% endif %}

{% if misconceptions %}
## Common misconceptions

{% for item in misconceptions %}
- {{ item | line }}
{% endfor %}
{% endif %}

{% if caveats %}
## Caveats

{% for item in caveats %}
- {{ item | line }}
{% endfor %}
{% endif %}

{% if why_it_matters %}
## Why it matters

{{ why_it_matters }}
{% endif %}`},
  {id: "verdict", name: "Verdict", goal: "Decide what to buy or choose",
    fields: {
      verdict: text("The reviewer's conclusion in one sentence."),
      best_for: text(null), skip_if: text(null),
      pros: strings(null), cons: strings(null),
      testing: text("Conditions, duration, and setup the reviewer describes."),
      options: list(object({option: {type: "string"}, price: text(null), strength: text(null), weakness: text(null), best_for: text(null)}), "Only when several options are compared."),
      specs: labeled("Specifications stated in the source."),
      price: text("Price with its time context (\"at the time of the video\").")
    },
    template: `{% if verdict or best_for or skip_if %}
## Verdict

{% if verdict %}
{{ verdict }}

{% endif %}
{% if best_for %}
- **Best for:** {{ best_for | line }}
{% endif %}
{% if skip_if %}
- **Skip if:** {{ skip_if | line }}
{% endif %}
{% endif %}

{% if pros or cons %}
## Pros and cons

{% if pros %}
**Pros**

{% for item in pros %}
- {{ item | line }}
{% endfor %}

{% endif %}
{% if cons %}
**Cons**

{% for item in cons %}
- {{ item | line }}
{% endfor %}
{% endif %}
{% endif %}

{% if testing %}
## How it was tested

{{ testing }}
{% endif %}

{% if options %}
## Comparison

| Option | Price | Strength | Weakness | Best for |
| --- | --- | --- | --- | --- |
{% for row in options %}
| **{{ row.option | cell }}** | {{ row.price | cell }} | {{ row.strength | cell }} | {{ row.weakness | cell }} | {{ row.best_for | cell }} |
{% endfor %}
{% endif %}

{% if specs or price %}
## Specs and price

{% for spec in specs %}
- **{{ spec.label | line }}:** {{ spec.value | line }}
{% endfor %}
{% if price %}
- **Price:** {{ price | line }}
{% endif %}
{% endif %}`},
  {id: "briefing", name: "Briefing", goal: "Know what happened or what's new",
    fields: {
      result: text("Sports only: the final result."),
      what_happened: text("One paragraph covering who, what, when, and where."),
      key_facts: list(object({fact: {type: "string", description: "Bold the consequential numbers."}}), null),
      announcements: list(object({announcement: {type: "string"}, availability: text(null), price: text(null)}), "Announcements only: what was announced."),
      timeline: list(object({when: {type: "string"}, event: {type: "string"}}), "Only when sequence matters."),
      turning_points: list(object({moment: {type: "string"}}), "Sports only."),
      standouts: strings("Sports only: standout performances."),
      confirmed: strings("Facts the source presents as confirmed, when it distinguishes them."),
      disputed: strings("Claims the source presents as unconfirmed or disputed."),
      whats_next: strings(null)
    },
    template: `{% if result %}
**{{ result | line }}**
{% endif %}

{% if what_happened %}
## What happened

{{ what_happened }}
{% endif %}

{% if key_facts %}
## Key facts

{% for item in key_facts %}
- {{ item.fact | line }}
{% endfor %}
{% endif %}

{% if announcements %}
## Announcements

| Announcement | Availability | Price |
| --- | --- | --- |
{% for row in announcements %}
| **{{ row.announcement | cell }}** | {{ row.availability | cell }} | {{ row.price | cell }} |
{% endfor %}
{% endif %}

{% if timeline %}
## Timeline

{% for item in timeline %}
- **{{ item.when | line }}**: {{ item.event | line }}
{% endfor %}
{% endif %}

{% if turning_points %}
## Turning points

{% for item in turning_points %}
- {{ item.moment | line }}
{% endfor %}
{% endif %}

{% if standouts %}
## Standout performances

{% for item in standouts %}
- {{ item | line }}
{% endfor %}
{% endif %}

{% if confirmed or disputed %}
## Confirmed vs. disputed

{% for item in confirmed %}
- **Confirmed:** {{ item | line }}
{% endfor %}
{% for item in disputed %}
- **Disputed:** {{ item | line }}
{% endfor %}
{% endif %}

{% if whats_next %}
## What's next

{% for item in whats_next %}
- {{ item | line }}
{% endfor %}
{% endif %}`},
  {id: "argument", name: "Argument", goal: "Weigh a position",
    fields: {
      thesis: text("The central claim in one sentence, attributed to the creator."),
      arguments: list(object({claim: {type: "string"}, reasoning: text("Supporting reasoning and the evidence cited.")}), "The argument chain in order."),
      debate_question: text("Debates and panels only: the question debated."),
      positions: list(object({speaker: {type: "string"}, position: {type: "string"}, strongest_point: text(null)}), "Debates and panels only."),
      agreements: strings("Debates only: where the speakers agree."),
      counterpoints: strings("Counterpoints raised in the source."),
      assumptions: strings("Assumptions the argument relies on."),
      unresolved: strings("Debates only: still unresolved.")
    },
    template: `{% if thesis %}
## Thesis

{{ thesis }}
{% endif %}

{% if debate_question %}
## The question

{{ debate_question }}
{% endif %}

{% if arguments %}
## The argument

{% for item in arguments %}
{{ loop.index }}. **{{ item.claim | line }}**{{ item.reasoning | prefix:" " }}
{% endfor %}
{% endif %}

{% if positions %}
## Positions

| Speaker | Position | Strongest point |
| --- | --- | --- |
{% for row in positions %}
| **{{ row.speaker | cell }}** | {{ row.position | cell }} | {{ row.strongest_point | cell }} |
{% endfor %}
{% endif %}

{% if agreements %}
## Where they agree

{% for item in agreements %}
- {{ item | line }}
{% endfor %}
{% endif %}

{% if counterpoints %}
## Counterpoints raised

{% for item in counterpoints %}
- {{ item | line }}
{% endfor %}
{% endif %}

{% if assumptions %}
## Assumptions to notice

{% for item in assumptions %}
- {{ item | line }}
{% endfor %}
{% endif %}

{% if unresolved %}
## Still unresolved

{% for item in unresolved %}
- {{ item | line }}
{% endfor %}
{% endif %}`},
  {id: "conversation", name: "Conversation", goal: "Keep what was said that's worth remembering",
    fields: {
      guest: text("Guest name and who they are, only when stated."),
      host: text("Host name, only when stated."),
      themes: list(object({heading: {type: "string"},
        points: list(object({speaker: text(null), point: {type: "string"}}), null),
        quotes: list(object({quote: {type: "string", description: "Short and verbatim from the captions."}, speaker: text(null)}), "Only memorable quotes.")}),
        "One per substantive theme, in order."),
      recommendations: strings("Books, tools, people, and resources named in the conversation.")
    },
    template: `{% if guest %}
- **Guest:** {{ guest | line }}
{% endif %}
{% if host %}
- **Host:** {{ host | line }}
{% endif %}

{% for theme in themes %}
## {{ theme.heading | line }}

{% for item in theme.points %}
- {{ item.speaker | label }}{{ item.point | line }}
{% endfor %}

{% for item in theme.quotes %}
> "{{ item.quote | line }}"{{ item.speaker | prefix:" — " }}

{% endfor %}
{% endfor %}

{% if recommendations %}
## Recommendations mentioned

{% for item in recommendations %}
- {{ item | line }}
{% endfor %}
{% endif %}`},
  {id: "story", name: "Story", goal: "Get the story without watching it all",
    fields: {
      premise: text(null),
      people: list(object({name: {type: "string"}, role: {type: "string"}}), "Key people and their role in the story."),
      beats: list(object({beat: {type: "string"}, details: text("What happens and why it matters.")}), "How it unfolds, in order."),
      set_list: list(object({item: {type: "string"}}), "Live performances only: the ordered segments or songs."),
      ending: text("How it ends, only when the source shows it."),
      themes: strings("Themes and reflections.")
    },
    template: `{% if premise %}
## Premise

{{ premise }}
{% endif %}

{% if people %}
## Key people

{% for person in people %}
- **{{ person.name | line }}**: {{ person.role | line }}
{% endfor %}
{% endif %}

{% if beats %}
## How it unfolds

{% for item in beats %}
{{ loop.index }}. **{{ item.beat | line }}**{{ item.details | prefix:" " }}
{% endfor %}
{% endif %}

{% if set_list %}
## Set list

{% for item in set_list %}
{{ loop.index }}. {{ item.item | line }}
{% endfor %}
{% endif %}

{% if ending %}
## Ending

:::spoiler Show the ending
{{ ending }}
:::
{% endif %}

{% if themes %}
## Themes and reflections

{% for item in themes %}
- {{ item | line }}
{% endfor %}
{% endif %}`},
  {id: "trip_plan", name: "Trip plan", goal: "Plan a visit",
    fields: {
      at_a_glance: labeled("Days needed, budget, best season, only when stated."),
      days: list(object({title: {type: "string", description: "Such as \"Day 1 — Old town\"."},
        stops: list(object({place: {type: "string"}, details: text("What to do, timing, and booking notes.")}), null)}), "Itinerary by day."),
      getting_around: strings(null),
      costs: list(object({item: {type: "string"}, cost: {type: "string"}, notes: text(null)}), null),
      tips: strings("Local tips.")
    },
    template: `{% if at_a_glance %}
**At a glance** · {{ at_a_glance | facts }}
{% endif %}

{% if days %}
## Itinerary

{% for day in days %}
### {{ day.title | line }}

{% for stop in day.stops %}
- **{{ stop.place | line }}**{{ stop.details | prefix:": " }}
{% endfor %}

{% endfor %}
{% endif %}

{% if getting_around %}
## Getting around

{% for item in getting_around %}
- {{ item | line }}
{% endfor %}
{% endif %}

{% if costs %}
## Costs

| Item | Cost | Notes |
| --- | --- | --- |
{% for row in costs %}
| {{ row.item | cell }} | {{ row.cost | cell }} | {{ row.notes | cell }} |
{% endfor %}
{% endif %}

{% if tips %}
## Local tips

{% for item in tips %}
- {{ item | line }}
{% endfor %}
{% endif %}`},
  {id: "general", name: "General", goal: "Get the substance in a clear structure",
    fields: {
      overview: text("One paragraph on what the video covers and why it matters."),
      points: list(object({heading: {type: "string"}, body: {type: "string", description: "A short paragraph."}}), "Main points in the source's order.")
    },
    template: `{% if overview %}
## Overview

{{ overview }}
{% endif %}

{% if points %}
## Main points

{% for point in points %}
### {{ point.heading | line }}

{{ point.body }}

{% endfor %}
{% endif %}`}
];

export const SUMMARY_FORMATS = Object.freeze(Object.fromEntries(FORMAT_LIST.map(format => [format.id, Object.freeze(format)])));
export const FORMAT_IDS = Object.freeze(FORMAT_LIST.map(format => format.id));
export const FALLBACK_FORMAT = "general";

// Default format for each built-in category. Custom categories choose their own and otherwise use General.
export const CATEGORY_FORMATS = Object.freeze({
  recipes: "follow_along", diy_repairs: "follow_along", fitness: "follow_along", gaming: "follow_along",
  software_tutorials: "article",
  lessons: "explainer", research: "explainer",
  product_reviews: "verdict", comparisons: "verdict",
  news: "briefing", announcements: "briefing", sports: "briefing",
  opinion: "argument", debates: "argument",
  interviews: "conversation",
  documentaries: "story", vlogs: "story", fiction: "story", performances: "story",
  travel: "trip_plan",
  // Legacy starter categories.
  tutorial: "article", explainer: "explainer", review_comparison: "verdict", interview_discussion: "conversation",
  documentary_narrative: "story", entertainment: "story",
  other: FALLBACK_FORMAT
});

export function categoryFormat(category) {
  if (FORMAT_IDS.includes(category?.format)) return category.format;
  return CATEGORY_FORMATS[category?.id] || FALLBACK_FORMAT;
}

const formatOf = formatId => SUMMARY_FORMATS[formatId] || SUMMARY_FORMATS[FALLBACK_FORMAT];

// Structured-output schema for the format's fields. Strict mode requires every key, so absence is null or [].
export function formatSchema(formatId) {
  return {...object(formatOf(formatId).fields), description: "The summary's content. Fill only what the source supports."};
}

export function formatGuidance(formatId) {
  const format = formatOf(formatId);
  return `Summary format: ${format.name} — the viewer's goal is to ${format.goal.toLowerCase()}.
Fill summary_fields with the content of the standalone summary. The fields are a menu, not a checklist: a template renders only the fields you fill.
- Fill a field only when the source clearly supports it. Otherwise use null for text and [] for lists. Never pad, generalize, or invent content to fill a field.
- Fields marked for a variant (workouts, research, sports, announcements, debates, live performances) apply only to that kind of video.
- Write plain prose without headings or list markers; the template adds structure. **Bold** for key terms and numbers, *italic*, and \`inline code\` are allowed. No HTML, images, or links.
- Do not write segment IDs or clock times; timestamps belong only in key takeaways.`;
}
