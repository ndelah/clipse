import {MAX_CATEGORIES, normalizeCategories, validateCategories} from "./categories.js";

const editors = new WeakMap();

export function loadCategoryEditor(elements, categories) {
  const draft = normalizeCategories(categories);
  const render = focusId => {
    elements.categoryList.replaceChildren();
    for (const category of draft) {
      const details = document.createElement("details");
      details.className = "category-editor";
      details.open = category.id === focusId;
      const heading = document.createElement("summary");
      heading.textContent = category.name;
      details.appendChild(heading);
      for (const [key, title, limit] of [["name", "Name", 80], ["description", "What belongs here", 1200], ["instructions", "What the summary should preserve", 2400]]) {
        const label = document.createElement("label");
        label.textContent = title;
        const input = document.createElement(key === "name" ? "input" : "textarea");
        input.value = category[key]; input.maxLength = limit; input.required = true;
        if (key !== "name") input.rows = 4;
        input.addEventListener("input", () => {
          category[key] = input.value;
          if (key === "name") heading.textContent = input.value || "Unnamed category";
        });
        label.appendChild(input); details.appendChild(label);
      }
      if (category.id !== "other") {
        const remove = document.createElement("button");
        remove.type = "button"; remove.className = "text-button danger-text"; remove.textContent = "Remove category";
        remove.addEventListener("click", () => { draft.splice(draft.indexOf(category), 1); render(); });
        details.appendChild(remove);
      } else {
        const note = document.createElement("p"); note.className = "muted small";
        note.textContent = "Fallback for mixed, uncertain, or unmatched videos. This category is always kept.";
        details.appendChild(note);
      }
      elements.categoryList.appendChild(details);
      if (category.id === focusId) details.querySelector("input")?.focus();
    }
    elements.addCategoryButton.disabled = draft.length >= MAX_CATEGORIES;
  };
  const editor = {read: () => validateCategories(draft), add() {
    if (draft.length >= MAX_CATEGORIES) return;
    const category = {id: `custom_${crypto.randomUUID().replaceAll("-", "")}`, name: "New category", description: "", instructions: ""};
    draft.splice(draft.length - 1, 0, category); render(category.id);
  }};
  editors.set(elements.categoryList, editor);
  render();
}

export function readCategoryEditor(elements) { return editors.get(elements.categoryList).read(); }
export function wireCategoryEditor(elements) {
  elements.addCategoryButton.addEventListener("click", () => editors.get(elements.categoryList)?.add());
}
