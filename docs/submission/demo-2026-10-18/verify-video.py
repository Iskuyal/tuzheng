"""Verify decoding, visible origin badges, and actual Edge playback of the MP4."""
import hashlib
import json
import subprocess
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[3]
EVIDENCE=ROOT/'docs/evidence/formal-demo-2026-10-18'
CACHE=ROOT/'.cache/demo-2026-10-18'
meta=json.loads((EVIDENCE/'video-verification.json').read_text(encoding='utf-8'))
video=ROOT/meta['path']
assert hashlib.sha256(video.read_bytes()).hexdigest()==meta['sha256']
checks=[]
for c in meta['chapters']:
    for phase in ['start','middle','end']:
        frame=Image.open(CACHE/f'check-{c["index"]:02}-{phase}.png').convert('RGB')
        badge=frame.crop((1625,70,1916,170))
        # Detect bright glyphs on the dark, single-line badge in the actual encoded pixels.
        glyphs=[]
        for y in range(badge.height):
            # Only measure white pixels inside the badge's dark backing. The initial
            # broad bright-pixel crop also counted light page surfaces and video edges.
            backing=[x for x in range(badge.width) if max(badge.getpixel((x,y)))<180]
            if len(backing)<30:
                continue
            for x in range(min(backing),max(backing)+1):
                r,g,b=badge.getpixel((x,y))
                if min(r,g,b)>210 and max(r,g,b)-min(r,g,b)<15:
                    glyphs.append((x,y))
        bounds=None
        if glyphs:
            xs,ys=zip(*glyphs)
            bounds=[min(xs),min(ys),max(xs)+1,max(ys)+1]
        passed=bool(bounds and len(glyphs)>60 and bounds[3]-bounds[1]<=26 and bounds[2]-bounds[0]<285)
        checks.append({'chapter':c['id'],'phase':phase,'glyphPixels':len(glyphs),'bounds':bounds,'passed':passed})
        badge.save(CACHE/f'badge-{c["index"]:02}-{phase}.png')
font=ImageFont.truetype('C:/Windows/Fonts/msyh.ttc',20)
sheet=Image.new('RGB',(1440,3*310),(233,227,215))
draw=ImageDraw.Draw(sheet)
for i,c in enumerate(meta['chapters']):
    frame=Image.open(CACHE/f'check-{c["index"]:02}-middle.png').convert('RGB')
    frame.thumbnail((480,270))
    x,y=(i%3)*480,(i//3)*310
    sheet.paste(frame,(x,y))
    draw.text((x+8,y+276),f'{c["index"]:02}  {c["title"]}',font=font,fill=(42,51,78))
sheet.save(EVIDENCE/'contact-sheet.jpg',quality=92)
errors=[]
with sync_playwright() as p:
    browser=p.chromium.launch(channel='msedge',headless=True)
    page=browser.new_page(viewport={'width':1920,'height':1080})
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto(video.as_uri(),wait_until='load')
    page.wait_for_function('!!document.querySelector("video") && document.querySelector("video").readyState>=2')
    dimensions=page.locator('video').evaluate('v=>({width:v.videoWidth,height:v.videoHeight,duration:v.duration})')
    assert (dimensions['width'],dimensions['height'])==(1920,1080)
    page.locator('video').evaluate('async v=>{v.muted=true; await v.play()}')
    page.wait_for_timeout(1500)
    advanced=page.locator('video').evaluate('v=>v.currentTime')
    assert advanced>.5
    seeks=[]
    for c in meta['chapters']:
        point=(c['start']+c['end'])/2
        page.locator('video').evaluate('(v,t)=>{v.pause();v.currentTime=t}',point)
        page.wait_for_function('(t)=>{const v=document.querySelector("video");return !v.seeking && v.readyState>=2 && Math.abs(v.currentTime-t)<.2}',arg=point)
        seeks.append({'chapter':c['id'],'target':point,'passed':True})
    browser.close()
proof={'videoSha256':meta['sha256'],'originBadges':checks,'allBadgesPassed':all(row['passed'] for row in checks),
  'badgeCriterion':'Bright glyphs inside the actual dark backing, in the reserved right margin; single line <=26px high and <285px wide.',
  'browser':'System Edge headless','dimensions':dimensions,'playbackAdvancedSeconds':advanced,'seeks':seeks,'pageErrors':errors,
  'voiceover':'Not present: user will record it later.','visualReview':'Contact sheet and selected full-resolution frames require agent inspection.'}
(EVIDENCE/'browser-and-label-verification.json').write_text(json.dumps(proof,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({k:v for k,v in proof.items() if k not in ['originBadges','seeks']},ensure_ascii=False))
assert proof['allBadgesPassed'] and not errors
