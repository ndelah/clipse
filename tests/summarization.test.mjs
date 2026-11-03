import test from "node:test";
import assert from "node:assert/strict";
import {event, scriptContext, run, VIDEO_A} from "./helpers.mjs";

function offscreen() {
  const bodies = [];
  const chrome = {runtime: {onMessage: event(), async sendMessage() { return {ok: true, job: {status: "running"}}; }}};
  const context = scriptContext("offscreen.js", {chrome, window: {addEventListener() {}},
    async fetch(_url, options) { bodies.push(JSON.parse(options.body)); return {ok: true, async json() { return {output_text: '{"one_sentence_summary":"A summary"}'}; }}; }});
  return {context, bodies};
}

test("brief output language is applied to the single-request summary", async () => {
  const f = offscreen();
  await run(f.context, `createPreview({segments:[{startSeconds:0,text:'Hello'}],isGenerated:null}, {apiKey:'test',model:'gpt-4.1-mini',outputLanguage:'French',summaryLength:'brief'}, async()=>{}, '${VIDEO_A}')`);
  assert.equal(f.bodies.length, 2);
  assert.equal(f.bodies[0].text.format.name, "video_classification");
  assert.match(f.bodies[1].instructions, /in French/);
  assert.match(f.bodies[1].instructions, /Keep the summary short/);
  assert.match(f.bodies[1].instructions, /Summary format: General/);
  assert.match(f.bodies[1].instructions, /Do not write segment IDs or clock times/);
  assert.ok(f.bodies[1].text.format.schema.required.includes("summary_fields"));
  assert.match(f.bodies[1].input, /could not be verified/);
});

test("long-video synthesis preserves requested language and detailed length", async () => {
  const f = offscreen();
  await run(f.context, `createPreview({segments:Array.from({length:30},(_,i)=>({startSeconds:i*60,text:'Text '.repeat(200)})),isGenerated:true}, {apiKey:'test',model:'gpt-4.1-mini',outputLanguage:'Dutch',summaryLength:'detailed'}, async()=>{}, '${VIDEO_A}')`);
  assert.ok(f.bodies.length > 2);
  assert.match(f.bodies.at(-1).instructions, /in Dutch/);
  assert.match(f.bodies.at(-1).instructions, /fill every summary field the source supports/);
  assert.match(f.bodies.at(-1).instructions, /Summary format: General/);
  assert.ok(f.bodies.slice(1, -1).every(body => body.text.format.name === "video_section_notes"));
  assert.equal(f.bodies.at(-1).text.format.name, "video_preview");
});

test("thumbnail summaries use metadata acquired while reading captions", async () => {
  const f = offscreen();
  const job = {id: "feed", videoId: VIDEO_A, title: "Feed title", status: "running"};
  let completed;
  f.context.chrome.runtime.sendMessage = async message => {
    if (message.type === "GET_JOB") return {ok: true, job: structuredClone(job)};
    if (message.type === "GET_SETTINGS") return {ok: true, settings: {apiKey: "test"}};
    if (message.type === "GET_TRANSCRIPT") {
      Object.assign(job, {title: "Full video title", channel: "Real channel", durationSeconds: 180});
      return {ok: true, transcript: {segments: [{startSeconds: 0, text: "Hello"}]}};
    }
    if (message.type === "COMPLETE_JOB") { completed = message.summary; return {ok: true, accepted: true}; }
    return {ok: true};
  };
  await run(f.context, "processJob('feed')");
  assert.ok(completed);
  assert.equal(completed.title, "Full video title");
  assert.equal(completed.channel, "Real channel");
  assert.equal(completed.durationSeconds, 180);
});
