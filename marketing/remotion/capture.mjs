// Capture the actual shipped UI with public, synthetic example content. No API calls or real keys.
import {readFile, mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url);
const {chromium} = process.env.CLIPSE_NODE_MODULES ? require(path.join(process.env.CLIPSE_NODE_MODULES, 'playwright')) : require('playwright');
const out = path.join(root, 'marketing/remotion/public/captures');
await mkdir(out, {recursive: true});
const examples = [
  ['abcdefghijk', 'A calmer way to plan your week', 'Example · Thoughtful work', 'Lessons and explainers', 'Choose a few meaningful priorities, protect time for them, and leave room for the unexpected.', 'Start with the commitments already on your calendar. Then choose three priorities and turn each into a concrete next action.\n\nLeave some time unplanned. Review what actually happened at the end of the week and adjust your next plan.', [['Choose three priorities for the week.', 42], ['Turn each priority into a concrete next action.', 188], ['Leave space for unexpected work.', 412]]],
  ['lmnopqrstuv', 'Roasted tomato soup, step by step', 'Example · Everyday kitchen', 'Recipes and cooking', 'Roast tomatoes with garlic, then blend with stock for a simple soup.', 'For four servings, use 1 kg tomatoes, 1 onion, 4 garlic cloves, 2 tablespoons olive oil, and 500 ml vegetable stock.\n\nRoast the vegetables at 200°C for 35 minutes. Transfer to a pot, add the stock, and simmer for 10 minutes before blending. Adjust the seasoning and serve.', [['Use 1 kg tomatoes and 500 ml vegetable stock for four servings.', 38], ['Roast at 200°C for 35 minutes.', 126], ['Simmer for 10 minutes, then blend.', 287]]],
  ['mnopqrstuvw', 'Choosing a compact camera', 'Example · Camera notes', 'Comparisons and buying guides', 'Compare portability, autofocus, and lens flexibility against the photographs you want to make.', 'Choose the camera that suits how you shoot. The reviewer compares a pocketable fixed-lens model with an interchangeable-lens body.\n\nThe first favors portability; the second offers more flexibility at a higher total size and cost. Testing claims and preferences belong to the reviewer.', [['Start with your intended use, then compare the tradeoffs.', 64], ['Include the lens when comparing size and price.', 242]]]
];
const summaries = Object.fromEntries(examples.map(([videoId, title, channel, category, lead, full, takeaways], i) => [videoId, {videoId, url: `https://www.youtube.com/watch?v=${videoId}`, title, channel, createdAt: `2026-10-${12-i}T10:00:00Z`, updatedAt: `2026-10-${12-i}T10:00:00Z`, durationSeconds: 782, transcriptLanguage: 'English', transcriptIsGenerated: false, preview: {one_sentence_summary: lead, full_summary: full, worth_watching: '', content_type: category, key_takeaways: takeaways.map(([text, timestamp_seconds]) => ({text, timestamp_seconds})), learning_outcomes: []}}]));
const browser = await chromium.launch({channel: 'chrome', headless: true});
try {
  const context = await browser.newContext({viewport: {width: 480, height: 690}, deviceScaleFactor: 2, colorScheme: 'light', reducedMotion: 'reduce'});
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname !== 'localhost') return route.abort();
    const rel = decodeURIComponent(url.pathname).replace(/^\//, '');
    if (rel.includes('..')) return route.abort();
    try { const body = await readFile(path.join(root, 'extension', rel)); await route.fulfill({body, contentType: ({'.js':'text/javascript','.html':'text/html','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'})[path.extname(rel)] || 'application/octet-stream'}); }
    catch { await route.fulfill({status: 404, body: 'Not found'}); }
  });
  await context.addInitScript(({summaries}) => {
    const event = () => ({addListener() {}, removeListener() {}});
    const state = {summaries, jobs: {}, onboardingDismissed: true, apiKey: ''};
    window.chrome = {storage: {onChanged: event(), local: {async get(defaults = {}) { return {...defaults, ...structuredClone(state)}; }, async set(patch) { Object.assign(state, patch); }}}, tabs: {onActivated: event(), onUpdated: event(), async query() { return []; }, async sendMessage() { return {context: {captionTracks: []}}; }}, runtime: {async sendMessage() { return {ok: true}; }}};
  }, {summaries});
  const page = await context.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://localhost/sidepanel.html');
  await page.locator('.history-title').first().waitFor();
  await page.screenshot({path: path.join(out, 'history.png')});
  await page.locator('.history-title').filter({hasText: 'A calmer way'}).click();
  await page.locator('#fullSummarySection > summary').click();
  await page.locator('#fullSummarySection[open]').waitFor();
  await page.screenshot({path: path.join(out, 'summary.png')});
  await page.locator('#fullSummarySection > summary').click();
  await page.locator('#takeawaysSection > summary').click();
  await page.screenshot({path: path.join(out, 'timestamps.png')});
  await page.locator('#backToHistoryButton').click();
  await page.locator('.history-title').filter({hasText: 'Roasted tomato'}).click();
  await page.locator('#fullSummarySection > summary').click();
  await page.screenshot({path: path.join(out, 'recipe.png')});
  await page.locator('#settingsButton').click();
  await page.locator('#categoriesSettings > summary').click();
  await page.locator('#categoryList .category-editor').first().locator('summary').click();
  await page.locator('#categoriesSettings').scrollIntoViewIfNeeded();
  await page.screenshot({path: path.join(out, 'categories.png')});
  if (errors.length) throw new Error(errors.join('\n'));
  console.log('Captured five actual UI states with labeled synthetic examples.');
  await context.close();
} finally { await browser.close(); }
