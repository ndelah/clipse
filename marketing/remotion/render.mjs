import {bundle} from '@remotion/bundler';
import {getCompositions, renderMedia, renderStill, openBrowser} from '@remotion/renderer';
import {mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const here=fileURLToPath(new URL('.',import.meta.url));
const output=path.resolve(here,'../store');
await mkdir(path.join(output,'screenshots'),{recursive:true});
await mkdir(path.join(output,'tiles'),{recursive:true});
const serveUrl=await bundle({entryPoint:path.join(here,'src/index.jsx'),publicDir:path.join(here,'public')});
const browser=await openBrowser('chrome',{browserExecutable:process.env.CLIPSE_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
try {
 const compositions=await getCompositions(serveUrl,{puppeteerInstance:browser});
 for(const composition of compositions.filter(c=>c.id!=='ClipsePromo' && !process.argv.includes('--video-only'))){
  const target=composition.id==='SmallTile'?'tiles/small-promo-440x280.jpg':composition.id==='MarqueeTile'?'tiles/marquee-promo-1400x560.jpg':`screenshots/${composition.id}.jpg`;
  await renderStill({serveUrl,composition,output:path.join(output,target),imageFormat:'jpeg',jpegQuality:96,puppeteerInstance:browser});
  console.log('Rendered',target);
 }
 const composition=compositions.find(c=>c.id==='ClipsePromo');
 if(!process.argv.includes('--stills-only')){
 await renderStill({serveUrl,composition,frame:90,output:path.join(output,'video-poster.png'),imageFormat:'png',puppeteerInstance:browser});
 let last=-1;
 await renderMedia({serveUrl,composition,outputLocation:path.join(output,'clipse-promo-1080p.mp4'),codec:'h264',crf:18,pixelFormat:'yuv420p',audioCodec:'aac',concurrency:3,puppeteerInstance:browser,onProgress:({progress})=>{const pct=Math.floor(progress*10)*10;if(pct!==last){console.log(`Video ${pct}%`);last=pct;}}});
 console.log('Rendered clipse-promo-1080p.mp4');
 }
} finally {await browser.close({silent:true});}
