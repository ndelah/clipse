import {loadSettingsForm, wireSettingsForm} from "./settings-form.js";
const elements = Object.fromEntries([...document.querySelectorAll("[id]")].map(element => [element.id, element]));
wireSettingsForm(elements);
loadSettingsForm(elements).catch(error => { elements.settingsStatus.textContent = error.message; });
