// Standalone interactive sample for local review, without extension APIs or an AI call.
import React from 'react';
import {createRoot} from 'react-dom/client';
import {Renderer, StateProvider, VisibilityProvider, ActionProvider, defineRegistry} from '@json-render/react';
import {catalog, recipePreset} from './model.js';
import {RecipeContext, recipeComponents} from './recipe-card.jsx';
import {recipeSample} from './recipe-sample.js';
import {createRecipePreferences} from './recipe-state.js';
const storage = {
  async get(defaults) { return Object.fromEntries(Object.entries(defaults).map(([key, value]) => { try { return [key, JSON.parse(localStorage.getItem(key)) || value]; } catch { return [key, value]; } })); },
  async set(patch) { for (const [key, value] of Object.entries(patch)) localStorage.setItem(key, JSON.stringify(value)); },
};
async function start() {
  const store = await createRecipePreferences(storage, recipeSample.videoId, recipeSample.preview.recipe);
  const {registry} = defineRegistry(catalog, {components: recipeComponents});
  createRoot(document.getElementById('app')).render(<main style={{maxWidth: 780, paddingTop: 32}}><RecipeContext.Provider value={{recipe: recipeSample.preview.recipe, summary: recipeSample, store}}><StateProvider initialState={{}}><VisibilityProvider><ActionProvider handlers={{}}><Renderer spec={recipePreset()} registry={registry}/></ActionProvider></VisibilityProvider></StateProvider></RecipeContext.Provider></main>);
}
start().catch(error => { document.getElementById('app').textContent = `Could not load preview: ${error.message}`; });
