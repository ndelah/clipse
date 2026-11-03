import test from 'node:test';
import assert from 'node:assert/strict';
import {RECIPE_SCHEMA, attachRecipeEvidence, normalizeRecipe} from '../extension/recipe.js';
import {DEFAULT_CATEGORIES} from '../extension/categories.js';
import {normalizeSummary} from '../extension/shared.js';
import {recipeSample} from '../experiments/summary-ui/recipe-sample.js';
import {createRecipePreferences} from '../experiments/summary-ui/recipe-state.js';
import {scriptContext, event, run, summary, storage, VIDEO_A, VIDEO_B} from './helpers.mjs';

const recipe = () => structuredClone(recipeSample.preview.recipe);

test('recipe history preserves exact facts, null omissions, and safe fields only', () => {
  const input = summary(); input.preview.recipe = {...recipe(), apiKey: 'must-not-survive'};
  input.preview.recipe.ingredients[0].href = 'javascript:bad';
  const clean = normalizeSummary(input);
  assert.equal(clean.preview.recipe.ingredients[0].quantity, '1 × 400 g can');
  assert.equal(clean.preview.recipe.total_time, null);
  assert.equal(clean.preview.recipe.difficulty, null);
  assert.ok(!JSON.stringify(clean).includes('must-not-survive'));
  assert.ok(!JSON.stringify(clean).includes('javascript:'));
  assert.deepEqual(normalizeSummary(JSON.parse(JSON.stringify(clean))), clean);
  assert.ok(normalizeSummary(summary()));
  input.preview.recipe.ingredients[0].quantity = 42;
  assert.equal(normalizeSummary(input), null);
});

test('recipe timestamps come from original caption IDs and invalid IDs stay unavailable', () => {
  const input = recipe();
  input.steps[0].source_segment_id = 'S0'; input.steps[0].timestamp_seconds = 999;
  input.steps[1].source_segment_id = 'S88'; input.steps[1].timestamp_seconds = 123;
  const output = attachRecipeEvidence(input, [{startSeconds: 12.8, text: 'Warm the oil.'}]);
  assert.equal(output.steps[0].timestamp_seconds, 12);
  assert.equal(output.steps[1].timestamp_seconds, null);
  assert.equal(output.steps[2].timestamp_seconds, null);
});

for (const long of [false, true]) test(`recipe extraction uses the structured schema and source-only guidance (${long ? 'long' : 'short'} video)`, async () => {
  const requests = [];
  const context = scriptContext('offscreen.js', {chrome: {runtime: {onMessage: event(), async sendMessage() { return {ok: true, job: {status: 'running'}}; }}}, window: {addEventListener() {}},
    async fetch(_url, options) {
      const body = JSON.parse(options.body); requests.push(body);
      const response = body.text.format.name === 'video_classification' ? {category: {type: 'choice', choice: 'recipes', confidence: 1, probabilities: Object.fromEntries(DEFAULT_CATEGORIES.map(category => [category.id, category.id === 'recipes' ? 1 : 0]))}} : {one_sentence_summary: 'Chickpeas', recipe: {...recipe(), steps: [{instruction: 'Warm the oil.', source_segment_id: 'S0'}]}};
      return {ok: true, async json() { return {output_text: JSON.stringify(response)}; }};
    }});
  const segments = Array.from({length: long ? 30 : 1}, (_, i) => ({startSeconds: i * 60, text: long ? 'Chickpeas and garlic. '.repeat(90) : 'Warm the oil.'}));
  context.input = {segments};
  const result = await run(context, `createPreview(input, {apiKey:'test', classifierProvider:'openai'}, async()=>{}, '${VIDEO_A}')`);
  assert.equal(result.classification.categoryId, 'recipes');
  const final = requests.at(-1);
  assert.deepEqual(final.text.format.schema.properties.recipe, RECIPE_SCHEMA);
  assert.ok(final.text.format.schema.required.includes('recipe'));
  assert.match(final.instructions, /never estimate, calculate total time, infer difficulty/);
  assert.match(final.instructions, /Recipe completeness takes priority/);
  assert.equal(result.recipe.steps[0].timestamp_seconds, 0);
  if (long) {
    assert.ok(requests.length > 2);
    assert.ok(requests.slice(1, -1).every(body => body.instructions.includes('all these recipe facts')));
  }
});

test('personal choices persist per video, rapid edits stay ordered, and progress resets when the recipe changes', async () => {
  const local = storage(), input = recipe();
  const store = await createRecipePreferences(local, VIDEO_A, input);
  const rating = store.update({rating: 4});
  const difficulty = store.update({difficulty: 'hard'});
  const progress = store.update({ingredients: [0, 2], steps: [1]});
  await Promise.all([rating, difficulty, progress]);
  const reloaded = await createRecipePreferences(local, VIDEO_A, input);
  assert.equal(reloaded.getSnapshot().rating, 4);
  assert.equal(reloaded.getSnapshot().difficulty, 'hard');
  assert.deepEqual(reloaded.getSnapshot().ingredients, [0, 2]);
  assert.deepEqual(reloaded.getSnapshot().steps, [1]);
  assert.equal((await createRecipePreferences(local, VIDEO_B, input)).getSnapshot().rating, 0);
  input.steps[0].instruction = 'A regenerated instruction.';
  const regenerated = await createRecipePreferences(local, VIDEO_A, input);
  assert.deepEqual(regenerated.getSnapshot().steps, []);
  assert.deepEqual(regenerated.getSnapshot().ingredients, []);
  assert.equal(regenerated.getSnapshot().rating, 4);
  await regenerated.update({rating: 0, difficulty: null});
  assert.equal(regenerated.getSnapshot().rating, 0);
  assert.equal(recipe().difficulty, null);
});

test('saving failures are visible, and retry persists retained choices', async () => {
  const local = storage(); let fail = true;
  const write = local.set.bind(local);
  local.set = async patch => { if (fail) throw new Error('Quota'); await write(patch); };
  const store = await createRecipePreferences(local, VIDEO_A, recipe());
  await store.update({rating: 5});
  assert.match(store.getSnapshot().error, /Could not save/);
  assert.equal(store.getSnapshot().rating, 5);
  fail = false; await store.update({});
  assert.equal(store.getSnapshot().error, '');
  assert.equal((await createRecipePreferences(local, VIDEO_A, recipe())).getSnapshot().rating, 5);
});
