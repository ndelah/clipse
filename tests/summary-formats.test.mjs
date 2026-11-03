import test from "node:test";
import assert from "node:assert/strict";
import {Element, event, scriptContext, run, summary, VIDEO_A} from "./helpers.mjs";
import {DEFAULT_CATEGORIES, normalizeCategories, validateCategories} from "../extension/categories.js";
import {CATEGORY_FORMATS, FORMAT_IDS, SUMMARY_FORMATS, categoryFormat, formatGuidance, formatSchema} from "../extension/formats.js";
import {renderFormat} from "../extension/format-render.js";
import {exportableMarkdown, parseMarkdown, renderMarkdown, stripCitations} from "../extension/markdown.js";
import {normalizeSummary, summaryMarkdown} from "../extension/shared.js";

const doc = {createElement: tag => new Element(tag)};
const text = node => node.children.length ? node.children.map(text).join("") : node.textContent;
const find = (node, tag) => node.tagName === tag ? node : node.children.map(child => find(child, tag)).find(Boolean);

test("every starter category maps to a goal-based format, and custom categories default to General", () => {
  assert.ok(DEFAULT_CATEGORIES.every(category => FORMAT_IDS.includes(category.format)));
  const formatOf = id => DEFAULT_CATEGORIES.find(category => category.id === id).format;
  assert.deepEqual(["recipes", "diy_repairs", "fitness", "gaming"].map(formatOf), Array(4).fill("follow_along"));
  assert.equal(formatOf("software_tutorials"), "article");
  assert.equal(formatOf("product_reviews"), "verdict");
  assert.equal(formatOf("interviews"), "conversation");
  assert.equal(formatOf("travel"), "trip_plan");
  assert.equal(formatOf("other"), "general");
  assert.equal(categoryFormat({id: "custom_x"}), "general");
  assert.equal(categoryFormat({id: "recipes", format: "nonsense"}), CATEGORY_FORMATS.recipes);
  const custom = {id: "custom_x", name: "Lectures", description: "University lectures", instructions: "Keep definitions.", format: "explainer"};
  const saved = validateCategories([custom, normalizeCategories([])[0]]);
  assert.equal(saved[0].format, "explainer");
  assert.match(formatGuidance("follow_along"), /Summary format: Follow-along/);
  assert.match(formatGuidance("unknown"), /Summary format: General/);
  assert.deepEqual(Object.keys(formatSchema("unknown").properties), ["overview", "points"]);
});

// Strict structured output requires every key and no extras at every level, so "absent" must be expressible as null or [].
function assertStrict(schema, path) {
  assert.ok(!("description" in schema) || typeof schema.description === "string", path);
  if (schema.type === "object") {
    assert.equal(schema.additionalProperties, false, path);
    assert.deepEqual(schema.required, Object.keys(schema.properties), path);
    for (const [key, value] of Object.entries(schema.properties)) {
      assert.ok(value.type === "array" || [].concat(value.type).includes("null") || value.type === "string" && path.includes("[]"), `${path}.${key} must be optional`);
      assertStrict(value, `${path}.${key}`);
    }
  }
  if (schema.type === "array") assertStrict(schema.items, `${path}[]`);
}

test("every format is a strict schema whose fields can all be left empty, which renders nothing", async () => {
  for (const id of FORMAT_IDS) {
    assertStrict(formatSchema(id), id);
    const empty = Object.fromEntries(Object.entries(SUMMARY_FORMATS[id].fields).map(([key, value]) => [key, value.type === "array" ? [] : null]));
    assert.equal(await renderFormat(id, empty), "", id);
  }
  assert.equal(await renderFormat("general", undefined), "");
});

test("templates render only the fields the model filled", async () => {
  const recipe = await renderFormat("follow_along", {key_facts: [{label: "Serves", value: "4"}], needs_heading: "Ingredients", needs: [{item: "flour", quantity: "200 g"}, {item: "salt", quantity: null}],
    phases: [{name: null, steps: [{action: "Mix", details: "Stir for\n2 minutes.", tip: null}, {action: "Bake", details: null, tip: "Golden on top."}]}],
    workout: [], tips: [], aftercare_heading: "Storage", aftercare: []});
  assert.equal(recipe, [
    "**Serves:** 4", "", "## Ingredients", "", "- [ ] 200 g flour", "- [ ] salt", "", "## Steps", "",
    "1. **Mix.** Stir for 2 minutes.", "2. **Bake.**", "   > Tip: Golden on top."
  ].join("\n"));
  const review = await renderFormat("verdict", {verdict: null, best_for: "Travel", skip_if: null, pros: ["Light"], cons: [], testing: null,
    options: [{option: "A | B", price: null, strength: "Fast", weakness: null, best_for: null}], specs: [], price: null});
  assert.equal(review, [
    "## Verdict", "", "- **Best for:** Travel", "", "## Pros and cons", "", "**Pros**", "", "- Light", "", "## Comparison", "",
    "| Option | Price | Strength | Weakness | Best for |", "| --- | --- | --- | --- | --- |", "| **A \\| B** | — | Fast | — | — |"
  ].join("\n"));
  const interview = await renderFormat("conversation", {guest: null, host: "Sam", themes: [{heading: "Work", points: [{speaker: null, point: "Ship small."}],
    quotes: [{quote: "Done beats perfect.", speaker: "Ana"}]}], recommendations: []});
  assert.equal(interview, ["- **Host:** Sam", "", "## Work", "", "- Ship small.", "", '> "Done beats perfect." — Ana'].join("\n"));
});

test("a recipe classification asks for Follow-along fields, renders them without timestamps", async () => {
  const bodies = [];
  const categories = [DEFAULT_CATEGORIES[0], DEFAULT_CATEGORIES.at(-1)];
  const replies = [
    {category: {type: "choice", choice: "recipes", confidence: 1, probabilities: {recipes: 1, other: 0}}},
    {one_sentence_summary: "Bread", summary_fields: {key_facts: [], needs_heading: "Ingredients", needs: [{item: "flour", quantity: "200 g"}],
      phases: [{name: null, steps: [{action: "Mix", details: "Stir. [[S1]]", tip: null}, {action: "Bake", details: "[[t:5]]", tip: null}]}],
      workout: [], tips: [], aftercare_heading: null, aftercare: []},
      key_takeaways: [], recipe: {title: "Bread", description: "", prep_time: null, cook_time: null, total_time: null, servings: null, difficulty: null,
        ingredients: [{name: "flour", quantity: "200 g"}], steps: [{instruction: "Mix", source_segment_id: "S1"}], cooks_notes: [], missing_information: []}}
  ];
  const context = scriptContext("offscreen.js", {chrome: {runtime: {onMessage: event(), async sendMessage() { return {ok: true, job: {status: "running"}}; }}}, window: {addEventListener() {}},
    async fetch(_url, options) { bodies.push(JSON.parse(options.body)); const reply = replies.shift(); return {ok: true, async json() { return {output_text: JSON.stringify(reply)}; }}; }});
  context.settings = {apiKey: "test", model: "gpt-4.1-mini", categories};
  const preview = await run(context, `createPreview({segments:[{startSeconds:0,text:'Hi'},{startSeconds:75.6,text:'Mix'}],isGenerated:false}, settings, async()=>{}, '${VIDEO_A}')`);
  assert.match(bodies[1].instructions, /Summary format: Follow-along/);
  assert.ok("phases" in bodies[1].text.format.schema.properties.summary_fields.properties);
  assert.equal(preview.format, "follow_along");
  assert.equal(preview.summary_fields, undefined);
  assert.match(preview.full_summary, /^## Ingredients\n\n- \[ \] 200 g flour\n\n## Steps/);
  assert.doesNotMatch(preview.full_summary, /Tips|What you need/);
  assert.ok(!("segment" in bodies[1].text.format.schema.properties.summary_fields.properties.phases.items.properties.steps.items.properties));
  assert.match(preview.full_summary, /1\. \*\*Mix\.\*\* Stir\.\n2\. \*\*Bake\.\*\*$/);
  assert.doesNotMatch(preview.full_summary, /\[\[/);
});

test("the Markdown subset renders structure without HTML or links", () => {
  const nodes = renderMarkdown([
    "## Steps", "1. **Mix** the *dough*.", "   > Tip: it should be sticky.", "2. Bake", "",
    "- [ ] 200 g flour", "- [x] salt", "", "| Option | Price |", "| --- | --- |", "| A | $5 |", "",
    "```bash", "npm install", "```", "", ":::spoiler Ending", "They win.", ":::", "",
    "<script>alert(1)</script> and [a link](https://example.com)"
  ].join("\n"), doc);
  assert.deepEqual(nodes.map(node => node.tagName), ["h3", "ol", "ul", "div", "pre", "details", "p"]);
  const steps = nodes[1];
  assert.equal(steps.children.length, 2);
  assert.equal(find(steps.children[0], "strong").children.map(text).join(""), "Mix");
  assert.ok(find(steps.children[0], "blockquote"));
  assert.equal(find(nodes[2].children[1], "input").checked, true);
  assert.equal(text(find(nodes[3], "tbody")), "A$5");
  assert.equal(find(nodes[4], "code").textContent, "npm install");
  assert.equal(text(nodes[6]), "<script>alert(1)</script> and a link");
  assert.ok(!JSON.stringify(nodes.map(text)).includes("https://"));
});

test("lists keep numbering, nesting, and lazy continuation", () => {
  const [list] = parseMarkdown("3. First\n   - nested\n4. Second\ncontinued");
  assert.equal(list.start, 3);
  assert.equal(list.items.length, 2);
  assert.equal(list.items[0].children[1].type, "list");
  assert.equal(list.items[1].children[0].text, "Second continued");
});

test("formatted summaries survive history import and export as portable Markdown", () => {
  const record = summary(VIDEO_A, {});
  record.preview = {...record.preview, format: "verdict", full_summary: "## Verdict\nGood. [[t:61]]\n\n:::spoiler More\nx\n:::"};
  const clean = normalizeSummary(record);
  assert.equal(clean.preview.format, "verdict");
  assert.equal(normalizeSummary({...record, preview: {...record.preview, format: "bogus"}}).preview.format, undefined);
  const markdown = summaryMarkdown(clean);
  assert.equal(clean.preview.full_summary, "## Verdict\nGood.\n\n:::spoiler More\nx\n:::");
  assert.match(markdown, /## Verdict\nGood\.\n/);
  assert.match(markdown, /<details><summary>More<\/summary>/);
  assert.doesNotMatch(markdown, /## Summary/);
  assert.equal(stripCitations("a [[S0, S1]] b [[t:9]]"), "a b");
});
