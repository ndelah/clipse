// Shared structured-output contract. Kept dependency-free for the extension worker.
const nullableText = {type: ['string', 'null']};
const object = properties => ({type: 'object', additionalProperties: false, properties, required: Object.keys(properties)});
export const RECIPE_SCHEMA = object({
  title: {type: 'string'}, description: {type: 'string'},
  prep_time: nullableText, cook_time: nullableText, total_time: nullableText, servings: nullableText,
  difficulty: {type: ['string', 'null'], enum: ['easy', 'medium', 'hard', null]},
  ingredients: {type: 'array', items: object({name: {type: 'string'}, quantity: nullableText})},
  steps: {type: 'array', items: object({instruction: {type: 'string'}, source_segment_id: nullableText})},
  cooks_notes: {type: 'array', items: {type: 'string'}},
  missing_information: {type: 'array', items: {type: 'string'}},
});
export const RECIPE_GUIDANCE = `Also extract one structured recipe card for someone actively cooking. Use only information explicitly stated in the captions. If multiple dishes are covered, choose the main dish and do not combine separate recipes. Preserve exact quantities, units, temperatures, ingredient preparation, ordered instructions, doneness cues, and resting times. Use null for unstated time, servings, quantities, or difficulty; never estimate, calculate total time, infer difficulty from classification, or add steps from general cooking knowledge. Difficulty must be explicitly described as easy, medium, or hard to populate it. Only include cook's notes about techniques, substitutions, or common mistakes actually mentioned. Missing information may flag a quantity or timing absent for an ingredient or step described in the captions, or uncertainty explicitly acknowledged; do not propose missing ingredients or techniques. Use empty arrays when there are no notes or relevant omissions. Each step's source_segment_id must refer to an original supplied caption segment; use null when unavailable. Recipe completeness takes priority over summary brevity. Intermediate notes must preserve all these recipe facts and their original segment IDs.`;

// Reuse this for both model output and imported history; discard unknown properties.
export function normalizeRecipe(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const text = v => typeof v === 'string' && v.length <= 12000;
  const nullable = v => v === null || text(v);
  if (!text(value.title) || !value.title.trim() || !text(value.description)) return null;
  if (!['prep_time', 'cook_time', 'total_time', 'servings'].every(key => nullable(value[key]))) return null;
  if (![null, 'easy', 'medium', 'hard'].includes(value.difficulty)) return null;
  if (!Array.isArray(value.ingredients) || value.ingredients.length > 200 || !value.ingredients.every(item => item && text(item.name) && item.name.trim() && nullable(item.quantity))) return null;
  if (!Array.isArray(value.steps) || value.steps.length > 200 || !value.steps.every(item => item && text(item.instruction) && item.instruction.trim())) return null;
  if (!['cooks_notes', 'missing_information'].every(key => Array.isArray(value[key]) && value[key].length <= 100 && value[key].every(text))) return null;
  return {
    title: value.title, description: value.description,
    ...Object.fromEntries(['prep_time', 'cook_time', 'total_time', 'servings'].map(key => [key, value[key]?.trim() || null])),
    difficulty: value.difficulty,
    ingredients: value.ingredients.map(item => ({name: item.name, quantity: item.quantity?.trim() || null})),
    steps: value.steps.map(item => ({instruction: item.instruction, timestamp_seconds: Number.isInteger(item.timestamp_seconds) && item.timestamp_seconds >= 0 ? item.timestamp_seconds : null})),
    cooks_notes: value.cooks_notes.filter(item => item.trim()), missing_information: value.missing_information.filter(item => item.trim()),
  };
}

export function attachRecipeEvidence(value, segments) {
  if (!value || !Array.isArray(value.steps)) return null;
  return normalizeRecipe({...value, steps: value.steps.map(step => {
    const match = /^S(\d+)$/.exec(step.source_segment_id || '');
    const segment = match ? segments[Number(match[1])] : null;
    return {...step, timestamp_seconds: segment && Number.isFinite(segment.startSeconds) && segment.startSeconds >= 0 ? Math.floor(segment.startSeconds) : null};
  })});
}
