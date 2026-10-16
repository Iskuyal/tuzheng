"""Check the delivered video's actual badge pixels, rather than trusting subtitle syntax."""
import argparse
import hashlib
import json
import subprocess
from pathlib import Path
from PIL import Image

ROOT=Path(__file__).resolve().parents[3]
parser=argparse.ArgumentParser()
parser.add_argument('--video',type=Path,default=ROOT/'docs/submission/tuzheng-formal-demo-silent.mp4')
parser.add_argument('--output',type=Path,default=ROOT/'.cache/formal-demo-2026-10-16/origin-label-check')
args=parser.parse_args()
args.output.mkdir(parents=True,exist_ok=True)
timeline=json.loads((ROOT/'docs/evidence/formal-demo-2026-10-16-round1/video-verification.json').read_text(encoding='utf-8'))['chapters']
checks=[]
samples=[(chapter,phase,time) for chapter in timeline for phase,time in [
    ('start',chapter['start']+.5),('middle',(chapter['start']+chapter['end'])/2),('end',chapter['end']-.5)]]
for chapter,phase,time in samples:
    target=args.output/(chapter['id']+'-'+phase+'.png')
    subprocess.run(['ffmpeg','-v','error','-y','-ss',str(time),'-i',str(args.video),
                    '-vf','crop=276:160:1640:70','-frames:v','1',str(target)],check=True)
    pixels=Image.open(target).convert('RGB')
    glyphs=[]
    for y in range(pixels.height):
        # Locate the dark badge backing on each row, excluding the light product-page background.
        backing=[x for x in range(270) if max(pixels.getpixel((x,y)))<180]
        if len(backing)<30:continue
        for x in range(min(backing),max(backing)+1):
            color=pixels.getpixel((x,y))
            if min(color)>=210 and max(color)-min(color)<=8:glyphs.append((x,y))
    bounds=None
    if glyphs:
        xs,ys=zip(*glyphs);bounds=[min(xs),min(ys),max(xs)+1,max(ys)+1]
    # A single legible 20px line must fit in 24px, with its entire text inside the right margin.
    passed=bool(bounds and len(glyphs)>60 and bounds[3]-bounds[1]<=24 and bounds[2]-bounds[0]<=275)
    checks.append({'chapter':chapter['id'],'sample':phase,'time':time,'textBoundsInCrop':bounds,'legibleGlyphPixels':len(glyphs),
                   'textHeight':bounds[3]-bounds[1] if bounds else None,'passed':passed})
    print(chapter['id'],phase,'PASS' if passed else 'FAIL',f'textHeight={checks[-1]["textHeight"]}',flush=True)
proof={'kind':'actual-encoded-origin-label-regression','video':str(args.video),
       'videoSha256':hashlib.sha256(args.video.read_bytes()).hexdigest(),
       'criterion':'One visible text line, at most 24px tall and 275px wide, inside the reserved right margin.',
       'passed':all(check['passed'] for check in checks),'checks':checks}
(args.output/'report.json').write_text(json.dumps(proof,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
if not proof['passed']:raise SystemExit(1)
