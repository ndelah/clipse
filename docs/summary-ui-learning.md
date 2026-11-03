# Learn json-render through summary layouts

Reload the unpacked Clipse extension, open a saved summary, and click **Customize view**. The lab opens in a tab. It uses the real `@json-render/core` and `@json-render/react` packages, bundled locally for Chrome's extension policy.

1. Choose **Quick scan**. The same saved summary now has two sections.
2. Change `At a glance` in the JSON to `The main idea`, then click **Preview**.
3. Reverse `overview` and `takeaways` in the root's `children` list. Preview again: the order follows the JSON.
4. Try `"type": "Unknown"`. Preview rejects it and keeps the previous view.
5. Click **Save layout**, then open another summary's lab. The layout is reused with that summary's content. Choose **Reading** and save to restore the initial layout.

## Follow the code

- `experiments/summary-ui/model.js`: **catalog**, the allowed component vocabulary and prop schemas; **spec presets**, the flat tree of IDs; validation of this lab's restricted spec subset.
- `experiments/summary-ui/app.jsx`: **registry**, actual React implementations for each catalog type; **Renderer**, which walks the spec inside state and visibility providers.
- `scripts/build-summary-ui.mjs`: bundles dependencies into `extension/summary-lab.js`. Run `npm run build:summary-ui` after editing source; `npm run check` and packaging also rebuild it.

The data path is: saved summary → registry components. The layout path is: JSON → validation → Renderer → registry. Content stays separate from layout. React escapes summary text. Only our components can render; there are no generated scripts, HTML, URLs, or actions.

This first exercise uses hand-authored JSON, not AI generation. The normal summary reader stays as it is; a saved layout applies to the lab only. The next lesson can add a prompt such as “show takeaways first,” send the catalog's generated prompt to a model, and validate its returned spec through the same boundary. No extra AI SDK is required for this local rendering step.

Reference: https://json-render.dev/docs and https://json-render.dev/docs/registry

## Recipe card

New summaries classified under the built-in **Recipes and cooking** category also extract a structured `preview.recipe`. Open **Open recipe card** from the saved summary. Older recipe summaries need explicit regeneration to acquire the structured data; opening the card never makes an AI request.

To try it without generating a summary, choose **Try a recipe sample** in the studio. It is labeled as illustrative content. Ingredients and steps are checkable. Difficulty is a personal Easy/Medium/Hard choice; an explicitly stated source difficulty is shown until you override it. Clicking a star sets a personal rating, and Clear removes it.

Source quantities, units, and time descriptions stay exact. Unstated facts stay null and display as unspecified. There is no serving scaling or computed total time. Notes appear only if extracted; missing-information flags describe relevant omissions without filling them in. Step timestamps resolve from original caption segment IDs, never model-supplied times.

The recipe spec has these catalog types: `RecipeCard`, `RecipeHeader`, `RecipeFacts`, `RecipeControls`, `DifficultyPicker`, `StarRating`, `IngredientChecklist`, `CookingSteps`, `CooksNotes`, `MissingInformation`. Expand **Customize this layout** to rename section headings or reorder them. Recipe and general-summary layouts are saved independently.

- `extension/recipe.js`: shared structured-output schema, source-only extraction guidance, normalization, caption timestamp resolution.
- `experiments/summary-ui/recipe-card.jsx`: actual component registry implementations.
- `experiments/summary-ui/recipe-state.js`: local personal preferences, separate from the summary and its source facts. Checkmarks reset when ingredients or instruction text changes; ratings and difficulty remain associated with the video. Personal preferences are not included in history JSON backups.

Validation covers mocked short/long extraction, recipe history round trips, source timestamp resolution, persistence, save failures, and server rendering through the real json-render renderer. These checks do not establish live model extraction quality or live browser interaction behavior.
