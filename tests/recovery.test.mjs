import test from "node:test";
import assert from "node:assert/strict";
import {recoveryFor} from "../extension/recovery.js";

test("recoverable failures lead to a relevant next action", () => {
  for (const [message, action] of [
    ["Incorrect API key provided", "settings"], ["HTTP 429 rate limit exceeded", "settings"],
    ["The requested captions are unavailable. Choose Best available", "settings"],
    ["This video has no readable transcript", "none"], ["This tab has changed video", "reload"],
    ["Could not extract the transcript from YouTube's transcript panel. YouTube did not render transcript rows after the transcript panel was opened.", "reload"],
    ["YouTube did not finish rendering its transcript within 25 seconds.", "reload"],
    ["YouTube's transcript panel returned no transcript rows.", "reload"],
    ["Could not find YouTube's Show transcript control after waiting for the description to load. This does not mean the video has no captions.", "reload"],
    ["Request timed out after 180 seconds", "retry"], ["Failed to fetch", "retry"]
  ]) assert.equal(recoveryFor(new Error(message)).action, action, message);
  assert.match(recoveryFor(new Error("Request timed out")).message, /begins again.*charges/);
});
