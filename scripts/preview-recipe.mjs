import {build} from 'esbuild';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
const {outputFiles} = await build({entryPoints: ['experiments/summary-ui/preview.jsx'], bundle: true, write: false, format: 'iife', platform: 'browser', minify: true, define: {'process.env.NODE_ENV': '"production"'}});
const css = await readFile('extension/summary-lab.css', 'utf8');
await mkdir('dist', {recursive: true});
await writeFile('dist/recipe-card-preview.html', `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Recipe card · Clipse</title><style>${css}</style></head><body><div id="app"></div><script>${outputFiles[0].text.replaceAll('</script', '<\\/script')}</script></body></html>`);
console.log('Created dist/recipe-card-preview.html');
