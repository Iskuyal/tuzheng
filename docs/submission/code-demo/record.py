"""Record the actual Vue UI and live product API. No page.route or fixture replies."""
import json
import time
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / 'docs/submission/code-demo/output'
EVIDENCE = ROOT / 'docs/evidence/product-live-demo-2026-10-13'
OUT.mkdir(parents=True, exist_ok=True)
marks = []
errors = []

with sync_playwright() as p:
    browser = p.chromium.launch(channel='msedge', headless=True)
    context = browser.new_context(viewport={'width': 1280, 'height': 720}, device_scale_factor=1,
                                  record_video_dir=str(OUT / 'raw'), record_video_size={'width': 1280, 'height': 720})
    page = context.new_page()
    page.on('pageerror', lambda error: errors.append(str(error)))
    began = time.monotonic()

    def mark(label, caption):
        marks.append({'time': round(time.monotonic() - began, 3), 'label': label, 'caption': caption})
        (EVIDENCE / 'actions.json').write_text(json.dumps(marks, ensure_ascii=False, indent=2), encoding='utf-8')
        print(label, flush=True)

    def shot(name):
        page.screenshot(path=str(OUT / (name + '.png')), full_page=False)

    def focus(locator):
        locator.evaluate("el => el.scrollIntoView({block:'center',behavior:'smooth'})")
        page.wait_for_timeout(800)

    page.goto('http://127.0.0.1:7109', wait_until='networkidle')
    mark('landing', '图证：实际项目页面与真实操作实录。')
    shot('actual-landing')
    page.wait_for_timeout(3500)
    page.locator('#landing-upload').set_input_files(str(ROOT / 'web/public/samples/conflict.png'))
    page.wait_for_url('**/audit')
    page.wait_for_load_state('networkidle')
    mark('upload', '上传项目自制图：2024 年 80 万元，2025 年 100 万元，标题写增长 40%。')
    shot('actual-upload')
    page.wait_for_timeout(2000)
    read_button = page.locator('.read-image-button').first
    focus(read_button)
    mark('vision-request', '点击读取图片，向当前配置的模型发起真实请求。')
    with page.expect_response(lambda response: '/api/audit/image' in response.url and response.request.method == 'POST', timeout=80000) as pending:
        read_button.click()
    vision_response = pending.value
    vision = vision_response.json()
    (EVIDENCE / 'vision-result.json').write_text(json.dumps(vision, ensure_ascii=False, indent=2), encoding='utf-8')
    if vision_response.ok:
        mark('vision-result', '模型读数已实际返回；先检查读数和出处，再确认计算。')
        focus(page.locator('.model-read'))
        shot('actual-model-observation')
        page.wait_for_timeout(4000)
        confirm = page.locator('.confirm-button').first
        focus(confirm)
        mark('confirm', '在真实工作台确认观察值，由项目程序计算增长率。')
        with page.expect_response(lambda response: '/api/audit/check' in response.url and response.request.method == 'POST', timeout=15000):
            confirm.click()
        focus(page.locator('.result-sheet').first)
        shot('actual-growth-result')
        page.wait_for_timeout(6000)
    else:
        mark('vision-failed', '这次模型读取失败；页面显示实际错误，不用预置结果代替。')
        shot('actual-vision-error')
        page.wait_for_timeout(5000)

    page.get_by_role('link', name='来源核验', exact=True).click()
    page.wait_for_load_state('networkidle')
    page.get_by_test_id('load-source-sample').click()
    page.get_by_text('当前图片：').wait_for()
    page.wait_for_timeout(1200)
    mark('source-input', '载入项目自制 CPI 图与配文；此时尚未开始核验。')
    shot('actual-source-input')
    page.wait_for_timeout(4000)
    run = page.get_by_test_id('run-source-audit')
    focus(run)
    mark('source-request', '运行真实来源核验：模型选择工具，程序检索固定资料库。')
    with page.expect_response(lambda response: '/api/source-audit/investigate' in response.url and response.request.method == 'POST', timeout=200000) as pending:
        run.click()
    source_response = pending.value
    source = source_response.json()
    (EVIDENCE / 'source-result.json').write_text(json.dumps(source, ensure_ascii=False, indent=2), encoding='utf-8')
    if source_response.ok:
        mark('source-result', '下面是这次真实返回的逐条结论，缺口和停止原因同样保留。')
        focus(page.locator('#source-result-title'))
        shot('actual-source-result')
        page.wait_for_timeout(6000)
        result = source.get('investigation', {})
        trace = page.get_by_text('查看工具轨迹与调用预算', exact=True)
        focus(trace)
        trace.click()
        mark('tools', '展开当次工具轨迹，查看实际检索、比较及停止原因。')
        focus(page.get_by_test_id('tool-trace'))
        shot('actual-tool-trace')
        page.wait_for_timeout(4500)
        if result.get('captionSuggestion'):
            suggestion = page.get_by_test_id('adopt-suggestion')
            focus(suggestion)
            mark('suggestion', '查看这次建议及其依据，由用户显式选择采用。')
            shot('actual-suggestion')
            page.wait_for_timeout(4500)
            suggestion.click()
            mark('adopt', '实际点击采用：配文更新，旧结果转为历史，提示重新核验。')
            focus(page.get_by_test_id('adopted-notice'))
            shot('actual-adopted')
            page.wait_for_timeout(4500)
            history = page.locator('.source-history')
            if history.count():
                focus(history)
                shot('actual-history')
        else:
            mark('no-suggestion', '本次没有可采用的修改建议，保留实际停止状态。')
    else:
        mark('source-failed', '这次来源核验失败，保留页面实际错误和原始请求记录。')
        shot('actual-source-error')
        page.wait_for_timeout(6000)
    summary = context.request.get('http://127.0.0.1:7109/capture/summary').json()
    (EVIDENCE / 'summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding='utf-8')
    mark('end', f"实录结束：实际模型 HTTP 请求 {summary['actualHttpRequests']} 次；金额与费率未知。")
    # Keep the final genuine page visible; padding is a held real frame, not a new result.
    while time.monotonic() - began < 91:
        page.wait_for_timeout(500)
    (EVIDENCE / 'browser-errors.json').write_text(json.dumps(errors, ensure_ascii=False, indent=2), encoding='utf-8')
    video = page.video
    context.close()
    video.save_as(str(OUT / 'actual-product-uncut.webm'))
    browser.close()
    (EVIDENCE / 'recording.json').write_text(json.dumps({'durationWallSeconds': time.monotonic()-began,
        'viewport': [1280,720], 'recording': 'actual-product-uncut.webm', 'noResponseFixtures': True,
        'sourceHttpStatus': source_response.status, 'visionHttpStatus': vision_response.status}, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(summary, ensure_ascii=False), flush=True)
