// Only footage from the actual product recording is used. No generated UI.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { writeScore } from './music.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const out = resolve(root, 'output');
const evidence = resolve(root, '../../evidence/product-live-demo-2026-10-13');
const movie = resolve(out, 'tuzheng-demo-90s.mp4');
const publishedMovie = resolve(root, '../tuzheng-product-demo-90s.mp4');
const publishedOriginal = resolve(root, '../tuzheng-product-demo-uncut.webm');
const workingOriginal = resolve(out, 'actual-product-uncut.webm');
const original = existsSync(workingOriginal) ? workingOriginal : publishedOriginal;
mkdirSync(out, { recursive: true });
const mode = process.argv[2];
if (process.argv.length !== 3 || !['--render', '--inspect', '--verify', '--serve'].includes(mode)) {
  console.log('Usage: render.mjs --render | --inspect | --verify | --serve'); process.exit(1);
}
function command(name, args) {
  const r = spawnSync(name, args, { encoding: 'utf8', maxBuffer: 8*1024*1024, windowsHide: true });
  if (r.error || r.status !== 0) throw new Error(`${name}: ${r.error?.message ?? r.stderr}`);
  return r.stdout;
}
const json = (file) => JSON.parse(readFileSync(file, 'utf8'));
const probe = (file, count = false) => JSON.parse(command('ffprobe', ['-v','error',...(count?['-count_frames']:[]),'-show_format','-show_streams','-of','json',file]));
const hash = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
function clock(t, separator = '.') {
  const ms = Math.round(t*1000);
  return `${String(Math.floor(ms/3600000)).padStart(2,'0')}:${String(Math.floor(ms/60000)%60).padStart(2,'0')}:${String(Math.floor(ms/1000)%60).padStart(2,'0')}${separator}${String(ms%1000).padStart(3,'0')}`;
}
const assClock = (t) => clock(t).slice(0,-1).replace(/^0/,'');
function encode() {
  assert.ok(existsSync(original),'Record the real product first.');
  const actions = json(resolve(evidence,'actions.json'));
  const summary = json(resolve(evidence,'summary.json'));
  assert.ok(summary.actualHttpRequests > 0 && summary.actualHttpRequests <= 12);
  const duration = Number(probe(original).format.duration);
  const waits = [];
  for (const [a,b] of [['vision-request',['vision-result','vision-failed']],['source-request',['source-result','source-failed']]]) {
    const start=actions.find(x=>x.label===a)?.time,end=actions.find(x=>b.includes(x.label))?.time;
    if(start!==undefined && end!==undefined)waits.push({start,end});
  }
  const waiting=waits.reduce((s,x)=>s+x.end-x.start,0),normal=duration-waiting;
  assert.ok(normal<89 && waiting>0,'Action footage exceeds the automatic 90-second plan.');
  const speed=Math.max(1,waiting/(90-normal));
  const segments=[];let cursor=0;
  for(const w of waits){segments.push({start:cursor,end:w.start,rate:1},{...w,rate:speed});cursor=w.end;}
  segments.push({start:cursor,end:duration,rate:1});
  function edited(t){let elapsed=0;for(const s of segments){if(t>=s.end)elapsed+=(s.end-s.start)/s.rate;else return elapsed+Math.max(0,t-s.start)/s.rate;}return elapsed;}
  const captions=actions.map((a,i)=>({start:edited(a.time),end:edited(actions[i+1]?.time??duration),text:a.caption})).filter(c=>c.end-c.start>.05);
  const header='[Script Info]\nScriptType: v4.00+\nPlayResX: 1920\nPlayResY: 1080\nWrapStyle: 0\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Sub,Microsoft YaHei,29,&H00FFFFFF,&H00FFFFFF,&H003A2410,&H003A2410,0,0,0,0,100,100,0,0,3,9,0,2,70,70,28,1\nStyle: Label,Microsoft YaHei,21,&H00FFFFFF,&H00FFFFFF,&H603A2410,&H603A2410,0,0,0,0,100,100,0,0,3,7,0,9,30,30,16,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n';
  const dialogue=(a,b,style,text)=>`Dialogue: 0,${assClock(a)},${assClock(b)},${style},,0,0,0,,${text.replaceAll('\n','\\N')}\n`;
  let ass=header+dialogue(0,90,'Label','真实项目页面实录 · 自制输入图');
  ass+=captions.map(c=>dialogue(c.start,c.end,'Sub',c.text)).join('');
  for(const w of waits)ass+=dialogue(edited(w.start),edited(w.end),'Label',`真实等待加速 ${speed.toFixed(2)} 倍 · 原等待 ${(w.end-w.start).toFixed(1)} 秒`);
  writeFileSync(resolve(out,'subtitles.ass'),ass);
  writeFileSync(resolve(out,'subtitles.zh-CN.srt'),captions.map((c,i)=>`${i+1}\n${clock(c.start,',')} --> ${clock(c.end,',')}\n${c.text}\n`).join('\n'));
  writeScore(resolve(out,'score.wav'),90);
  const graph=segments.map((s,i)=>`[0:v]trim=start=${s.start}:end=${s.end},setpts=(PTS-STARTPTS)/${s.rate}[v${i}]`).join(';')+';'+segments.map((s,i)=>`[v${i}]`).join('')+`concat=n=${segments.length}:v=1:a=0,tpad=stop_mode=clone:stop_duration=1,scale=1920:1080:flags=lanczos,fps=30,subtitles=filename=docs/submission/code-demo/output/subtitles.ass[out]`;
  command('ffmpeg',['-hide_banner','-loglevel','warning','-y','-i',original,'-i',resolve(out,'score.wav'),'-filter_complex',graph,'-map','[out]','-map','1:a','-t','90','-frames:v','2700','-c:v','libx264','-preset','medium','-crf','18','-pix_fmt','yuv420p','-c:a','aac','-b:a','192k','-movflags','+faststart','-metadata','title=图证 · 90秒真实项目实录',movie]);
  copyFileSync(movie,publishedMovie);
  if(original!==publishedOriginal)copyFileSync(original,publishedOriginal);
  writeFileSync(resolve(out,'edit-plan.json'),JSON.stringify({originalDuration:duration,targetDuration:90,waitingSpeed:speed,segments,captions,actualHttpRequests:summary.actualHttpRequests,policy:'Only waiting is accelerated. Actual actions, errors and results are retained.'},null,2)+'\n');
}
function verify(){
  if(!existsSync(movie)&&existsSync(publishedMovie))copyFileSync(publishedMovie,movie);
  const p=probe(movie,true),v=p.streams.find(s=>s.codec_type==='video'),a=p.streams.find(s=>s.codec_type==='audio');
  assert.equal(v.width,1920);assert.equal(v.height,1080);assert.equal(v.avg_frame_rate,'30/1');assert.equal(Number(v.nb_read_frames),2700);assert.equal(Number(v.duration),90);assert.equal(a.channels,2);
  command('ffmpeg',['-v','error','-i',movie,'-f','null','-']);
  const s=json(resolve(evidence,'summary.json')),r=json(resolve(evidence,'recording.json'));
  const plan=json(existsSync(resolve(out,'edit-plan.json'))?resolve(out,'edit-plan.json'):resolve(evidence,'video-verification.json'));
  const proof={mode:'actual-product-live-recording',video:{width:1920,height:1080,fps:30,frames:2700,duration:90},sha256:hash(movie),bytes:statSync(movie).size,fullDecode:'passed',originalSha256:hash(original),originalDuration:plan.originalDuration,waitingSpeed:plan.waitingSpeed,originalViewport:r.viewport,actualHttpRequests:s.actualHttpRequests,inputTokens:s.inputTokens,outputTokens:s.outputTokens,visionProductHttpStatus:r.visionHttpStatus,sourceProductHttpStatus:r.sourceHttpStatus,cost:null,feeRate:null};
  writeFileSync(resolve(out,'verification.json'),JSON.stringify(proof,null,2)+'\n');
  writeFileSync(resolve(evidence,'video-verification.json'),JSON.stringify(proof,null,2)+'\n');
  console.log(JSON.stringify(proof,null,2));return proof;
}
async function serve(){
  if(!existsSync(movie)&&existsSync(publishedMovie))copyFileSync(publishedMovie,movie);
  if(!existsSync(workingOriginal)&&existsSync(publishedOriginal))copyFileSync(publishedOriginal,workingOriginal);
  if(!existsSync(resolve(out,'verification.json')))verify();
  const types={'.html':'text/html; charset=utf-8','.json':'application/json','.mp4':'video/mp4','.webm':'video/webm','.png':'image/png','.md':'text/plain; charset=utf-8'};
  const server=createServer((req,res)=>{try{
    const part=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    if(part==='/favicon.ico'){res.writeHead(204);res.end();return;}
    const file=resolve(root,'.'+(part==='/'?'/index.html':part));
    if(!file.startsWith(root+sep)||!existsSync(file)||!statSync(file).isFile()){res.writeHead(404);res.end();return;}
    const size=statSync(file).size,range=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range??'');
    const start=range?Number(range[1]):0,end=range?.[2]?Math.min(Number(range[2]),size-1):size-1;
    if(start>=size||end<start){res.writeHead(416);res.end();return;}
    res.writeHead(range?206:200,{'Content-Type':types[extname(file)]??'application/octet-stream','Content-Length':end-start+1,'Accept-Ranges':'bytes','Cache-Control':'no-store',...(range?{'Content-Range':`bytes ${start}-${end}/${size}`}:{})});
    if(req.method==='HEAD'){res.end();return;}const stream=createReadStream(file,{start,end});stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());stream.pipe(res);
  }catch{res.writeHead(400);res.end();}});
  server.listen(0,'127.0.0.1');await once(server,'listening');return{server,url:`http://127.0.0.1:${server.address().port}`};
}
async function inspect(){
  verify();for(const[i,t]of [3,9,24,29,33,58,67,77,84].entries())command('ffmpeg',['-v','error','-y','-ss',String(t),'-i',movie,'-frames:v','1',resolve(out,`real-frame-${i+1}.png`)]);
  command('ffmpeg',['-v','error','-y','-ss','67','-i',movie,'-frames:v','1',resolve(out,'poster.png')]);
  const{server,url}=await serve();let browser;
  try{browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(url);await page.waitForFunction(()=>window.playerReady===true);
    await page.evaluate(()=>{const v=document.querySelector('video');v.muted=true;return v.play();});
    await page.waitForFunction(()=>document.querySelector('video').currentTime>.1,undefined,{timeout:10000});
    const dimensions=await page.evaluate(async()=>{const v=document.querySelector('video');const advanced=v.currentTime>.1;v.pause();await new Promise(r=>{v.addEventListener('seeked',r,{once:true});v.currentTime=74.5;});return{width:v.videoWidth,height:v.videoHeight,duration:v.duration,advanced,seek:v.currentTime};});
    assert.deepEqual(dimensions,{width:1920,height:1080,duration:90,advanced:true,seek:74.5});assert.deepEqual(errors,[]);writeFileSync(resolve(out,'browser-verification.json'),JSON.stringify({dimensions,errors},null,2)+'\n');
  }finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
  console.log('Actual movie playback, seek and complete decode passed.');
}
if(mode==='--render'){encode();await inspect();}else if(mode==='--inspect')await inspect();else if(mode==='--verify')verify();else{const{server,url}=await serve();console.log(`Preview: ${url}`);process.once('SIGINT',()=>server.close());}
