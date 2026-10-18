"""Record native 1080p production browser operations; never intercept responses."""
import argparse
import json
import time
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / '.cache/demo-2026-10-18'
EVIDENCE = ROOT / 'docs/evidence/formal-demo-2026-10-18'
BASE = 'http://127.0.0.1:7118'
parser = argparse.ArgumentParser()
parser.add_argument('--part', required=True, choices=['offline','live'])
args = parser.parse_args()
OUT.mkdir(parents=True, exist_ok=True)
EVIDENCE.mkdir(parents=True, exist_ok=True)
if (EVIDENCE / f'recording-{args.part}.json').exists():
    raise SystemExit('This take is already recorded; preserve it and create a new batch for new calls.')
events, chapters, errors, responses = [], [], [], []
def dump(name, value):
    (EVIDENCE / name).write_text(json.dumps(value, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')

with sync_playwright() as p:
    browser = p.chromium.launch(channel='msedge', headless=True)
    context = browser.new_context(viewport={'width':1920,'height':1080}, device_scale_factor=1,
        record_video_dir=str(OUT / ('raw-'+args.part)), record_video_size={'width':1920,'height':1080})
    page = context.new_page()
    started = time.monotonic()
    page.set_default_timeout(12000)
    page.on('pageerror', lambda error: errors.append(str(error)))
    def elapsed(): return round(time.monotonic()-started, 3)
    def mark(label, **details):
        events.append({'time':elapsed(),'label':label,**details})
        dump(f'actions-{args.part}.json', events)
        print(label, details, flush=True)
    def pause(seconds): page.wait_for_timeout(round(seconds*1000))
    def focus(locator, seconds=2):
        if locator.count() and locator.first.is_visible():
            locator.first.evaluate("el=>el.scrollIntoView({block:'center',behavior:'smooth'})")
            pause(.8)
            box=locator.first.bounding_box()
            if box: page.mouse.move(box['x']+min(40,box['width']/2),box['y']+min(20,box['height']/2),steps=18)
            pause(seconds)
            return True
        return False
    def click(locator, seconds=2):
        focus(locator,.5)
        locator.first.click()
        pause(seconds)
    def goto(route):
        page.goto(BASE+route, wait_until='networkidle')
        # Dismiss the app's route-focus outline using an ordinary mouse interaction.
        page.mouse.click(1860,150)
        pause(.7)
    def chapter(ident, title, minimum, action):
        begin=elapsed()
        mark('chapter-start', id=ident)
        result=action()
        if minimum>elapsed()-begin: pause(minimum-(elapsed()-begin))
        page.screenshot(path=str(OUT / f'{ident}-end.png'))
        chapters.append({'id':ident,'title':title,'start':begin,'end':elapsed(),'rawPart':args.part,'result':result})
        dump(f'chapters-{args.part}.json', chapters)
        mark('chapter-end', id=ident)
    def live(button, endpoint, scenario):
        state=context.request.get(BASE+'/capture/summary').json()
        if state.get('stopReason'): raise RuntimeError('Model batch stopped: '+state['stopReason'])
        assert context.request.post(BASE+'/capture/scenario', data={'name':scenario}).ok
        focus(button,1)
        mark('model-wait-start',scenario=scenario)
        with page.expect_response(lambda r: endpoint in r.url and r.request.method=='POST',timeout=190000) as pending:
            button.first.click()
        response=pending.value
        payload=response.json()
        mark('model-wait-end',scenario=scenario,status=response.status)
        responses.append({'scenario':scenario,'status':response.status,'body':payload})
        dump('browser-product-responses.json',responses)
        if not response.ok:
            focus(page.locator('[role=alert]'),6)
            raise RuntimeError(f'Actual product request failed: {scenario}, HTTP {response.status}')
        pause(1)
        return payload
    def intro():
        goto('/')
        pause(10)
        focus(page.locator('#how-it-works'),7)
        page.evaluate('window.scrollTo({top:0,behavior:"smooth"})')
        pause(6)
        return {'actualProductUI':True,'modelRequests':0}
    def recovery():
        goto('/source-audit')
        bad=OUT/'unsupported-demo.txt'
        bad.write_text('团队自制格式校验材料，不是图片。',encoding='utf-8')
        page.locator('#source-audit-upload').set_input_files(str(bad))
        pause(3)
        assert 'PNG' in page.locator('[role=alert]').inner_text()
        focus(page.locator('[role=alert]'),5)
        page.screenshot(path=str(OUT/'recovery-error.png'))
        page.locator('#source-audit-upload').set_input_files(str(ROOT/'web/public/samples/cpi-2025-12.png'))
        pause(3)
        assert page.locator('.source-image-stage img').is_visible()
        assert page.locator('[role=alert]').count()==0
        focus(page.locator('.source-image-stage'),6)
        return {'modelRequests':0,'errorObserved':True,'validImageRestored':True,'scope':'Client input format only; no upstream model-error claim.'}
    def outro():
        goto('/source-audit?sample=cpi-2025-12')
        click(page.locator('.source-mechanism > summary'),5)
        focus(page.locator('.source-mechanism'),5)
        goto('/')
        pause(6)
        return {'modelRequests':0,'actualProductUI':True}
    def vision():
        goto('/audit')
        page.locator('#chart-upload').set_input_files(str(ROOT/'web/public/samples/conflict.png'))
        pause(2)
        focus(page.locator('.image-stage'),5)
        data=live(page.locator('.read-image-button'),'/api/audit/image','actual-upload-growth')
        focus(page.locator('.model-read'),6)
        form=page.locator('.observation-form')
        if form.count():
            focus(form,5)
            click(form.locator('.confirm-button'),2)
            focus(page.locator('#audit-result'),6)
            number=form.locator('.newer-editor input[type=number]')
            if not number.count(): number=form.locator('.point-editor').nth(1).locator('input[type=number]')
            focus(number,1)
            number.fill('96')
            pause(2)
            click(form.locator('.confirm-button'),1)
            focus(page.locator('#audit-result'),5)
            page.screenshot(path=str(OUT/'vision-edited-96.png'))
            number.fill('100')
            click(form.locator('.confirm-button'),1)
            focus(page.locator('#audit-result'),6)
            return {'actualModelUpload':True,'manualRecalculation':True,'responseKeys':list(data)}
        cards=page.locator('.claim-observation-card')
        assert cards.count()>0,'No usable actual observations; preserve this take.'
        focus(cards.first,5)
        click(cards.first.locator('.confirm-button'),2)
        focus(cards.first.locator('.claim-result-sheet'),8)
        return {'actualModelUpload':True,'groupedClaims':True,'manualRecalculation':False}
    source_data=None
    def source():
        global source_data
        goto('/')
        click(page.get_by_role('link',name='试用 CPI 来源核验样例'),3)
        focus(page.locator('.source-input-grid'),6)
        click(page.get_by_role('button',name='放大查看原图'),4)
        click(page.get_by_role('button',name='关闭',exact=True),1)
        source_data=live(page.get_by_test_id('run-source-audit'),'/api/source-audit/investigate','cpi-caption-basis-mismatch')
        focus(page.get_by_test_id('source-overview'),6)
        focus(page.locator('#source-claims'),6)
        details=page.locator('#source-claims .source-claim-details > summary')
        if details.count(): click(details,4)
        page.screenshot(path=str(OUT/'source-claims.png'))
        result=source_data['investigation']
        return {'states':[row['status'] for row in result['conclusions']], 'hasSuggestion':bool(result.get('captionSuggestion'))}
    def citations():
        focus(page.locator('#source-citations'),6)
        card=page.locator('.source-document-card.is-cited').first
        if card.count():
            focus(card,7)
            toggle=card.locator('details > summary')
            if toggle.count(): click(toggle,5)
        focus(page.locator('#source-library'),3)
        toggle=page.get_by_role('button',name='展开资料库')
        if toggle.count(): click(toggle,4)
        focus(page.locator('.source-library-list'),5)
        return {'actualCitations':True,'fixedLibraryNotOpenWebSearch':True}
    def trace():
        click(page.locator('#source-process > summary'),2)
        focus(page.get_by_test_id('tool-trace'),9)
        items=page.get_by_test_id('tool-trace').locator('li')
        if items.count()>1: focus(items.nth(min(2,items.count()-1)),7)
        focus(page.get_by_test_id('stop-reason'),4)
        stats=page.locator('.source-runtime-details > summary')
        if not stats.count(): stats=page.get_by_text('查看模型与运行统计',exact=True)
        if stats.count(): click(stats,6)
        return {'toolEvents':len(source_data['investigation'].get('trace',[])),'actualProductResponse':True}
    def rewrite():
        suggestion=page.get_by_test_id('caption-suggestion')
        if not suggestion.count():
            focus(page.get_by_test_id('unresolved-items'),12)
            return {'hasSuggestion':False,'adopted':False}
        focus(suggestion,6)
        toggle=suggestion.locator('details > summary').first
        if toggle.count(): click(toggle,4)
        focus(page.get_by_test_id('suggestion-changes'),7)
        button=page.get_by_test_id('adopt-suggestion')
        if button.count() and button.is_enabled():
            click(button,4)
            focus(page.get_by_test_id('adopted-notice'),5)
            focus(page.get_by_test_id('history-section'),5)
            return {'hasSuggestion':True,'adopted':True,'reverified':False}
        return {'hasSuggestion':True,'adopted':False}
    def clarify():
        goto('/source-audit')
        page.locator('#source-audit-upload').set_input_files(str(ROOT/'web/public/samples/cpi-2025-12-yoy.png'))
        page.locator('#source-audit-caption').fill('12 月 CPI 上涨 0.8%。')
        focus(page.locator('#source-audit-caption'),5)
        data=live(page.get_by_test_id('run-source-audit'),'/api/source-audit/investigate','cpi-clarification-before')
        result=data['investigation']
        focus(page.get_by_test_id('source-overview'),4)
        if result.get('clarification'):
            focus(page.get_by_test_id('clarification-block'),7)
            page.get_by_test_id('clarification-answer').fill('同比')
            pause(3)
            after=live(page.get_by_test_id('submit-clarification'),'/api/source-audit/resume','cpi-clarification-resume')
            focus(page.get_by_test_id('supplement-block'),6)
            focus(page.get_by_test_id('conclusion-changes'),7)
            focus(page.locator('#source-claims'),6)
            return {'clarificationAsked':True,'resumed':True,'before':[r['status'] for r in result['conclusions']], 'after':[r['status'] for r in after['investigation']['conclusions']]}
        focus(page.get_by_test_id('stop-reason'),6)
        focus(page.locator('#source-claims'),10)
        focus(page.get_by_test_id('unresolved-items'),8)
        return {'clarificationAsked':False,'resumed':False,'states':[r['status'] for r in result['conclusions']]}

    completed=False
    try:
        if args.part=='offline':
            for entry in [('intro','从截图出发，看见依据',30,intro),('recovery','错误输入与恢复',25,recovery),('outro','让结论有据可查',20,outro)]: chapter(*entry)
        else:
            ready=context.request.get(BASE+'/capture/ready').json()
            assert ready['ready'],'Official configuration is not ready; no model call was made.'
            armed=context.request.post(BASE+'/capture/arm')
            assert armed.ok,armed.text()
            for entry in [('vision','实际上传、模型读数与人工核对',70,vision),('source','图文主张与来源判断',70,source),('citations','可追溯引用与资料范围',40,citations),('trace','实际工具调用与停止边界',45,trace),('rewrite','逐处修改与旧结果失效',40,rewrite),('clarify','必要追问、补证与恢复',70,clarify)]: chapter(*entry)
            final=context.request.post(BASE+'/capture/complete')
            assert final.ok
        completed=True
    finally:
        dump(f'browser-errors-{args.part}.json',errors)
        page.screenshot(path=str(OUT/f'last-{args.part}.png'))
        video=page.video
        context.close()
        target=ROOT/'docs/submission/demo-2026-10-18'/f'raw-{args.part}.webm'
        video.save_as(str(target))
        browser.close()
        dump(f'recording-{args.part}.json',{'complete':completed,'rawFile':str(target.relative_to(ROOT)), 'durationWallSeconds':elapsed(),
          'viewport':[1920,1080], 'responseFixtures':False,'browser':'System Edge, headless, Playwright actions', 'pageErrors':errors,
          'pictureSource':'Actual current production Vue browser viewport, no generated interface or substituted responses.'})
    print('COMPLETE',args.part,flush=True)
