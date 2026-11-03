// Personal choices are stored separately from the source summary.
export async function createRecipePreferences(storage, videoId, recipe) {
  const bytes = new TextEncoder().encode(JSON.stringify([recipe.ingredients, recipe.steps.map(step => step.instruction)]));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const version = Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('');
  const personalKey = `recipeUI:${videoId}:personal`;
  const progressKey = `recipeUI:${videoId}:progress:${version}`;
  const loaded = await storage.get({[personalKey]: {}, [progressKey]: {}});
  const personal = loaded[personalKey] || {}, progress = loaded[progressKey] || {};
  let snapshot = {
    rating: Number.isInteger(personal.rating) && personal.rating >= 0 && personal.rating <= 5 ? personal.rating : 0,
    difficulty: ['easy', 'medium', 'hard'].includes(personal.difficulty) ? personal.difficulty : null,
    ingredients: Array.isArray(progress.ingredients) ? progress.ingredients.filter(i => Number.isInteger(i) && i >= 0 && i < recipe.ingredients.length) : [],
    steps: Array.isArray(progress.steps) ? progress.steps.filter(i => Number.isInteger(i) && i >= 0 && i < recipe.steps.length) : [],
    saving: false, error: '',
  };
  const listeners = new Set();
  let queue = Promise.resolve(), revision = 0;
  const notify = () => listeners.forEach(listener => listener());
  function update(patch) {
    const currentRevision = ++revision;
    snapshot = {...snapshot, ...patch, saving: true, error: ''}; notify();
    const data = {
      [personalKey]: {rating: snapshot.rating, difficulty: snapshot.difficulty},
      [progressKey]: {ingredients: snapshot.ingredients, steps: snapshot.steps},
    };
    queue = queue.then(() => storage.set(data)).then(() => {
      if (currentRevision === revision) { snapshot = {...snapshot, saving: false}; notify(); }
    }).catch(() => {
      if (currentRevision === revision) { snapshot = {...snapshot, saving: false, error: 'Could not save. Your changes remain in this tab.'}; notify(); }
    });
    return queue;
  }
  return {getSnapshot: () => snapshot, subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); }, update};
}
