// Optional asset generation. Install sharp or set SHARP_MODULE to its entrypoint.
import {readFile} from "node:fs/promises";
import {fileURLToPath, pathToFileURL} from "node:url";
const {default: sharp} = await import(process.env.SHARP_MODULE ? pathToFileURL(process.env.SHARP_MODULE).href : "sharp");
const original = await readFile(new URL("../assets/brand/eclipse.svg", import.meta.url), "utf8");
// Chrome’s native panel header uses fixed manifest artwork, outside page CSS.
// A dark tile with a white mark stays legible in either browser theme.
const source = original.replace('fill="#000000"', 'fill="#f5f3e9"').replace('<g fill=', '<rect x="0" y="0" width="512" height="512" rx="112" fill="#244b3d"/><g fill=');
for (const size of [16, 32, 48, 128]) {
  const artworkSize = size === 128 ? 96 : size;
  const icon = await sharp(Buffer.from(source)).resize(artworkSize, artworkSize).png().toBuffer();
  const image = size === 128
    ? sharp({create: {width: 128, height: 128, channels: 4, background: '#00000000'}}).composite([{input: icon, left: 16, top: 16}])
    : sharp(icon);
  await image.png().toFile(fileURLToPath(new URL(`../extension/assets/icon-${size}.png`, import.meta.url)));
}
console.log("Generated toolbar and extension icons from the original SVG.");
