import React, {createContext, useContext, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Renderer, ActionProvider, StateProvider, VisibilityProvider, defineRegistry} from '@json-render/react';
import {catalog, preset, recipePreset, validateLayout} from './model.js';
import {summaryParagraphs} from '../../extension/shared.js';
import {normalizeRecipe} from '../../extension/recipe.js';
import {RecipeContext, recipeComponents} from './recipe-card.jsx';
import {createRecipePreferences} from './recipe-state.js';
import {recipeSample} from './recipe-sample.js';

const summarySample = {sample: true, title: 'Learning with small experiments', preview: {one_sentence_summary: 'Small experiments help you learn through quick feedback.', key_takeaways: [{text: 'Choose one question to explore.'}, {text: 'Try it, observe the result, then adjust.'}], full_summary: 'A small experiment makes an abstract idea concrete. Change one thing at a time and compare the results.'}};
const SummaryContext = createContext(null);
const section = (title, body) => <section className="card"><h2>{title}</h2>{body}</section>;
const {registry} = defineRegistry(catalog, {components: {
  ...recipeComponents,
  Stack: ({children}) => <div className="stack">{children}</div>,
  Overview: ({props}) => { const summary = useContext(SummaryContext); return section(props.title, <p>{summary.preview?.one_sentence_summary}</p>); },
  Takeaways: ({props}) => { const summary = useContext(SummaryContext); return section(props.title, <ul>{(summary.preview?.key_takeaways || []).map((item, i) => <li key={i}>{item.text}</li>)}</ul>); },
  Detail: ({props}) => { const summary = useContext(SummaryContext); return section(props.title, summaryParagraphs(summary.preview?.full_summary).map((text, i) => <p key={i}>{text}</p>)); },
}});

function App({summary, recipe, store, saved, layoutKey}) {
  const [spec, setSpec] = useState(saved || (recipe ? recipePreset() : preset()));
  const [draft, setDraft] = useState(JSON.stringify(spec, null, 2));
  const [status, setStatus] = useState('');
  function choose(next) { setDraft(JSON.stringify(next, null, 2)); setSpec(next); setStatus('Preview updated. Save to reuse this layout.'); }
  async function apply(save) {
    try {
      if (draft.length > 50000) throw new Error('Keep layout JSON under 50,000 characters.');
      const next = validateLayout(JSON.parse(draft));
      if (!recipe && Object.values(next.elements).some(element => element.type in recipeComponents)) throw new Error('This summary has no structured recipe data. Open the recipe sample to try these components.');
      if (save) await chrome.storage.local.set({[layoutKey]: next});
      setSpec(next); setStatus(save ? 'Layout saved for this type of summary.' : 'Preview updated.');
    } catch (error) { setStatus(`Could not apply layout: ${error.message}`); }
  }
  return <main className={recipe ? 'recipe-studio' : ''}>
    <header className="studio-header"><a className="studio-brand" href="summary-lab.html">◒ <span>Clipse</span></a><span className="studio-divider">/</span><span>Summary studio</span><a className="sample-link" href="summary-lab.html?demo=recipe">Try a recipe sample ↗</a></header>
    <div className="studio-intro"><p className="eyebrow">{recipe ? 'A little less watching. A little more cooking.' : 'Make it yours'}</p><h1>{recipe ? 'Your recipe, ready to cook.' : 'Customize summary view'}</h1><p>{recipe ? 'Check off ingredients, follow each step, and make a note of how it went.' : 'Arrange your saved content with JSON. No AI request is made.'}</p></div>
    {!recipe && summary.preview?.classification?.categoryId === 'recipes' && <p className="recipe-upgrade">This older summary has no structured recipe data. New summaries classified as recipes include a recipe card. You can regenerate it from the regular reader.</p>}
    <div className="columns"><div className="rendered-preview"><SummaryContext.Provider value={summary}><RecipeContext.Provider value={recipe ? {recipe, summary, store} : null}><StateProvider initialState={{}}><VisibilityProvider><ActionProvider handlers={{}}><Renderer spec={spec} registry={registry}/></ActionProvider></VisibilityProvider></StateProvider></RecipeContext.Provider></SummaryContext.Provider></div>
    <aside className="layout-editor"><details open={!recipe}><summary>Customize this layout <span aria-hidden="true">＋</span></summary><div className="editor-body"><p>Change a heading or reorder the IDs in <code>children</code>, then preview.</p><div className="buttons">{recipe ? <button onClick={() => choose(recipePreset())}>Reset recipe layout</button> : <><button onClick={() => choose(preset())}>Reading</button><button onClick={() => choose(preset(true))}>Quick scan</button></>}</div><label htmlFor="spec">Layout JSON</label><textarea id="spec" value={draft} onChange={e => setDraft(e.target.value)} spellCheck={false}/><div className="buttons"><button onClick={() => apply(false)}>Preview</button><button onClick={() => apply(true)}>Save layout</button></div><p role="status">{status}</p></div></details><div className="studio-note"><h2>{recipe ? 'Only what the video tells us.' : 'How this works'}</h2><p>{recipe ? 'Unstated quantities and times stay unspecified. Notes appear only when mentioned. Your rating and difficulty are personal choices.' : 'The catalog defines available components. The spec arranges them. The registry supplies their React implementation; Renderer assembles the view.'}</p>{recipe && <p>Based on captions. Details shown only on screen may be missing.</p>}<details><summary>The json-render pieces</summary><p><strong>Catalog:</strong> the available recipe components and their props.</p><p><strong>Spec:</strong> the editable JSON arranging those components.</p><p><strong>Registry:</strong> the checklists, stars, and other React components.</p><p><strong>Renderer:</strong> assembles the card from the spec. Personal choices are saved separately from recipe content.</p></details></div></aside></div>
  </main>;
}

async function start() {
  const data = await chrome.storage.local.get({summaries: {}, summaryUiLayoutV1: null, summaryUiRecipeLayoutV1: null});
  const params = new URLSearchParams(location.search), id = params.get('video');
  const summary = params.get('demo') === 'recipe' ? recipeSample : id ? data.summaries[id] : summarySample;
  if (!summary) throw new Error('This saved summary is no longer available. Open another summary from Clipse.');
  const recipe = normalizeRecipe(summary.preview?.recipe);
  const layoutKey = recipe ? 'summaryUiRecipeLayoutV1' : 'summaryUiLayoutV1';
  let saved;
  try {
    if (data[layoutKey]) saved = validateLayout(data[layoutKey]);
    if (!recipe && saved && Object.values(saved.elements).some(element => element.type in recipeComponents)) saved = undefined;
  } catch { /* Recover from an obsolete or invalid saved layout. */ }
  const store = recipe ? await createRecipePreferences(chrome.storage.local, summary.videoId, recipe) : null;
  document.title = recipe ? `${recipe.title} · Clipse` : 'Summary studio · Clipse';
  createRoot(document.getElementById('app')).render(<App summary={summary} recipe={recipe} store={store} saved={saved} layoutKey={layoutKey}/>);
}
start().catch(error => { document.getElementById('app').textContent = `Could not open summary: ${error.message}`; });
