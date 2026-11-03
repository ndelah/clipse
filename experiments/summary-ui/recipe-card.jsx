import React, {createContext, useContext, useSyncExternalStore} from 'react';
import {timestamp, videoUrl} from '../../extension/shared.js';

export const RecipeContext = createContext(null);
const useRecipe = () => useContext(RecipeContext);
function RecipeCard({children}) {
  const {store, summary} = useRecipe();
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return <article className="recipe-card" aria-label="Recipe card">
    {summary.sample && <p className="recipe-sample">Illustrative recipe · not extracted from a video</p>}
    {children}
    <p className={`recipe-save-status ${state.error ? 'save-error' : ''}`} role="status">{state.error || (state.saving ? 'Saving…' : 'Your rating, difficulty, and progress are saved on this device.')}{state.error && <button type="button" onClick={() => store.update({})}>Retry save</button>}</p>
  </article>;
}
function RecipeHeader() {
  const {recipe, summary} = useRecipe();
  return <header className="recipe-header"><p className="eyebrow">From video to kitchen</p><h2>{recipe.title}</h2><p className="recipe-description">{recipe.description}</p>{!summary.sample && <a className="recipe-source" href={videoUrl(summary.videoId)} target="_blank" rel="noreferrer">Open source video ↗</a>}</header>;
}
function RecipeFacts() {
  const {recipe} = useRecipe();
  return <dl className="recipe-facts">{[['Prep', recipe.prep_time], ['Cook', recipe.cook_time], ['Total', recipe.total_time], ['Servings', recipe.servings]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || 'Not specified'}</dd></div>)}</dl>;
}
function DifficultyPicker() {
  const {store, recipe} = useRecipe();
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return <label className="difficulty-control"><span className="control-label">Difficulty</span><select value={state.difficulty || ''} onChange={event => store.update({difficulty: event.target.value || null})}><option value="">{recipe.difficulty ? `From video: ${recipe.difficulty}` : 'Not specified'}</option><option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option></select><small>{state.difficulty ? 'Your choice' : recipe.difficulty ? 'Stated in the video' : 'Choose your own'}</small></label>;
}
function StarRating() {
  const {store} = useRecipe();
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return <div className="rating-control"><span className="control-label">Your rating</span><div className="stars" role="group" aria-label="Your recipe rating">{[1, 2, 3, 4, 5].map(star => <button key={star} type="button" className={star <= state.rating ? 'star filled' : 'star'} aria-label={`Rate ${star} ${star === 1 ? 'star' : 'stars'}`} aria-pressed={state.rating === star} onClick={() => store.update({rating: star})}><span aria-hidden="true">{star <= state.rating ? '★' : '☆'}</span></button>)}</div><div className="rating-caption"><small>{state.rating ? `${state.rating} of 5` : 'Not rated'}</small>{state.rating > 0 && <button type="button" className="text-control" onClick={() => store.update({rating: 0})}>Clear</button>}</div></div>;
}
function Checklist({kind, title}) {
  const {recipe, store, summary} = useRecipe();
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const items = recipe[kind], selected = state[kind];
  return <section className="recipe-section"><div className="recipe-section-heading"><h3>{title}</h3><span>{selected.length} / {items.length}</span></div>{!items.length ? <p className="recipe-empty">{kind === 'ingredients' ? 'Ingredients were not specified.' : 'No cooking steps were stated.'}</p> : <ul className={`recipe-checklist ${kind}`}>{items.map((item, index) => <li key={index} className={selected.includes(index) ? 'is-done' : ''}><label><input type="checkbox" checked={selected.includes(index)} onChange={() => store.update({[kind]: selected.includes(index) ? selected.filter(i => i !== index) : [...selected, index]})}/><span className="check-content">{kind === 'ingredients' ? <><span className="ingredient-name">{item.name}</span><span className="ingredient-quantity">{item.quantity || 'Quantity not specified'}</span></> : <><span className="step-number">Step {index + 1}</span><span>{item.instruction}</span></>}</span></label>{kind === 'steps' && !summary.sample && item.timestamp_seconds !== null && <a className="step-time" href={videoUrl(summary.videoId, item.timestamp_seconds)} target="_blank" rel="noreferrer" aria-label={`Watch step ${index + 1} at ${timestamp(item.timestamp_seconds)}`}>↗ {timestamp(item.timestamp_seconds)}</a>}</li>)}</ul>}</section>;
}
function Notes({kind, title}) {
  const {recipe} = useRecipe();
  if (!recipe[kind].length) return null;
  return <section className={`recipe-notes ${kind}`}><h3>{title}</h3><ul>{recipe[kind].map((note, index) => <li key={index}>{note}</li>)}</ul></section>;
}
export const recipeComponents = {
  RecipeCard,
  RecipeHeader,
  RecipeFacts,
  RecipeControls: ({children}) => <div className="recipe-controls">{children}</div>,
  DifficultyPicker,
  StarRating,
  IngredientChecklist: ({props}) => <Checklist kind="ingredients" title={props.title}/>,
  CookingSteps: ({props}) => <Checklist kind="steps" title={props.title}/>,
  CooksNotes: ({props}) => <Notes kind="cooks_notes" title={props.title}/>,
  MissingInformation: ({props}) => <Notes kind="missing_information" title={props.title}/>,
};
