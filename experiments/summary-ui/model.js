import {defineCatalog} from '@json-render/core';
import {schema} from '@json-render/react/schema';
import {z} from 'zod';

// The catalog is the vocabulary that a future AI layout generator may use.
export const catalog = defineCatalog(schema, {
  components: {
    RecipeCard: {props: z.object({}), slots: ['default'], description: 'A recipe card for active cooking.'},
    RecipeHeader: {props: z.object({}), description: 'Recipe title, description, and source.'},
    RecipeFacts: {props: z.object({}), description: 'Stated preparation time, cooking time, total time, and servings.'},
    RecipeControls: {props: z.object({}), slots: ['default'], description: 'Personal cooking controls.'},
    DifficultyPicker: {props: z.object({}), description: 'Personal difficulty selection; never changes source data.'},
    StarRating: {props: z.object({}), description: 'Personal rating from one to five stars.'},
    IngredientChecklist: {props: z.object({title: z.string().max(100)}), description: 'Checkable ingredients with exact quantities.'},
    CookingSteps: {props: z.object({title: z.string().max(100)}), description: 'Checkable steps with verified caption timestamps.'},
    CooksNotes: {props: z.object({title: z.string().max(100)}), description: 'Only notes explicitly mentioned; hidden if empty.'},
    MissingInformation: {props: z.object({title: z.string().max(100)}), description: 'Relevant missing quantities and times; hidden if empty.'},
    Stack: {props: z.object({}), slots: ['default'], description: 'A vertical group of summary sections.'},
    Overview: {props: z.object({title: z.string().max(100)}), description: 'The saved one-sentence summary.'},
    Takeaways: {props: z.object({title: z.string().max(100)}), description: 'The saved key takeaways.'},
    Detail: {props: z.object({title: z.string().max(100)}), description: 'The saved full summary.'},
  },
  actions: {},
});

export function preset(compact = false) {
  return {root: 'summary', elements: {
    summary: {type: 'Stack', props: {}, children: compact ? ['overview', 'takeaways'] : ['overview', 'takeaways', 'detail']},
    overview: {type: 'Overview', props: {title: 'At a glance'}},
    takeaways: {type: 'Takeaways', props: {title: 'Key takeaways'}},
    ...(!compact && {detail: {type: 'Detail', props: {title: 'Full summary'}}}),
  }};
}

// Restrict this learning lab to a small, acyclic tree and catalog props.
// Arbitrary HTML, actions, and JavaScript are deliberately outside its vocabulary.
export function validateLayout(value) {
  const node = z.object({type: z.enum(Object.keys(catalog.data.components)), props: z.record(z.string(), z.unknown()), children: z.array(z.string()).max(12).optional()}).strict();
  const spec = z.object({root: z.string(), elements: z.record(z.string(), node)}).strict().parse(value);
  if (Object.keys(spec.elements).length > 12) throw new Error('Use at most 12 elements.');
  const visited = new Set();
  function visit(id, depth) {
    if (depth > 5 || visited.has(id)) throw new Error('Use a tree without cycles or repeated elements (maximum depth 5).');
    const element = spec.elements[id];
    if (!element) throw new Error(`Missing element: ${id}`);
    visited.add(id);
    catalog.data.components[element.type].props.strict().parse(element.props);
    if (!['Stack', 'RecipeCard', 'RecipeControls'].includes(element.type) && element.children?.length) throw new Error('Only container components can contain children.');
    for (const child of element.children || []) visit(child, depth + 1);
  }
  visit(spec.root, 0);
  if (visited.size !== Object.keys(spec.elements).length) throw new Error('Remove unused elements.');
  return spec;
}

export function recipePreset() {
  return {root: 'recipe', elements: {
    recipe: {type: 'RecipeCard', props: {}, children: ['header', 'facts', 'controls', 'ingredients', 'steps', 'notes', 'missing']},
    header: {type: 'RecipeHeader', props: {}},
    facts: {type: 'RecipeFacts', props: {}},
    controls: {type: 'RecipeControls', props: {}, children: ['difficulty', 'rating']},
    difficulty: {type: 'DifficultyPicker', props: {}},
    rating: {type: 'StarRating', props: {}},
    ingredients: {type: 'IngredientChecklist', props: {title: 'Ingredients'}},
    steps: {type: 'CookingSteps', props: {title: 'Method'}},
    notes: {type: 'CooksNotes', props: {title: "Cook’s notes"}},
    missing: {type: 'MissingInformation', props: {title: 'Missing information'}},
  }};
}
