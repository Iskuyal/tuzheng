"""Read the rendered production DOM without sending any model request."""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / '.cache/demo-2026-10-18'
OUT.mkdir(parents=True, exist_ok=True)
with sync_playwright() as p:
    browser = p.chromium.launch(channel='msedge', headless=True)
    context = browser.new_context(viewport={'width':1920,'height':1080})
    page = context.new_page()
    for name, route in [('home','/'),('audit','/audit'),('source','/source-audit?sample=cpi-2025-12')]:
        page.goto('http://127.0.0.1:7118' + route, wait_until='networkidle')
        page.screenshot(path=str(OUT / f'inspect-{name}.png'))
        print(name, page.locator('h1, button, input, summary').evaluate_all('(els)=>els.map(el=>({tag:el.tagName,id:el.id,text:(el.textContent||el.getAttribute("aria-label")||"").trim().slice(0,85),type:el.type}))'))
    print('ready', context.request.get('http://127.0.0.1:7118/capture/ready').json())
    context.close()
    browser.close()
