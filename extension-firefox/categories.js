import {categoryFormat, FORMAT_IDS} from "./formats.js";

export const LEGACY_CATEGORIES = Object.freeze([
  {id: "tutorial", name: "Tutorial", description: "Teaches a task through ordered actions the viewer can follow.", instructions: "Preserve prerequisites, ordered steps, configuration details, and common mistakes. Never invent missing steps or unseen demonstrations."},
  {id: "explainer", name: "Explainer", description: "Explains concepts, mechanisms, or an argument rather than teaching a sequence of actions.", instructions: "Explain the central mechanism or argument, define concepts as the speaker defines them, and retain clarifying examples and conclusions."},
  {id: "review_comparison", name: "Review / comparison", description: "Evaluates a product, service, or alternative using criteria, experiences, and tradeoffs.", instructions: "Preserve evaluation criteria, strengths, weaknesses, tradeoffs, and who each option suits. Attribute judgments and testing claims to the reviewer."},
  {id: "interview_discussion", name: "Interview / discussion", description: "Develops ideas through an interview, conversation, debate, or exchange of viewpoints.", instructions: "Organize by substantive themes. Attribute views to speakers and preserve disagreements, qualifications, and changes of position. Do not invent speaker identities."},
  {id: "documentary_narrative", name: "Documentary / narrative", description: "Tells a factual or personal story through events, causes, and consequences.", instructions: "Preserve chronology, causes, turning points, and consequences. Distinguish the narrator's interpretation from reported events."},
  {id: "entertainment", name: "Entertainment", description: "Primarily entertains through comedy, performance, or other entertainment rather than teaching or evaluating.", instructions: "Summarize the premise and notable moments. Do not force learning outcomes or invent an educational purpose; return an empty learning_outcomes array when appropriate."},
  {id: "other", name: "Other", description: "None of the categories fits, the format is mixed without a clear primary purpose, or the evidence is insufficient.", instructions: "Faithfully summarize the main substance in a structure appropriate to the source. Preserve important details without forcing a procedure, comparison, or educational purpose."}
].map(category => Object.freeze(category)));


export const DEFAULT_CATEGORIES = Object.freeze([
  {id: "recipes", name: "Recipes and cooking", description: "Preparing dishes, baking, drinks, and meal preparation. Use for cooking procedures rather than restaurant reviews or food travel.", instructions: "Preserve ingredients and quantities, servings, ordered steps, temperatures, cooking times, doneness cues, substitutions, and storage instructions. Keep units exact. Never invent missing quantities, steps, or visual cues."},
  {id: "diy_repairs", name: "DIY, crafts, and repairs", description: "Building, making, restoring, or fixing physical objects through hands-on instructions, excluding cooking and software tasks.", instructions: "Preserve tools and materials, measurements, prerequisites, ordered steps, warnings, common mistakes, and the finished result. Distinguish demonstrated results from promised results; do not infer unseen actions."},
  {id: "software_tutorials", name: "Software tutorials", description: "Coding demonstrations, app walkthroughs, configuration, and troubleshooting that teach a software task. Product evaluation belongs in reviews or comparisons.", instructions: "Preserve the intended outcome, software versions, setup, commands or code, exact settings, ordered steps, verification steps, and fixes for demonstrated errors. Never reconstruct code or interface actions missing from captions."},
  {id: "fitness", name: "Fitness and movement", description: "Workouts, yoga, stretching, and exercise technique demonstrations intended for viewers to follow or practice.", instructions: "Preserve exercise order, sets, repetitions, duration, rest periods, equipment, form cues, modifications, and cautions stated by the instructor. Do not invent a routine or movement details absent from the transcript."},
  {id: "lessons", name: "Lessons and explainers", description: "Teaching a concept, skill, theory, or historical topic. Use when explaining understanding is the primary purpose rather than following a task or presenting a particular study.", instructions: "Preserve the learning objective, key definitions, reasoning, worked examples, misconceptions, and the main takeaway. Retain the speaker's definitions and qualifications without adding explanations absent from the source."},
  {id: "research", name: "Research presentations", description: "Scientific talks, study breakdowns, and conference research presentations centered on a particular research question, methods, and findings.", instructions: "Preserve the research question, methods, sample, findings, numerical results, limitations, uncertainty, and the distinction between evidence and interpretation. Do not turn associations into causal findings or claims into established facts."},
  {id: "news", name: "News reports", description: "Reporting current events, developments, or breaking stories. Use when reporting what happened is primary, rather than arguing a position or conducting an extended investigation.", instructions: "Preserve what happened, who was involved, location, dates, sources, confirmed facts, disputed claims, and unresolved questions. Keep the report's time context and distinguish verified reporting from allegations or speculation."},
  {id: "opinion", name: "Opinion and analysis", description: "Essays, criticism, and political, cultural, or economic commentary organized around the creator's interpretation or argument.", instructions: "Preserve the central thesis, supporting arguments, cited evidence, assumptions, counterarguments, and the distinction between facts and the creator's views. Attribute judgments and avoid presenting an argument as consensus."},
  {id: "interviews", name: "Interviews and conversations", description: "Guest interviews, conversational podcasts, and oral histories centered on questions, experiences, and dialogue. Competing positions as the main purpose belong in debates.", instructions: "Preserve speaker attribution, major questions, substantive answers, personal experiences, disagreements, qualifications, and notable quotes. Organize by meaningful themes and never invent speaker identities or quotations."},
  {id: "debates", name: "Debates and panel discussions", description: "Structured debates, roundtables, and panel discussions organized around competing positions or multiple viewpoints on a shared question.", instructions: "Preserve the central question, each participant's position, strongest arguments, rebuttals, areas of agreement, and issues left unresolved. Attribute views accurately; do not invent a winner or a consensus."},
  {id: "documentaries", name: "Documentaries and investigations", description: "Factual storytelling about people, institutions, events, or hidden practices using a developed narrative or investigation, rather than a personal life update or brief news report.", instructions: "Preserve the central subject, narrative chronology, major discoveries, evidence and sources, competing accounts, and the conclusion's limits. Distinguish the narrator's interpretation from reported events."},
  {id: "product_reviews", name: "Product reviews", description: "Hands-on evaluation of a specific device, service, tool, or product. Use when evaluating one primary product, even if competitors are mentioned incidentally.", instructions: "Preserve the tested model and version, price at review time, testing conditions, observed strengths and weaknesses, verdict, and intended audience. Attribute testing and judgments to the reviewer; retain sponsorship disclosures when stated."},
  {id: "comparisons", name: "Comparisons and buying guides", description: "Choosing between multiple products, services, subscriptions, or approaches using shared criteria. Use when the choice between alternatives is the main purpose.", instructions: "Preserve the options compared, evaluation criteria, meaningful differences, prices and their time context, tradeoffs, and the best option for each stated use case. Keep conditions attached to recommendations and attribute judgments."},
  {id: "travel", name: "Travel and destination guides", description: "Itineraries, destination overviews, local recommendations, and travel logistics intended to help viewers plan a visit. Personal travel diaries without planning guidance belong in vlogs.", instructions: "Preserve places, route and order, transport, costs, timing, booking requirements, seasonal context, and practical tips. Keep dates and conditions attached to prices and access information; do not infer missing logistics."},
  {id: "vlogs", name: "Personal vlogs and life updates", description: "Daily life, personal milestones, challenges, and reflective updates centered on the creator's experience, including personal travel diaries.", instructions: "Preserve the main events, personal context, chronology, decisions, emotional progression, and reflections, with opinions attributed to the creator. Do not infer private motives or force an educational purpose; learning_outcomes may be empty."},
  {id: "gaming", name: "Gaming guides and walkthroughs", description: "Game strategies, mission walkthroughs, builds, puzzle solutions, and game mechanics intended to help viewers play. Non-instructional gaming entertainment can use Other.", instructions: "Preserve the game and version, objective, prerequisites, equipment or build, action sequence, decision points, and spoiler boundaries. Identify spoilers before revealing plot or puzzle solutions. Never invent unseen gameplay or inputs."},
  {id: "sports", name: "Sports matches and competitions", description: "Match footage, highlights, race recaps, and competition breakdowns centered on the events and result of a sports competition, rather than exercise instruction.", instructions: "Preserve participants, event and date, final result, turning points, standout performances, key statistics, and consequences for the competition. Use only events and scores supported by captions; learning_outcomes may be empty."},
  {id: "announcements", name: "Business and product announcements", description: "Launch events, company updates, roadmap presentations, and earnings discussions centered on what an organization announces, rather than independent product evaluation.", instructions: "Preserve what was announced, availability, pricing, specifications, commitments, deadlines, and the distinction between current features and future plans. Attribute company claims and distinguish forecasts from reported results."},
  {id: "fiction", name: "Fiction and scripted storytelling", description: "Short films, episodes, animation, narrative sketches, and audio dramas with fictional characters and a developed plot. Factual stories belong in documentaries or vlogs.", instructions: "Preserve the setting, main characters, motivations, plot sequence, conflict, turning points, and ending. Explicitly label the spoiler level before revealing twists or the ending. Do not infer unseen scenes or force an educational purpose; learning_outcomes may be empty."},
  {id: "performances", name: "Live performances", description: "Concerts, stand-up comedy, theatre, dance, and spoken-word performances where the live act is the main purpose. A scripted screen narrative belongs in fiction.", instructions: "Preserve the performer, performance type, set or segment order, themes, standout moments, audience interaction, and meaningful visual or musical elements only when supported by captions. Do not invent stage action, musical qualities, or an educational purpose; learning_outcomes may be empty."},
  {...LEGACY_CATEGORIES.find(category => category.id === "other")}
].map(category => Object.freeze({...category, format: categoryFormat(category)})));

// Upgrade only the untouched starter set. Customizations and saved job/history snapshots remain intact.
export function upgradeStarterCategories(value) {
  const untouched = Array.isArray(value) && value.length === LEGACY_CATEGORIES.length
    && value.every((category, index) => category && ["id", "name", "description", "instructions"]
      .every(key => category[key] === LEGACY_CATEGORIES[index][key]));
  return untouched ? DEFAULT_CATEGORIES.map(category => ({...category})) : value;
}

export const MAX_CATEGORIES = 50;

export function normalizeCategories(value) {
  if (!Array.isArray(value)) return DEFAULT_CATEGORIES.map(category => ({...category}));
  const categories = [];
  const seen = new Set();
  for (const item of value.slice(0, MAX_CATEGORIES)) {
    if (!item || !/^[a-z][a-z0-9_]{0,63}$/.test(item.id || "") || seen.has(item.id)) continue;
    const category = {id: item.id};
    for (const [key, limit] of [["name", 80], ["description", 1200], ["instructions", 2400]]) {
      category[key] = typeof item[key] === "string" ? item[key].trim().slice(0, limit) : "";
    }
    if (!category.name || !category.description || !category.instructions) continue;
    category.format = categoryFormat(item);
    seen.add(category.id);
    categories.push(category);
  }
  if (!seen.has("other")) {
    if (categories.length === MAX_CATEGORIES) categories.pop();
    categories.push({...DEFAULT_CATEGORIES.find(category => category.id === "other")});
  }
  return categories;
}

export function validateCategories(value) {
  if (!Array.isArray(value) || value.length > MAX_CATEGORIES || !value.some(category => category.id === "other")) {
    throw new Error(`Keep the Other fallback and at most ${MAX_CATEGORIES} categories.`);
  }
  const clean = normalizeCategories(value);
  if (JSON.stringify(clean) !== JSON.stringify(value.map(category => ({
    id: category.id, name: category.name.trim(), description: category.description.trim(), instructions: category.instructions.trim(),
    format: FORMAT_IDS.includes(category.format) ? category.format : categoryFormat(category)
  })))) throw new Error("Every category needs a name, a definition, and summary instructions within the field limits.");
  if (new Set(clean.map(category => category.name.toLowerCase())).size !== clean.length) throw new Error("Give each category a different name.");
  return clean;
}
