import test, {before} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {Renderer, ActionProvider, StateProvider, VisibilityProvider, defineRegistry} from '@json-render/react';
import {recipePreset, validateLayout, catalog} from '../experiments/summary-ui/model.js';
import {recipeSample} from '../experiments/summary-ui/recipe-sample.js';

let RecipeContext, registry;
before(async () => {
  await build({entryPoints: ['experiments/summary-ui/recipe-card.jsx'], outfile: 'dist/summary-ui-tests/recipe-card.mjs', bundle: true, platform: 'node', format: 'esm', packages: 'external'});
  const components = await import('../dist/summary-ui-tests/recipe-card.mjs');
  RecipeContext = components.RecipeContext;
  registry = defineRegistry(catalog, {components: components.recipeComponents}).registry;
});
function render(summary = recipeSample, overrides = {}) {
  const snapshot = {rating: 0, difficulty: null, ingredients: [], steps: [], saving: false, error: '', ...overrides};
  const store = {subscribe() { return () => {}; }, getSnapshot: () => snapshot, update() {}};
  const spec = validateLayout(recipePreset());
  return renderToStaticMarkup(React.createElement(RecipeContext.Provider, {value: {recipe: summary.preview.recipe, summary, store}},
    React.createElement(StateProvider, {initialState: {}}, React.createElement(VisibilityProvider, null,
      React.createElement(ActionProvider, {handlers: {}}, React.createElement(Renderer, {spec, registry}))))));
}

test('recipe spec renders all fields and accessible personal controls through the real renderer', () => {
  const html = render();
  for (const text of ['Lemon chickpeas on toast', '5 minutes', '10 minutes', 'Not specified', 'Ingredients', 'Method', 'Cook’s notes', 'Missing information', 'Illustrative recipe']) assert.ok(html.includes(text), text);
  assert.equal((html.match(/type="checkbox"/g) || []).length, 9);
  assert.equal((html.match(/aria-label="Rate /g) || []).length, 5);
  assert.match(html, /<select/);
  assert.doesNotMatch(html, /href="https:\/\/www.youtube/);
});
test('personal state is rendered without rewriting source difficulty or recipe information', () => {
  const html = render(recipeSample, {rating: 4, difficulty: 'hard', ingredients: [0], steps: [1]});
  assert.match(html, /value="hard" selected/);
  assert.match(html, /4 of 5/);
  assert.equal((html.match(/ checked=""/g) || []).length, 2);
  assert.equal(recipeSample.preview.recipe.difficulty, null);
});
test('empty optional sections stay hidden, caption-linked steps stay bound to the video, and text is escaped', () => {
  const summary = structuredClone(recipeSample);
  summary.sample = false; summary.videoId = 'abcdefghijk';
  summary.preview.recipe.cooks_notes = []; summary.preview.recipe.missing_information = [];
  summary.preview.recipe.title = '<script>alert(1)</script>';
  summary.preview.recipe.steps[0].timestamp_seconds = 42;
  const html = render(summary);
  assert.doesNotMatch(html, /Cook’s notes|Missing information|<script>/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /watch\?v=abcdefghijk&amp;t=42s/);
  assert.match(html, /Watch step 1 at 00:42/);
});
