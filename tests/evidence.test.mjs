import test from "node:test";
import assert from "node:assert/strict";
import {attachEvidence} from "../extension/evidence.js";
import {normalizeSummary, parseHistory, HISTORY_FORMAT, sameConfiguration, summaryConfiguration} from "../extension/shared.js";
import {summary, event, scriptContext, run} from "./helpers.mjs";

const segments = [{startSeconds: 2.8, text: "Exact caption text."}, {startSeconds: 9, text: "Second passage."}];
test("evidence uses actual caption text and time, and discards invented references", () => {
  const result = attachEvidence({key_takeaways: [
    {text: "A point", timestamp_seconds: 999, source_segment_id: "S0"},
    {text: "Unsupported point", timestamp_seconds: 20, source_segment_id: "S999"}
  ]}, segments);
  assert.equal(result.key_takeaways[0].timestamp_seconds, 2);
  assert.deepEqual(result.key_takeaways[0].source, {segmentId: "S0", startSeconds: 2, text: "Exact caption text."});
  assert.equal(result.key_takeaways[1].timestamp_seconds, null);
  assert.equal(result.key_takeaways[1].source, undefined);
});
test("backup restores evidence and ignores legacy saved markers, malformed excerpts, and secrets", () => {
  const record = summary(); record.saved = true;
  record.preview = attachEvidence(record.preview, segments);
  record.preview.key_takeaways[0] = {text: "Point", timestamp_seconds: 2, source: {segmentId: "S0", startSeconds: 2, text: "Exact caption text.", apiKey: "secret"}};
  const restored = parseHistory({format: HISTORY_FORMAT, version: 1, summaries: [record]}).summaries[0];
  assert.equal(restored.saved, undefined);
  assert.equal(restored.preview.key_takeaways[0].source.text, "Exact caption text.");
  assert.equal(restored.preview.key_takeaways[0].source.apiKey, undefined);
  record.preview.key_takeaways[0].source.startSeconds = 100;
  assert.equal(normalizeSummary(record).preview.key_takeaways[0].source, undefined);
});
test("caption selection participates in generation cache identity", () => {
  const first = summaryConfiguration({captionLanguage: "fr:manual"});
  assert.equal(sameConfiguration(first, summaryConfiguration({captionLanguage: "en:asr"})), false);
  assert.equal(sameConfiguration(first, {...first, apiKey: "changed"}), true);
});
test("single and long-video synthesis retain original segment IDs through section notes", async () => {
  const bodies = [];
  const chrome = {runtime: {onMessage: event(), async sendMessage() { return {ok: true, job: {status: "running"}}; }}};
  const context = scriptContext("offscreen.js", {chrome, window: {addEventListener() {}}, async fetch(_url, options) {
    const body = JSON.parse(options.body); bodies.push(body);
    return {ok: true, async json() { return {output_text: JSON.stringify(body.text?.format.name === "video_preview"
      ? {key_takeaways: [{text: "Final point", timestamp_seconds: 9999, source_segment_id: "S29"}]} : {source_segment_ids: ["S29"]})}; }};
  }});
  const result = await run(context, `createPreview({segments:Array.from({length:30},(_,i)=>({startSeconds:i*60,text:'Caption '.repeat(200)})),isGenerated:false}, {apiKey:'test', outputLanguage:'same'}, async()=>{}, 'job')`);
  assert.equal(result.key_takeaways[0].source.startSeconds, 29 * 60);
  assert.match(bodies.at(-1).instructions, /language of the supplied captions/);
  assert.match(bodies.at(-1).input, /S29/);
  const sectionRequests = bodies.filter(body => body.text?.format.name === "video_section_notes");
  assert.match(sectionRequests.at(-1).input, /\[S29 /);
  assert.ok(sectionRequests[0].text.format.schema.required.includes("source_segment_ids"));
});

