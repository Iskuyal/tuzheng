"""Encode genuine browser takes, with chapter labels and a frame-derived timeline."""
import hashlib
import json
import subprocess
from pathlib import Path

ROOT=Path(__file__).resolve().parents[3]
PROJECT=ROOT/'docs/submission/demo-2026-10-18'
EVIDENCE=ROOT/'docs/evidence/formal-demo-2026-10-18'
CACHE=ROOT/'.cache/demo-2026-10-18'
TARGET=ROOT/'docs/submission/tuzheng-competition-demo-2026-10-18-silent.mp4'
ORDER=['intro','vision','source','citations','trace','rewrite','clarify','recovery','outro']
CACHE.mkdir(parents=True,exist_ok=True)
def read(path): return json.loads(path.read_text(encoding='utf-8'))
def write(path,value): path.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
def call(command): return subprocess.check_output(command,cwd=ROOT,text=True,encoding='utf-8',stderr=subprocess.STDOUT)
def probe(path): return json.loads(call(['ffprobe','-v','error','-count_frames','-show_streams','-show_format','-of','json',str(path)]))
def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()
def stamp(seconds,comma=False):
    ms=round(seconds*1000)
    return f'{ms//3600000:02}:{ms//60000%60:02}:{ms//1000%60:02}{"," if comma else "."}{ms%1000:03}'
STYLE='''[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Origin,Microsoft YaHei,20,&H00FFFFFF,&H00FFFFFF,&H202D2830,&H202D2830,-1,0,0,0,100,100,0,0,3,6,0,9,24,24,106,1
Style: Chapter,Microsoft YaHei,24,&H00FFFFFF,&H00FFFFFF,&H202D2830,&H202D2830,0,0,0,0,100,100,0,0,3,7,0,1,24,24,26,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
'''
def ass_time(seconds): return '0:'+stamp(seconds)[3:-1]
def dialogue(start,end,style,text): return f'Dialogue: 0,{ass_time(start)},{ass_time(end)},{style},,0,0,0,,{text}\n'

chapters={}
for part in ['offline','live']:
    meta=read(EVIDENCE/f'recording-{part}.json')
    assert meta['complete'] and meta['responseFixtures'] is False and not meta['pageErrors'],meta
    for chapter in read(EVIDENCE/f'chapters-{part}.json'): chapters[chapter['id']]=chapter
raws={part:PROJECT/f'raw-{part}.webm' for part in ['offline','live']}
raw_probes={part:probe(path) for part,path in raws.items()}
for value in raw_probes.values():
    stream=next(s for s in value['streams'] if s['codec_type']=='video')
    assert (stream['width'],stream['height'])==(1920,1080)

timeline=[]
frames_total=0
for index,ident in enumerate(ORDER,1):
    chapter=dict(chapters[ident])
    # Drop the initial blank paint before the intro only; preserve native action/wait speed.
    start=chapter['start']+(1.2 if ident=='intro' else 0)
    end=min(chapter['end'],float(raw_probes[chapter['rawPart']]['format']['duration']))
    if ident=='clarify' and not chapter['result'].get('clarificationAsked'):
        chapter['title']='口径不明时保留待核对'
        # The actual take ended with a static unresolved-items hold; shorten that hold only.
        end-=12
    seconds=end-start
    origin='DeepSeek 官方 · 本次实录' if chapter['rawPart']=='live' else '实机操作 · 无模型请求'
    ass=STYLE+dialogue(0,seconds,'Origin',origin)+dialogue(0,min(4,seconds),'Chapter',f'{index:02}  {chapter["title"]}')
    assfile=CACHE/f'{index:02}-{ident}.ass'
    assfile.write_text(ass,encoding='utf-8')
    segment=CACHE/f'{index:02}-{ident}.mp4'
    relative_ass=assfile.relative_to(ROOT).as_posix()
    command=['ffmpeg','-hide_banner','-loglevel','warning','-y','-ss',str(start),'-i',str(raws[chapter['rawPart']]),
      '-t',str(seconds),'-vf',f'fps=30,subtitles=filename={relative_ass}', '-an','-c:v','libx264','-preset','veryfast','-crf','18','-threads','4','-pix_fmt','yuv420p','-movflags','+faststart',str(segment)]
    subprocess.run(command,cwd=ROOT,check=True)
    segment_probe=probe(segment)
    video=next(s for s in segment_probe['streams'] if s['codec_type']=='video')
    frames=int(video['nb_read_frames'])
    timeline.append({**chapter,'index':index,'start':frames_total/30,'end':(frames_total+frames)/30,
      'frames':frames,'rawStart':start,'rawEnd':end,'playbackRate':1,'originLabel':origin,'segment':str(segment.relative_to(ROOT))})
    frames_total+=frames
    print('ENCODED',ident,frames/30,flush=True)
assert 300<=frames_total/30<=480,('Edit required, do not silently speed up actions.',frames_total/30)
concat=CACHE/'concat.txt'
concat.write_text(''.join("file '"+(ROOT/c['segment']).as_posix()+"'\n" for c in timeline),encoding='utf-8')
metadata=CACHE/'chapters.ffmeta'
metadata.write_text(';FFMETADATA1\ntitle=图证 · 赛事演示 · 2026-10-18 · 待配音\n'+''.join(
    f'[CHAPTER]\nTIMEBASE=1/30\nSTART={round(c["start"]*30)}\nEND={round(c["end"]*30)}\ntitle={c["title"]}\n' for c in timeline),encoding='utf-8')
subprocess.run(['ffmpeg','-hide_banner','-loglevel','warning','-y','-f','concat','-safe','0','-i',str(concat),'-i',str(metadata),
    '-map','0:v:0','-map_metadata','1','-map_chapters','1','-c:v','copy','-an','-movflags','+faststart',str(TARGET)],cwd=ROOT,check=True)
subprocess.run(['ffmpeg','-v','error','-i',str(TARGET),'-f','null','-'],cwd=ROOT,check=True)
final=probe(TARGET)
video=next(s for s in final['streams'] if s['codec_type']=='video')
assert video['width']==1920 and video['height']==1080 and video['avg_frame_rate']=='30/1'
assert int(video['nb_read_frames'])==frames_total
assert not any(s['codec_type']=='audio' for s in final['streams'])
verification={'kind':'current-production-UI-silent-competition-video','path':str(TARGET.relative_to(ROOT)),
  'seconds':frames_total/30,'frames':frames_total,'resolution':[1920,1080],'fps':30,'codec':'h264','pixelFormat':'yuv420p','audioTracks':0,
  'bytes':TARGET.stat().st_size,'sha256':sha(TARGET),'fullDecode':'passed','voiceover':'pending-user',
  'responseFixtures':False,'oldVideoReused':False,'playbackRate':1,'chapters':timeline,
  'raw':{part:{'path':str(path.relative_to(ROOT)),'sha256':sha(path),'seconds':float(raw_probes[part]['format']['duration'])} for part,path in raws.items()}}
write(EVIDENCE/'video-verification.json',verification)
(PROJECT/'chapters.srt').write_text('\n'.join(f'{i}\n{stamp(c["start"],True)} --> {stamp(c["end"],True)}\n{c["title"]}\n' for i,c in enumerate(timeline,1)),encoding='utf-8')
for c in timeline:
    for phase,t in [('start',c['start']+2),('middle',(c['start']+c['end'])/2),('end',c['end']-2)]:
        subprocess.run(['ffmpeg','-v','error','-y','-ss',str(t),'-i',str(TARGET),'-frames:v','1',str(CACHE/f'check-{c["index"]:02}-{phase}.png')],check=True)
print(json.dumps({key:value for key,value in verification.items() if key not in ['chapters','raw']},ensure_ascii=False),flush=True)
