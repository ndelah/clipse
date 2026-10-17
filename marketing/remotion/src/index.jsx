import React from 'react';
import {registerRoot, Composition, AbsoluteFill, Img, Audio, Sequence, staticFile, useCurrentFrame, interpolate, spring, useVideoConfig} from 'remotion';
const C = {green: '#244B3D', dark: '#17372D', cream: '#F5F3E9', lime: '#DCE9AF', faded: '#BDD0BF'};
const font = 'Arial, Helvetica, sans-serif';
const scenes = [
  {id:'01-overview', eyebrow:'THE WHOLE PICTURE', title:<>Understand<br/>before you<br/><span style={{color:C.lime}}>watch.</span></>, sub:'Turn YouTube captions into a clear, useful summary.', capture:'summary', tag:'A clear summary, right beside YouTube.'},
  {id:'02-timestamps', eyebrow:'THE MOMENTS THAT MATTER', title:<>Find the point.<br/><span style={{color:C.lime}}>Jump right in.</span></>, sub:'Key takeaways link back to useful moments in the video.', capture:'timestamps', tag:'Read the takeaway. Revisit the source.'},
  {id:'03-recipes', eyebrow:'DETAILS WORTH KEEPING', title:<>The recipe.<br/>The quantities.<br/><span style={{color:C.lime}}>The timing.</span></>, sub:'Recipes preserve stated ingredients, temperatures, and cooking times.', capture:'recipe', tag:'A summary that fits the video.'},
  {id:'04-history', eyebrow:'YOUR OWN REFERENCE LIBRARY', title:<>Watch once.<br/><span style={{color:C.lime}}>Find it again.</span></>, sub:'Search saved summaries and return to what you learned.', capture:'history', tag:'Saved in this Chrome profile.'},
  {id:'05-categories', eyebrow:'MAKE IT YOURS', title:<>20 categories.<br/><span style={{color:C.lime}}>Your priorities.</span></>, sub:'Edit what belongs in each category and what its summary should preserve.', capture:'categories', tag:'Plus an Other fallback for everything else.'}
];
function Logo({size=50, light=true}) {return <Img src={staticFile('eclipse.svg')} style={{width:size,height:size,filter:light?'invert(93%) sepia(8%) saturate(283%) hue-rotate(2deg) brightness(108%)':'none'}}/>;}
function Brand({size=32}) {return <div style={{display:'flex',alignItems:'center',gap:12,color:C.cream,fontSize:size,fontWeight:600,letterSpacing:-1.2}}><Logo size={size*1.5}/>Clipse</div>;}
function Backdrop() {return <AbsoluteFill style={{background:C.green,overflow:'hidden'}}><div style={{position:'absolute',width:720,height:720,border:'1px solid #ffffff12',borderRadius:'50%',right:-250,top:-270}}/><div style={{position:'absolute',width:870,height:870,border:'1px solid #ffffff0b',borderRadius:'50%',right:-325,top:-345}}/></AbsoluteFill>;}
function Screenshot({index=0, animated=false}) {
  const f=useCurrentFrame(); const {fps}=useVideoConfig(); const s=scenes[index];
  const reveal=animated?spring({frame:f-6,fps,config:{damping:22,stiffness:120}}):1;
  const textReveal=animated?interpolate(f,[0,15],[0,1],{extrapolateLeft:'clamp',extrapolateRight:'clamp'}):1;
  return <AbsoluteFill style={{fontFamily:font,color:C.cream}}><Backdrop/>
    <div style={{position:'absolute',left:64,top:48}}><Brand/></div>
    <div style={{position:'absolute',left:70,top:188,width:630,opacity:textReveal,transform:`translateY(${(1-textReveal)*16}px)`}}>
      <div style={{fontSize:14,fontWeight:700,letterSpacing:2.5,color:C.faded,marginBottom:24}}>{s.eyebrow}</div>
      <div style={{fontSize:70,lineHeight:1.06,letterSpacing:-3.6,fontWeight:600}}>{s.title}</div>
      <div style={{fontSize:25,lineHeight:1.4,color:'#E0E7D9',maxWidth:530,marginTop:27}}>{s.sub}</div>
    </div>
    <div style={{position:'absolute',left:750,top:48,width:456,height:690,borderRadius:18,overflow:'hidden',background:'#fafaf8',boxShadow:'0 24px 65px #0b281c66',opacity:reveal,transform:`translateY(${(1-reveal)*32}px)`}}>
      <div style={{height:34,display:'flex',alignItems:'center',gap:6,padding:'0 14px',background:'#E4E7DF',borderBottom:'1px solid #d2d8cd'}}>{['#B8BEB3','#B8BEB3','#B8BEB3'].map((color,i)=><div key={i} style={{width:7,height:7,borderRadius:9,background:color}}/>)}<span style={{fontSize:11,color:'#5c6b5f',marginLeft:12}}>Clipse · Chrome side panel</span></div>
      <Img src={staticFile(`captures/${s.capture}.png`)} style={{display:'block',width:456,height:655.5}}/>
    </div>
    <div style={{position:'absolute',left:70,bottom:58,fontSize:17,color:C.lime}}>{s.tag}</div>
    <div style={{position:'absolute',left:70,bottom:26,fontSize:12,color:C.faded}}>Example content shown · Requires your own OpenAI API key and API credit</div>
  </AbsoluteFill>;
}
function Intro() {
 const f=useCurrentFrame();const {fps}=useVideoConfig();const pop=spring({frame:f,fps,config:{damping:20}});
 const a=interpolate(f,[16,32],[0,1],{extrapolateLeft:'clamp',extrapolateRight:'clamp'});
 return <AbsoluteFill style={{fontFamily:font,color:C.cream,alignItems:'center',justifyContent:'center'}}><Backdrop/>
 <div style={{position:'relative',display:'flex',flexDirection:'column',alignItems:'center',transform:`translateY(${(1-pop)*30}px)`,opacity:pop}}><Brand size={52}/>
 <div style={{fontSize:108,fontWeight:600,letterSpacing:-5,lineHeight:1.06,textAlign:'center',marginTop:62}}>Less watching.<br/><span style={{color:C.lime}}>More knowing.</span></div>
 <div style={{fontSize:28,color:C.faded,marginTop:36,opacity:a}}>Understand a YouTube video before you watch.</div></div></AbsoluteFill>;
}
function Outro() {
 const f=useCurrentFrame(); const a=interpolate(f,[0,18],[0,1],{extrapolateLeft:'clamp',extrapolateRight:'clamp'});
 return <AbsoluteFill style={{fontFamily:font,color:C.cream,justifyContent:'center',alignItems:'center'}}><Backdrop/><div style={{position:'relative',textAlign:'center',opacity:a}}><div style={{display:'flex',justifyContent:'center'}}><Brand size={62}/></div><div style={{fontSize:78,fontWeight:600,letterSpacing:-3,lineHeight:1.1,marginTop:54}}>The whole picture.<br/><span style={{color:C.lime}}>One click away.</span></div><div style={{fontSize:27,marginTop:38,color:'#E0E7D9'}}>For YouTube. In Chrome.</div><div style={{display:'inline-block',fontSize:21,marginTop:28,padding:'16px 26px',borderRadius:50,background:C.lime,color:C.dark}}>Bring your own OpenAI API key</div><div style={{fontSize:16,color:C.faded,marginTop:30}}>Readable captions required · API usage billed separately</div></div></AbsoluteFill>;
}
function Video() {
 const f=useCurrentFrame();const starts=[120,300,480,660];
 return <AbsoluteFill style={{background:C.green}}><Audio src={staticFile('original-score.wav')} volume={1}/>
 <Sequence from={0} durationInFrames={120}><Intro/></Sequence>
 {starts.map((start,i)=><Sequence key={start} from={start} durationInFrames={180}><AbsoluteFill style={{justifyContent:'center',alignItems:'center'}}><div style={{position:'relative',width:1280,height:800,flexShrink:0,transform:'scale(1.35)'}}><Screenshot index={i} animated/></div></AbsoluteFill></Sequence>)}
 <Sequence from={840} durationInFrames={150}><Outro/></Sequence>
 <div style={{position:'absolute',height:3,bottom:0,left:0,width:`${f/989*100}%`,background:C.lime}}/>
 </AbsoluteFill>;
}
function Tile({marquee=false}) {
 const w=marquee?1400:440,h=marquee?560:280;
 return <AbsoluteFill style={{fontFamily:font,color:C.cream}}><Backdrop/>
 {marquee?<><div style={{position:'absolute',left:115,top:115}}><Logo size={310}/></div><div style={{position:'absolute',left:490,top:145,fontSize:112,fontWeight:600,letterSpacing:-6}}>Clipse</div><div style={{position:'absolute',left:497,top:294,fontSize:36,lineHeight:1.35,color:C.lime}}>Less watching.<br/>More knowing.</div><div style={{position:'absolute',right:100,top:185,display:'flex',flexDirection:'column',gap:20}}>{[130,100,70].map((width,i)=><div key={i} style={{height:11,width,background:C.lime,opacity:0.7-i*0.18,borderRadius:9}}/>)}</div></>:<><div style={{position:'absolute',left:172,top:42}}><Logo size={96}/></div><div style={{position:'absolute',top:147,width:'100%',fontSize:52,fontWeight:600,letterSpacing:-2,textAlign:'center'}}>Clipse</div><div style={{position:'absolute',top:217,width:'100%',textAlign:'center',fontSize:16,color:C.lime}}>Less watching. More knowing.</div></>}
 </AbsoluteFill>;
}
function Root(){return <>
 <Composition id="ClipsePromo" component={Video} width={1920} height={1080} fps={30} durationInFrames={990}/>
 {scenes.map((scene,index)=><Composition key={scene.id} id={scene.id} component={Screenshot} width={1280} height={800} fps={30} durationInFrames={1} defaultProps={{index}}/>)}
 <Composition id="SmallTile" component={Tile} width={440} height={280} fps={30} durationInFrames={1}/>
 <Composition id="MarqueeTile" component={Tile} width={1400} height={560} fps={30} durationInFrames={1} defaultProps={{marquee:true}}/>
 </>}
registerRoot(Root);
