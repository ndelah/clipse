import {build} from 'esbuild';
await build({entryPoints: ['experiments/summary-ui/app.jsx'], bundle: true, outfile: 'extension/summary-lab.js', format: 'esm', platform: 'browser', target: 'chrome120', minify: true, legalComments: 'eof', define: {'process.env.NODE_ENV': '"production"'}});
