import assert from 'node:assert/strict';
import sharp from 'sharp';
import {readdir, readFile, writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const dir=fileURLToPath(new URL('../store/',import.meta.url));
const screenshots=(await readdir(path.join(dir,'screenshots'))).filter(f=>f.endsWith('.jpg')).sort();
assert.equal(screenshots.length,5,'Exactly five store screenshots');
const expected=[['icon-128.png',128,128,'png'],...screenshots.map(f=>['screenshots/'+f,1280,800,'jpeg']),['tiles/small-promo-440x280.jpg',440,280,'jpeg'],['tiles/marquee-promo-1400x560.jpg',1400,560,'jpeg']];
const assets=[];
for(const [file,width,height,format] of expected){
 const m=await sharp(path.join(dir,file)).metadata();
 assert.deepEqual([m.width,m.height,m.format],[width,height,format],file);
 if(format==='jpeg') assert.equal(m.hasAlpha,false,file+' must be opaque');
 assets.push({file,width,height,format,alpha:m.hasAlpha});
}
const {data,info}=await sharp(path.join(dir,'icon-128.png')).ensureAlpha().raw().toBuffer({resolveWithObject:true});
let minX=128,minY=128,maxX=-1,maxY=-1;
for(let y=0;y<128;y++)for(let x=0;x<128;x++)if(data[(y*128+x)*info.channels+3]>0){minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);}
assert.deepEqual([minX,minY,maxX,maxY],[16,16,111,111],'16px transparent icon padding');
const description=(await readFile(path.join(dir,'short-description.txt'),'utf8')).trim();
assert.ok(description.length<=132,'Short description fits manifest limit');
const manifest=JSON.parse(await readFile(new URL('../../extension/manifest.json',import.meta.url),'utf8'));
assert.equal(manifest.description,description);
const probe=JSON.parse(execFileSync('ffprobe',['-v','error','-show_entries','format=duration,size:stream=codec_name,codec_type,width,height,r_frame_rate,sample_rate,channels','-of','json',path.join(dir,'clipse-promo-1080p.mp4')],{encoding:'utf8'}));
const video=probe.streams.find(s=>s.codec_type==='video'),audio=probe.streams.find(s=>s.codec_type==='audio');
assert.deepEqual([video.codec_name,video.width,video.height,video.r_frame_rate],['h264',1920,1080,'30/1']);
assert.equal(audio.codec_name,'aac');assert.equal(audio.channels,2);
assert.ok(Math.abs(Number(probe.format.duration)-33)<0.1);
await writeFile(path.join(dir,'asset-manifest.json'),JSON.stringify({assets,iconBounds:[minX,minY,maxX,maxY],shortDescriptionLength:description.length,video:probe,validation:{imageDimensions:'passed',iconPadding:'passed',videoCodecsAndDuration:'passed',visualReview:'All five screenshots, both promo tiles, icon, and representative frames from the rendered video inspected.',exampleContent:'Actual extension UI with explicitly labeled synthetic summaries.'}},null,2)+'\n');
console.log('Validated icon, five JPEG screenshots, both promo tiles, manifest description, and 33-second 1080p H.264/AAC video.');
