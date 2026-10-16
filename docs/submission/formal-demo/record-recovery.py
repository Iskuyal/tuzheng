"""Supplemental genuine input-validation/recovery take; no model calls."""
import json,time
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
ROOT=Path(__file__).resolve().parents[3]
OUT=ROOT/'.cache/formal-demo-2026-10-16'
EVIDENCE=ROOT/'docs/evidence/formal-demo-2026-10-16-round1'
(OUT/'unsupported.txt').write_text('团队自制非图片文件，仅用于实际格式校验演示。',encoding='utf-8')
with sync_playwright() as p:
 b=p.chromium.launch(channel='msedge',headless=True)
 c=b.new_context(viewport={'width':1920,'height':1080},record_video_dir=str(OUT/'recovery-raw'),record_video_size={'width':1920,'height':1080})
 page=c.new_page();started=time.monotonic();events=[]
 before=c.request.get('http://127.0.0.1:7110/capture/summary').json()['actualHttpRequests']
 page.goto('http://127.0.0.1:7110/audit',wait_until='networkidle');page.wait_for_timeout(1500)
 page.locator('input[type=file]').first.set_input_files(str(OUT/'unsupported.txt'))
 expect(page.locator('.error-message')).to_contain_text('请上传 PNG、JPG 或 WebP 图片。')
 page.locator('.error-message').evaluate("e=>e.scrollIntoView({block:'center',behavior:'smooth'})")
 events.append({'time':round(time.monotonic()-started,3),'label':'actual-format-error'})
 page.wait_for_timeout(7500);page.screenshot(path=str(OUT/'recovery-error.png'))
 page.locator('input[type=file]').first.set_input_files(str(ROOT/'web/public/samples/conflict.png'))
 expect(page.locator('.error-message')).to_have_count(0)
 expect(page.locator('.read-image-button').first).to_be_visible()
 page.locator('.read-image-button').first.evaluate("e=>e.scrollIntoView({block:'center',behavior:'smooth'})")
 events.append({'time':round(time.monotonic()-started,3),'label':'valid-image-input-recovered-no-model-request'})
 page.wait_for_timeout(10000);page.screenshot(path=str(OUT/'recovery-restored.png'))
 after=c.request.get('http://127.0.0.1:7110/capture/summary').json()['actualHttpRequests']
 assert before==after
 video=page.video;c.close();video.save_as(str(OUT/'actual-recovery-uncut.webm'));b.close()
 (EVIDENCE/'recovery-take.json').write_text(json.dumps({'events':events,'viewport':[1920,1080],'modelRequests':0,'durationWallSeconds':time.monotonic()-started,'responseFixtures':False,'recoveryScope':'Client input format error to a valid image input; not an upstream model-error recovery.'},ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
 print('RECOVERY_TAKE_COMPLETE')
