import {mkdirSync, readFileSync, rmSync} from "node:fs";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const manifest = JSON.parse(readFileSync(path.join(root, "extension/manifest.json"), "utf8"));
if (!/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(manifest.version)) {
  throw new Error("Expected a numeric Chrome extension version.");
}
const output = path.join(root, "dist", `clipse-${manifest.version}.zip`);
const firefoxOutput = path.join(root, "dist", `clipse-firefox-${manifest.version}.xpi`);
mkdirSync(path.dirname(output), {recursive: true});
for (const archive of [output, firefoxOutput]) rmSync(archive, {force: true});
const result = spawnSync("zip", ["-q", "-r", output, ".", "-x", "*.DS_Store"], {
  cwd: path.join(root, "extension"),
  stdio: "inherit"
});
if (result.error) throw result.error;
if (result.status !== 0) throw new Error(`Packaging failed (${result.status}).`);
const firefoxResult = spawnSync("zip", ["-q", "-r", firefoxOutput, ".", "-x", "*.DS_Store"], {
  cwd: path.join(root, "extension-firefox"),
  stdio: "inherit"
});
if (firefoxResult.error) throw firefoxResult.error;
if (firefoxResult.status !== 0) throw new Error(`Firefox packaging failed (${firefoxResult.status}).`);
console.log(`Created ${output}`);
console.log(`Created ${firefoxOutput}`);
