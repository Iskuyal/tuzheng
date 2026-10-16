"""Encode only genuine product recording frames; export a silent 1080p master."""
import hashlib
import json
import subprocess
from pathlib import Path

ROOT=Path(__file__).resolve().parents[3]
OUT=ROOT/'.cache/formal-demo-2026-10-16'
EVIDENCE=ROOT/'docs/evidence/formal-demo-2026-10-16-round1'
TARGET=ROOT/'docs/submission/tuzheng-formal-demo-silent.mp4'
RAW=OUT/'actual-formal-uncut.webm'
RECOVERY=OUT/'actual-recovery-uncut.webm'
if not RAW.exists():RAW=ROOT/'docs/submission/tuzheng-formal-demo-uncut.webm'
if not RECOVERY.exists():RECOVERY=ROOT/'docs/submission/formal-demo/raw-input-recovery.webm'
OUT.mkdir(parents=True,exist_ok=True)
def read(path):return json.loads(path.read_text(encoding='utf-8'))
def call(args):return subprocess.check_output(args,cwd=ROOT,text=True,encoding='utf-8',stderr=subprocess.STDOUT)
def digest(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def clock(value,comma=False):
    ms=round(value*1000)
    return f'{ms//3600000:02}:{ms//60000%60:02}:{ms//1000%60:02}{"," if comma else "."}{ms%1000:03}'
def assclock(value):return clock(value)[:-1].lstrip('0') or '0:00:00.00'
meta=read(EVIDENCE/'recording.json')
assert meta['complete'] and meta['responseFixtures'] is False
probe=json.loads(call(['ffprobe','-v','error','-show_format','-show_streams','-of','json',str(RAW)]))
duration=float(probe['format']['duration'])
video=next(s for s in probe['streams'] if s['codec_type']=='video')
assert video['width']==1920 and video['height']==1080
recovery_probe=json.loads(call(['ffprobe','-v','error','-show_format','-show_streams','-of','json',str(RECOVERY)]))
recovery_duration=float(recovery_probe['format']['duration'])
assert next(s for s in recovery_probe['streams'] if s['codec_type']=='video')['width']==1920
chapters=read(EVIDENCE/'chapters-raw.json');actions=read(EVIDENCE/'actions.json')
offset=chapters[0]['start']
insertion=next(c['start'] for c in chapters if c['id']=='outro')-offset
waits=[];active=None
for row in actions:
    if row['label']=='model-wait-start':active=row
    elif row['label']=='model-wait-end' and active:
        start=max(0,active['time']-offset);end=min(duration,row['time']-offset)
        if end-start>10:waits.append({'start':start,'end':end,'scenario':row['scenario']})
        active=None
# Preserve action speed; only compress true model waits when needed to remain under eight minutes.
speed=1.0
if duration+recovery_duration>470:
    waiting=sum(w['end']-w['start'] for w in waits)
    desired=450-(duration+recovery_duration-waiting)
    assert waiting>0 and desired>0,'Action footage exceeds 7:30; edit genuine action takes explicitly.'
    speed=waiting/desired
segments=[];cursor=0
for wait in waits:
    if wait['start']>cursor:segments.append({'start':cursor,'end':wait['start'],'rate':1})
    segments.append({**wait,'rate':speed});cursor=wait['end']
if cursor<duration:segments.append({'start':cursor,'end':duration,'rate':1})
if not segments:segments=[{'start':0,'end':duration,'rate':1}]
segments[0]['start']=max(segments[0]['start'],.8) # Drop initial blank browser paint, without altering any interaction.
def mapped(time):
    value=0
    for segment in segments:
        if time>=segment['end']:value+=(segment['end']-segment['start'])/segment['rate']
        else:return value+max(0,time-segment['start'])/segment['rate']
    return value
base_segments=segments
segments=[]
inserted=False
for segment in base_segments:
    if segment['start']<=insertion<segment['end']:
        if insertion>segment['start']:segments.append({**segment,'end':insertion})
        segments.append({'input':1,'start':0,'end':recovery_duration,'rate':1,'chapter':'recovery'})
        segments.append({**segment,'start':insertion});inserted=True
    else:segments.append(segment)
assert inserted
def base_mapped(time):
    value=0
    for segment in base_segments:
        if time>=segment['end']:value+=(segment['end']-segment['start'])/segment['rate']
        else:return value+max(0,time-segment['start'])/segment['rate']
    return value
def mapped(time):return base_mapped(time)+(recovery_duration if time>=insertion else 0)
final_duration=base_mapped(duration)+recovery_duration
assert 300<=final_duration<=480,final_duration
timeline=[]
for chapter in chapters:
    if chapter['id']=='outro':timeline.append({'id':'recovery','title':'格式错误与输入恢复','start':base_mapped(insertion),'end':base_mapped(insertion)+recovery_duration,'result':{'modelRequests':0,'recoveryScope':'unsupported format to valid image input'}})
    extra=recovery_duration if chapter['id']=='outro' else 0
    timeline.append({**chapter,'start':base_mapped(max(0,chapter['start']-offset))+extra,
                     'end':base_mapped(min(duration,chapter['end']-offset))+extra})
header='''[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Origin,Microsoft YaHei,18,&H00FFFFFF,&H00FFFFFF,&H702B2416,&H702B2416,0,0,0,0,100,100,0,0,3,6,0,9,22,22,84,1
Style: Chapter,Microsoft YaHei,23,&H00FFFFFF,&H00FFFFFF,&H702B2416,&H702B2416,0,0,0,0,100,100,0,0,3,7,0,1,24,24,22,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
'''
def dialogue(start,end,style,text):
    # ASS uses a one-digit hour; the film is under eight minutes.
    def ts(t):return '0:'+clock(t)[3:-1]
    return f'Dialogue: 0,{ts(start)},{ts(end)},{style},,0,0,0,,{text}\n'
ass=header
for index,chapter in enumerate(timeline,1):
    if chapter['id'] in ['claims','cross','axis']:origin='实机操作录屏\\N预置样例 · 程序计算'
    elif chapter['id']=='recovery':origin='实机操作录屏\\N格式校验 · 无模型请求'
    elif chapter['id'] in ['intro','outro']:origin='实机操作录屏\\N2026-10-16'
    else:origin='实机操作录屏\\NDeepSeek 官方\\N本次真实模型请求'
    ass+=dialogue(chapter['start'],chapter['end'],'Origin',origin)
    ass+=dialogue(chapter['start'],min(chapter['end'],chapter['start']+4),'Chapter',f'{index:02}  {chapter["title"]}')
if speed>1:
    for wait in waits:ass+=dialogue(mapped(wait['start']),mapped(wait['end']),'Chapter',f'真实模型等待加速 {speed:.2f} 倍 · 原等待 {wait["end"]-wait["start"]:.1f} 秒')
(OUT/'labels.ass').write_text(ass,encoding='utf-8')
srt='\n'.join(f'{index}\n{clock(c["start"],True)} --> {clock(c["end"],True)}\n{c["title"]}\n' for index,c in enumerate(timeline,1))
(ROOT/'docs/submission/formal-demo/chapters.srt').write_text(srt,encoding='utf-8')
graph=';'.join(f'[{s.get("input",0)}:v]trim=start={s["start"]}:end={s["end"]},setpts=(PTS-STARTPTS)/{s["rate"]}[v{i}]' for i,s in enumerate(segments))
graph+=';'+''.join(f'[v{i}]' for i in range(len(segments)))+f'concat=n={len(segments)}:v=1:a=0,fps=30,subtitles=filename=.cache/formal-demo-2026-10-16/labels.ass[v]'
subprocess.run(['ffmpeg','-hide_banner','-loglevel','warning','-y','-i',str(RAW),'-i',str(RECOVERY),'-filter_complex',graph,
                '-map','[v]','-an','-c:v','libx264','-preset','veryfast','-crf','18','-threads','4','-pix_fmt','yuv420p',
                '-movflags','+faststart','-metadata','title=图证 · 正式实机演示 · 待后期配音',str(TARGET)],cwd=ROOT,check=True)
subprocess.run(['ffmpeg','-v','error','-i',str(TARGET),'-f','null','-'],cwd=ROOT,check=True)
result=json.loads(call(['ffprobe','-v','error','-count_frames','-show_format','-show_streams','-of','json',str(TARGET)]))
stream=next(s for s in result['streams'] if s['codec_type']=='video')
assert stream['width']==1920 and stream['height']==1080 and stream['avg_frame_rate']=='30/1'
assert not any(s['codec_type']=='audio' for s in result['streams'])
assert 300<=float(result['format']['duration'])<=480
proof={'kind':'formal-video-silent-picture-master','resolution':[1920,1080],'fps':30,
  'frames':int(stream['nb_read_frames']),'seconds':float(result['format']['duration']),
  'audioTracks':0,'fullDecode':'passed','sha256':digest(TARGET),'bytes':TARGET.stat().st_size,
  'rawSha256':digest(RAW),'rawSeconds':duration,'recoveryRawSha256':digest(RECOVERY),'recoveryRawSeconds':recovery_duration,'waitingSpeed':speed,'pictureContent':'Actual browser recording only; source labels and chapter captions are editing overlays.',
  'responseFixtures':False,'voiceover':'pending-user-production','chapters':timeline,'editSegments':segments}
(EVIDENCE/'video-verification.json').write_text(json.dumps(proof,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
for i,c in enumerate(timeline,1):
    t=min(c['end']-.5,c['start']+max(5,(c['end']-c['start'])/2))
    subprocess.run(['ffmpeg','-v','error','-y','-ss',str(t),'-i',str(TARGET),'-frames:v','1',str(OUT/f'check-{i:02}.png')],check=True)
print(json.dumps({k:v for k,v in proof.items() if k not in ['chapters','editSegments']},ensure_ascii=False),flush=True)
