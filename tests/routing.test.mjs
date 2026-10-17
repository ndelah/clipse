import test from "node:test";
import assert from "node:assert/strict";
import {DEFAULT_CATEGORIES, LEGACY_CATEGORIES, normalizeCategories, validateCategories} from "../extension/categories.js";
import {classificationText, classificationQuestions, normalizeClassification, routingInstructions} from "../extension/routing.js";
import {loadSettings, summaryConfiguration, sameConfiguration, normalizeSummary} from "../extension/shared.js";
import {event, storage, scriptContext, run, summary, VIDEO_A} from "./helpers.mjs";

const score = (index, confidence = 1) => ({type: "score", score: index, confidence,
  probabilities: {"0": index === 0 ? 1 : 0, "1": index === 1 ? 1 : 0, "2": index === 2 ? 1 : 0}});
const answers = (id = "software_tutorials", confidence = 1, categories = DEFAULT_CATEGORIES) => ({
  category: {type: "choice", choice: id, confidence, probabilities: Object.fromEntries(categories.map(category => [category.id, category.id === id ? 1 : 0]))},
  prior_knowledge: score(2), content_density: score(0), instruction_specificity: score(2)
});

test("starter categories and custom definitions preserve a mandatory catch-all", () => {
  assert.deepEqual(DEFAULT_CATEGORIES.map(category => category.id), ["recipes", "diy_repairs", "software_tutorials", "fitness", "lessons", "research", "news", "opinion", "interviews", "debates", "documentaries", "product_reviews", "comparisons", "travel", "vlogs", "gaming", "sports", "announcements", "fiction", "performances", "other"]);
  const custom = {id: "recipes", name: "Recipes", description: "Cooking instructions", instructions: "Retain quantities and cooking conditions."};
  const list = normalizeCategories([custom]);
  assert.equal(list.length, 2);
  assert.equal(list[1].id, "other");
  assert.deepEqual(validateCategories(list), list);
  assert.throws(() => validateCategories([custom]), /fallback/);
  assert.throws(() => validateCategories([...list, {...custom, id: "duplicate"}]), /different name/);
  assert.throws(() => validateCategories([{...custom, instructions: ""}, list[1]]), /Every category/);
  const questions = classificationQuestions(list);
  assert.match(questions.category.criteria.recipes, /Cooking instructions/);
  assert.equal(Object.keys(questions).length, 4);
  assert.match(questions.prior_knowledge.instructions, /independently/);
  assert.equal(classificationQuestions(normalizeCategories([])).category, undefined);
});

test("routing applies specific instructions, rejects unknown and uncertain categories, and keeps dimensions independent", () => {
  const classification = normalizeClassification(answers(), DEFAULT_CATEGORIES);
  assert.equal(classification.categoryId, "software_tutorials");
  const prompt = routingInstructions(classification, DEFAULT_CATEGORIES);
  assert.match(prompt, /ordered steps/);
  assert.match(prompt, /specialist distinctions/);
  assert.match(prompt, /Condense repetition/);
  assert.match(prompt, /independently of the viewer/);
  assert.equal(normalizeClassification(answers("missing"), DEFAULT_CATEGORIES).categoryId, "other");
  assert.equal(normalizeClassification(answers("software_tutorials", 0.2), DEFAULT_CATEGORIES).reason, "uncertain");
  const malformed = answers(); malformed.content_density.score = 2;
  assert.equal(normalizeClassification(malformed, DEFAULT_CATEGORIES).scores.content_density, undefined);
  malformed.category.probabilities.other = 1;
  assert.equal(normalizeClassification(malformed, DEFAULT_CATEGORIES).categoryId, "other");
});

test("classification samples the middle and end of long transcripts, without changing the summarization source", () => {
  const source = `START ${"a".repeat(45000)} MIDDLE ${"b".repeat(45000)} END`;
  const sampled = classificationText(source);
  assert.equal(sampled.sampled, true);
  assert.ok(sampled.text.length < 18500);
  assert.match(sampled.text, /START/);
  assert.match(sampled.text, /END/);
  assert.equal(sampled.text.match(/Excerpt/g).length, 8);
  assert.deepEqual(classificationText("Short transcript"), {text: "Short transcript", sampled: false});
});

test("category edits and classification provider invalidate cached summaries, but credentials never enter snapshots", () => {
  const original = summaryConfiguration();
  const edited = summaryConfiguration({...original, categories: original.categories.map(category => category.id === "software_tutorials" ? {...category, instructions: "Keep the complete procedure"} : category)});
  assert.equal(sameConfiguration(original, edited), false);
  assert.equal(sameConfiguration(original, {...original, classifierProvider: "jev"}), false);
  assert.ok(sameConfiguration(original, {...original, apiKey: "secret", jevApiKey: "secret"}));
  assert.equal("jevApiKey" in summaryConfiguration({jevApiKey: "private"}), false);
  const imported = normalizeSummary(summary(VIDEO_A, {preview: {...summary().preview, classification: {...normalizeClassification(answers(), DEFAULT_CATEGORIES), apiKey: "private"}}}));
  assert.equal(imported.preview.classification.categoryName, "Software tutorials");
  assert.equal(imported.preview.classification.scores.prior_knowledge.score, 2);
  assert.equal("apiKey" in imported.preview.classification, false);
});

function fixture({provider = "jev", fail = false, long = false, cancelled = false, custom = false, categoryId = "software_tutorials"} = {}) {
  const requests = [];
  const categories = custom ? normalizeCategories([{id: "recipe", name: "Recipe", description: "Cooking", instructions: "Preserve exact quantities and temperatures."}]) : DEFAULT_CATEGORIES;
  const classification = answers(custom ? "recipe" : categoryId, 1, categories);
  const chrome = {runtime: {onMessage: event(), async sendMessage() { return {ok: true, job: {status: cancelled ? "cancelled" : "running"}}; }}};
  const context = scriptContext("offscreen.js", {chrome, window: {addEventListener() {}},
    async fetch(url, options) {
      const body = JSON.parse(options.body); requests.push({url, body, headers: options.headers});
      const isClassification = url.includes("typesafe") || body.text?.format.name === "video_classification";
      if (fail && isClassification) throw new Error("Unavailable");
      return {ok: true, async json() { return url.includes("typesafe") ? {answers: classification} : {output_text: JSON.stringify(isClassification ? classification : {one_sentence_summary: "Summary", content_type: "wrong"})}; }};
    }});
  context.settings = {apiKey: "openai-private", jevApiKey: "jev-private", classifierProvider: provider, categories};
  context.transcript = {segments: Array.from({length: long ? 30 : 1}, (_, i) => ({startSeconds: i * 60, text: long ? "Source evidence ".repeat(100) : "Source evidence"}))};
  return {requests, context};
}

test("Jev receives one mixed request, and custom routing reaches section notes and final synthesis", async () => {
  const f = fixture({long: true, custom: true});
  const preview = await run(f.context, `createPreview(transcript, settings, async()=>{}, '${VIDEO_A}')`);
  assert.equal(f.requests[0].url, "https://api.typesafe.ai/v1/systemone");
  assert.equal(f.requests[0].headers.Authorization, "Bearer jev-private");
  assert.equal(f.requests[0].body.model, "jev-1.13.0");
  assert.equal(Object.keys(f.requests[0].body.questions).length, 4);
  assert.ok(!JSON.stringify(f.requests[0].body).includes("private"));
  assert.ok(f.requests.slice(1, -1).every(request => request.body.text.format.name === "video_section_notes"));
  assert.ok(f.requests.slice(1).every(request => request.body.instructions.includes("exact quantities and temperatures")));
  assert.deepEqual(JSON.parse(JSON.stringify(f.requests.at(-1).body.text.format.schema.properties.content_type.enum)), ["Recipe"]);
  assert.equal(preview.content_type, "Recipe");
  assert.equal(preview.classification.scores.prior_knowledge.score, 2);
});

test("OpenAI routing works without a TypeSafe call and failed classification still produces a catch-all summary", async () => {
  const f = fixture({provider: "openai"});
  const preview = await run(f.context, `createPreview(transcript, settings, async()=>{}, '${VIDEO_A}')`);
  assert.equal(f.requests.length, 2);
  assert.ok(f.requests.every(request => request.url.includes("openai")));
  assert.equal(preview.classification.categoryId, "software_tutorials");
  const failed = fixture({fail: true});
  const fallback = await run(failed.context, `createPreview(transcript, settings, async()=>{}, '${VIDEO_A}')`);
  assert.equal(fallback.content_type, "Other");
  assert.equal(fallback.classification.reason, "request_failed");
  assert.equal(failed.requests.at(-1).body.text.format.name, "video_preview");
});

test("cancellation during classification never falls through into summarization", async () => {
  const f = fixture({fail: true, cancelled: true});
  await assert.rejects(run(f.context, `createPreview(transcript, settings, async()=>{}, '${VIDEO_A}')`), {name: "JobCancelledError"});
  assert.equal(f.requests.length, 1);
});


test("untouched old settings upgrade once while historical configurations retain their original categories", async () => {
  const local = storage({categories: LEGACY_CATEGORIES, apiKey: "saved-key", summaryLength: "brief"});
  const savedConfiguration = summaryConfiguration({categories: LEGACY_CATEGORIES});
  const settings = await loadSettings(local);
  assert.deepEqual(settings.categories, DEFAULT_CATEGORIES);
  assert.deepEqual(local.state.categories, DEFAULT_CATEGORIES);
  assert.equal(settings.apiKey, "saved-key");
  assert.equal(settings.summaryLength, "brief");
  assert.deepEqual(savedConfiguration.categories, LEGACY_CATEGORIES);
  assert.equal(sameConfiguration(savedConfiguration, settings), false);
  local.set = () => { throw new Error("Should not write settings again"); };
  assert.deepEqual((await loadSettings(local)).categories, DEFAULT_CATEGORIES);
});

test("customized, deleted, and fallback-only category sets survive the default upgrade", async () => {
  for (const categories of [
    LEGACY_CATEGORIES.map(category => category.id === "tutorial" ? {...category, instructions: "My instructions"} : category),
    LEGACY_CATEGORIES.filter(category => category.id !== "entertainment"),
    normalizeCategories([])
  ]) {
    const local = storage({categories});
    local.set = () => { throw new Error("Custom settings must not be replaced"); };
    assert.deepEqual((await loadSettings(local)).categories, categories);
  }
});

for (const provider of ["openai", "jev"]) {
  for (const long of [false, true]) {
    test(`default recipes route preservation rules through ${provider} ${long ? "section notes and synthesis" : "single summary"}`, async () => {
      const f = fixture({provider, long, categoryId: "recipes"});
      const preview = await run(f.context, `createPreview(transcript, settings, async()=>{}, '${VIDEO_A}')`);
      const classificationRequest = f.requests[0].body;
      if (provider === "openai") {
        assert.equal(classificationRequest.text.format.schema.properties.category.properties.choice.enum.length, 21);
        assert.match(classificationRequest.input, /Preparing dishes/);
      } else {
        assert.equal(Object.keys(classificationRequest.questions.category.criteria).length, 21);
        assert.match(classificationRequest.questions.category.criteria.recipes, /Preparing dishes/);
      }
      for (const request of f.requests.slice(1)) {
        assert.match(request.body.instructions, /ingredients and quantities/);
        assert.match(request.body.instructions, /temperatures, cooking times, doneness cues/);
        assert.match(request.body.instructions, /Missing details must stay missing/);
        assert.match(request.body.instructions, /important material from other formats/);
      }
      assert.equal(preview.content_type, "Recipes and cooking");
      assert.deepEqual(Array.from(f.requests.at(-1).body.text.format.schema.properties.content_type.enum), ["Recipes and cooking"]);
    });
  }
}
