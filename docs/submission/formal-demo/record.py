"""Record the actual production UI at native 1080p. No response fixtures or routes."""
import json
import time
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / '.cache/formal-demo-2026-10-16'
EVIDENCE = ROOT / 'docs/evidence/formal-demo-2026-10-16-round1'
OUT.mkdir(parents=True, exist_ok=True)
BASE = 'http://127.0.0.1:7110'
marks, chapters, errors, product_responses = [], [], [], []
started = time.monotonic()
def dump(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
def elapsed(): return round(time.monotonic() - started, 3)
def mark(label, **details):
    marks.append({'time': elapsed(), 'label': label, **details})
    dump(EVIDENCE / 'actions.json', marks)
    print(label, flush=True)

with sync_playwright() as p:
    browser = p.chromium.launch(channel='msedge', headless=True)
    context = browser.new_context(viewport={'width':1920,'height':1080}, device_scale_factor=1,
                                  record_video_dir=str(OUT/'raw'),record_video_size={'width':1920,'height':1080})
    page = context.new_page()
    page.set_default_timeout(12000)
    page.on('pageerror', lambda error: errors.append(str(error)))
    def pause(seconds): page.wait_for_timeout(round(seconds * 1000))
    def focus(locator, hold=2):
        locator = locator.first
        if locator.count():
            locator.evaluate("el=>el.scrollIntoView({block:'center',behavior:'smooth'})")
            pause(.9)
            box=locator.bounding_box()
            if box: page.mouse.move(box['x']+min(30,box['width']/2),box['y']+min(20,box['height']/2),steps=20)
            pause(hold)
    def click(locator, hold=2):
        focus(locator, .6); locator.first.click(); pause(hold)
    def goto(path):
        page.goto(BASE+path,wait_until='networkidle'); pause(1)
    def shot(label): page.screenshot(path=str(OUT/(label+'.png')))
    def chapter(name, title, minimum, action):
        began=elapsed();mark('chapter-start',chapter=name,title=title)
        result=action()
        remaining=minimum-(elapsed()-began)
        if remaining>0: pause(remaining)
        shot(name)
        chapters.append({'id':name,'title':title,'start':began,'end':elapsed(),'result':result})
        dump(EVIDENCE/'chapters-raw.json',chapters)
        mark('chapter-end',chapter=name)
    def scenario(name):
        response=context.request.post(BASE+'/capture/scenario',data={'name':name})
        assert response.ok
    def live_post(button, path, name):
        summary=context.request.get(BASE+'/capture/summary').json()
        if summary.get('stopReason'):
            mark('model-call-skipped',scenario=name,reason=summary['stopReason']);return None
        scenario(name);focus(button,.7);mark('model-wait-start',scenario=name)
        with page.expect_response(lambda r: path in r.url and r.request.method=='POST',timeout=185000) as waiting:
            button.first.click()
        response=waiting.value;data=response.json()
        mark('model-wait-end',scenario=name,status=response.status)
        product_responses.append({'scenario':name,'status':response.status,'body':data})
        dump(EVIDENCE/'browser-product-responses.json',product_responses)
        pause(2)
        return data if response.ok else None
    def source_input(image, caption):
        goto('/source-audit')
        page.locator('#source-audit-upload').set_input_files(str(ROOT/'web/public/samples'/image))
        page.locator('#source-audit-caption').fill(caption)
        focus(page.locator('.source-input-grid'),2)
    def source_result(data, hold=3):
        if data is None:
            focus(page.locator('[role=alert]'),6);return None
        focus(page.locator('#source-result-title'),hold)
        cards=page.locator('.source-claim-card')
        if cards.count():
            summary=cards.first.locator('summary')
            if summary.count(): click(summary,hold)
        return data.get('investigation',{})

    def intro():
        goto('/');focus(page.get_by_role('heading',name='图表与配文，有来源支持吗？'),5)
        page.mouse.wheel(0,450);pause(4);page.mouse.wheel(0,-450);pause(3)
    def vision():
        goto('/audit');page.locator('input[type=file]').first.set_input_files(str(ROOT/'web/public/samples/conflict.png'))
        pause(2);focus(page.locator('.image-stage'),3)
        data=live_post(page.locator('.read-image-button').first,'/api/audit/image','growth-image')
        if data:
            focus(page.locator('.model-read'),4)
            form=page.locator('.observation-form')
            if form.count():
                focus(form,4);click(form.locator('.confirm-button'),2);focus(page.locator('.result-sheet'),5)
                point=form.locator('.newer-editor input[type=number]')
                focus(point,1);point.fill('96');pause(2);click(form.locator('.confirm-button'),1);focus(page.locator('.result-sheet'),4)
                point.fill('100');click(form.locator('.confirm-button'),1);focus(page.locator('.result-sheet'),4)
        else: focus(page.locator('.error-message'),7)
        return {'actualUploadModelSucceeded':data is not None}
    def claims():
        goto('/audit?sample=multi-claims')
        cards=page.locator('.claim-observation-card');assert cards.count()==3
        focus(cards.nth(0),2);click(cards.nth(0).locator('.confirm-button'),2)
        click(cards.nth(1).locator('summary').first,1)
        points=cards.nth(1).locator('.claim-observation-point')
        focus(points.nth(1),1);points.nth(1).get_by_label('核对数值').fill('100');pause(2)
        click(cards.nth(1).locator('.confirm-button'),2);focus(cards.nth(1).locator('.claim-result-sheet'),3)
        click(cards.nth(1).locator('.claim-audit-log summary'),2)
        click(cards.nth(2).locator('summary').first,1)
        cards.nth(2).locator('.claim-observation-point').nth(1).get_by_label('核对数值').fill('60')
        click(cards.nth(2).locator('.confirm-button'),1);focus(cards.nth(2).locator('.claim-result-sheet'),4)
        return {'inputOrigin':'explicitly-labelled-preset-sample','modelRequests':0}
    def cpi():
        goto('/source-audit');click(page.get_by_test_id('load-source-sample'),2)
        focus(page.locator('#source-audit-caption'),3)
        data=live_post(page.get_by_test_id('run-source-audit'),'/api/source-audit/investigate','cpi-basis-mismatch')
        result=source_result(data,6)
        if result is not None:
            details=page.locator('.source-library-details')
            if details.count():click(details.locator('summary'),3)
            citation=page.locator('.source-hit,.source-citation,.source-evidence').first
            focus(citation,4)
            click(page.get_by_text('查看工具轨迹与调用预算',exact=True),1)
            focus(page.get_by_test_id('tool-trace'),6)
            focus(page.get_by_test_id('caption-suggestion'),5)
            if page.get_by_test_id('adopt-suggestion').count():
                click(page.get_by_test_id('adopt-suggestion'),2)
                focus(page.get_by_test_id('adopted-notice'),3);focus(page.get_by_test_id('history-section'),4)
        return {'states':[row.get('status') for row in (result or {}).get('conclusions',[])],'hasSuggestion':bool((result or {}).get('captionSuggestion'))}
    def inference():
        source_input('cpi-2026-07-08-yoy-trend.png','8 月 CPI 比上月便宜。')
        data=live_post(page.get_by_test_id('run-source-audit'),'/api/source-audit/investigate','cpi-inference')
        result=source_result(data,6)
        if result is not None:focus(page.locator('.source-claims,.source-results').first,6);focus(page.get_by_test_id('unresolved-items'),4)
        return {'hasResult':result is not None}
    def clarify():
        source_input('cpi-2025-12-yoy.png','12 月 CPI 上涨 0.8%。')
        data=live_post(page.get_by_test_id('run-source-audit'),'/api/source-audit/investigate','cpi-clarify-before')
        result=source_result(data,4)
        if result and result.get('clarification'):
            focus(page.get_by_test_id('clarification-block'),5)
            page.get_by_test_id('clarification-answer').fill('同比');pause(3)
            continued=live_post(page.get_by_test_id('submit-clarification'),'/api/source-audit/resume','cpi-clarify-resume')
            source_result(continued,5);focus(page.get_by_test_id('supplement-block'),5);focus(page.get_by_test_id('conclusion-changes'),5)
            return {'clarificationRequested':True,'resumeSucceeded':continued is not None}
        if result is not None:focus(page.get_by_test_id('stop-reason'),6)
        return {'clarificationRequested':False,'resumeSucceeded':False}
    def rewrite():
        source_input('cpi-2025-12-yoy.png','2025 年 12 月 CPI 同比上涨 0.2%，2026 年 5 月 CPI 比上月上涨 0.1%。')
        data=live_post(page.get_by_test_id('run-source-audit'),'/api/source-audit/investigate','cpi-rewrite-and-qualify')
        result=source_result(data,4)
        if result is not None:
            focus(page.get_by_test_id('caption-suggestion'),6);focus(page.get_by_test_id('suggestion-changes'),5)
            if page.get_by_test_id('adopt-suggestion').count():
                click(page.get_by_test_id('adopt-suggestion'),3);focus(page.get_by_test_id('adopted-notice'),3)
                page.locator('#source-audit-caption').fill('2025 年 12 月 CPI 同比上涨 0.8%。');pause(3)
                focus(page.get_by_test_id('history-section'),5)
        return {'hasSuggestion':bool((result or {}).get('captionSuggestion')),'reverifiedAfterEdit':False}
    def cross():
        goto('/audit?sample=cross-a-revenue')
        box=page.locator('.cross-section');focus(box,2)
        box.locator('select').first.select_option('cross-b-conflict');pause(3)
        focus(box.locator('.cross-element'),4)
        click(box.locator('.cross-side-note .cross-confirm-button'),2)
        click(page.locator('.observation-form .confirm-button'),2)
        focus(page.locator('.cross-result'),5)
        box.locator('.cross-swap select').select_option('cross-b-scope-mismatch');pause(2)
        focus(box.locator('.cross-gate'),5)
        return {'inputOrigin':'explicitly-labelled-preset-samples','modelRequests':0}
    def axis():
        goto('/audit?sample=axis-truncated');click(page.locator('.observation-form .confirm-button'),2)
        focus(page.locator('.axis-section'),8)
        goto('/audit?sample=axis-unknown-start');click(page.locator('.observation-form .confirm-button'),2)
        focus(page.locator('.axis-section'),3);page.locator('.axis-input input').fill('80')
        click(page.locator('.axis-input button').first,2);focus(page.locator('.axis-section'),5)
        return {'inputOrigin':'explicitly-labelled-preset-samples','modelRequests':0}
    def outro():
        goto('/source-audit');click(page.get_by_test_id('load-source-sample'),2)
        mechanism=page.locator('.source-mechanism-details')
        if mechanism.count():click(mechanism.locator('summary'),3)
        focus(page.locator('.source-input-grid'),4);page.evaluate('window.scrollTo({top:0,behavior:"smooth"})');pause(3)
        return {'currentInputHasNotBeenReverified':True}

    completed=False
    try:
        for args in [('intro','从截图开始',18,intro),('vision','实际上传与模型读数',45,vision),
          ('claims','人工更正与缺证据',35,claims),('source','来源核验与实际工具轨迹',65,cpi),
          ('inference','数字与推断分开核对',35,inference),('clarify','追问口径与恢复调查',60,clarify),
          ('rewrite','带引用改写与失效',45,rewrite),('cross','跨图口径与冲突',35,cross),
          ('axis','纵轴风险与对照',30,axis),('outro','证据范围与下一步',17,outro)]:chapter(*args)
        response=context.request.post(BASE+'/capture/complete');assert response.ok
        dump(EVIDENCE/'summary.json',response.json())
        completed=True
    finally:
        dump(EVIDENCE/'browser-errors.json',errors)
        video=page.video;context.close();video.save_as(str(OUT/'actual-formal-uncut.webm'));browser.close()
        dump(EVIDENCE/'recording.json',{'complete':completed,'durationWallSeconds':elapsed(),'viewport':[1920,1080],
          'rawFile':'.cache/formal-demo-2026-10-16/actual-formal-uncut.webm','responseFixtures':False,'browserHeadless':True,
          'sourceOfAllFrames':'Actual production Vue browser viewport; no generated interface or inserted results.'})
    print('RECORDING_COMPLETE',flush=True)
