"""Local-only visual/interaction checks. No example project is written to real data."""
import json
import shutil
import sys
import tempfile
import threading
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app import app, get_projects
from werkzeug.serving import make_server
from playwright.sync_api import expect, sync_playwright

WIDTHS = (1920, 1440, 1280, 1024, 768, 430, 390, 360)
MOBILE_MENU_MAX = 767
BASE = 'http://127.0.0.1:5057'
output = Path('test-results')
output.mkdir(exist_ok=True)
server = make_server('127.0.0.1', 5057, app, threaded=True)
threading.Thread(target=server.serve_forever, daemon=True).start()
with app.test_request_context():
    published = get_projects()
report, errors, checks = [], [], []

# Elements that stick out of the viewport or clip their own text; catches what scrollWidth alone can hide.
LAYOUT_PROBE = '''() => {
    const bad = [];
    for (const el of document.querySelectorAll('main *, header *, footer *')) {
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        if (r.right > innerWidth + 1 || r.left < -1) bad.push('outside: ' + el.className + ' ' + el.tagName);
        if (el.matches('h1,h2,h3,h4,p,li,dt,dd,a,button,summary,figcaption') && el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).display !== 'inline')
            bad.push('clipped: ' + el.className + ' ' + el.tagName);
    }
    return bad.slice(0, 8);
}'''


def settle(page):
    """Scroll the real page so lazy images and reveal transitions finish before measuring or capturing."""
    page.evaluate('document.fonts.ready')
    height = page.evaluate('document.documentElement.scrollHeight')
    for y in range(0, height, 500):
        page.evaluate(f'scrollTo(0,{y})')
        page.wait_for_timeout(100)
    page.evaluate('scrollTo({top:0,behavior:"instant"})')
    page.wait_for_timeout(700)


def assert_layout(page, label):
    assert not page.evaluate('document.documentElement.scrollWidth > innerWidth'), f'Horizontal overflow at {label}'
    bad = page.evaluate(LAYOUT_PROBE)
    assert not bad, f'{label}: {bad}'
    hidden = page.evaluate("[...document.querySelectorAll('.reveal')].filter(e => getComputedStyle(e).opacity !== '1').length")
    assert hidden == 0, f'{label}: {hidden} reveal elements still hidden after scrolling'
    broken = page.evaluate("[...document.images].filter(i => i.complete && !i.naturalWidth).length")
    assert broken == 0, f'{label}: broken images'


def wait_scroll_end(page):
    """Smooth anchor scrolling takes longer on long mobile pages; measure only once scrollY stops changing."""
    page.wait_for_function('''() => new Promise(done => { let last = -1, still = 0; const tick = () => { if (scrollY === last && ++still > 5) return done(true); if (scrollY !== last) still = 0; last = scrollY; requestAnimationFrame(tick); }; tick(); })''', timeout=5000)


def ok(name):
    checks.append(name)


try:
    with sync_playwright() as p:
        browser = p.chromium.launch(channel='msedge', headless=True)
        context = browser.new_context(permissions=['clipboard-read', 'clipboard-write'])
        page = context.new_page()
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.on('console', lambda message: errors.append(message.text) if message.type == 'error' else None)
        for width in WIDTHS:
            page.set_viewport_size({'width': width, 'height': 1000})
            response = page.goto(BASE + '/', wait_until='networkidle')
            assert response.status == 200
            assert page.evaluate('innerWidth') == width
            assert not response.text().startswith('﻿'), 'BOM in home response'
            settle(page)
            assert_layout(page, f'home {width}')
            assert page.locator('h1').count() == 1
            for target in ('home', 'about', 'experience', 'projects', 'skills', 'journey', 'contact'):
                assert page.locator(f'main > section[id="{target}"]').count() == 1, target
            for link in page.locator('a[href^="#"], a[href^="/#"]').all():
                target = link.get_attribute('href').split('#')[1]
                assert page.locator(f'[id="{target}"]').count(), target
            order = page.evaluate("[...document.querySelectorAll('main > section[id]')].map(s => s.id)")
            assert order == ['home', 'projects', 'about', 'experience', 'skills', 'journey', 'contact'], order
            # Primary touch targets stay comfortably tappable.
            small = page.evaluate("[...document.querySelectorAll('.button, #main-nav a, .menu-toggle, .copy-email, summary')].filter(e => e.offsetParent && e.getBoundingClientRect().height < 43.5).map(e => e.textContent.trim())")
            assert not small, f'small targets at {width}: {small}'
            columns = page.evaluate("(() => { const g = document.querySelector('.project-grid'); return g ? getComputedStyle(g).gridTemplateColumns.split(' ').length : 0 })()")
            if published:
                assert columns == (2 if width >= 768 else 1), f'{columns} project columns at {width}'
                assert page.locator('.project-card h3').first.inner_text() == published[0]['title']
            mobile_menu = width <= MOBILE_MENU_MAX
            toggle = page.locator('.menu-toggle')
            assert toggle.is_visible() == mobile_menu
            if mobile_menu:
                toggle.click()
                assert toggle.get_attribute('aria-expanded') == 'true'
                assert page.evaluate('getComputedStyle(document.body).overflow') == 'hidden'
                assert page.locator('main').evaluate('(el) => el.inert')
                # Focus stays inside toggle + menu links in both directions.
                toggle.focus()
                page.keyboard.press('Shift+Tab')
                assert page.evaluate("document.activeElement.matches('#main-nav a:last-of-type')")
                page.keyboard.press('Tab')
                assert page.evaluate("document.activeElement.matches('.menu-toggle')")
                page.keyboard.press('Tab')
                assert page.evaluate("document.activeElement.matches('#main-nav a:first-of-type')")
                page.keyboard.press('Escape')
                assert toggle.get_attribute('aria-expanded') == 'false'
                assert page.evaluate("document.activeElement.matches('.menu-toggle')")
                toggle.click()
                page.locator('#main-nav a[href="/#experience"]').click()
                assert toggle.get_attribute('aria-expanded') == 'false'
                assert not page.locator('main').evaluate('(el) => el.inert')
                assert page.evaluate('getComputedStyle(document.body).overflow') != 'hidden'
                if width == 430:
                    # Widening past the breakpoint releases an open menu.
                    toggle.click()
                    page.set_viewport_size({'width': 1024, 'height': 1000})
                    page.wait_for_timeout(100)
                    assert toggle.get_attribute('aria-expanded') == 'false'
                    assert not page.locator('main').evaluate('(el) => el.inert')
                    page.set_viewport_size({'width': width, 'height': 1000})
            else:
                page.locator('#main-nav a[href="/#experience"]').click()
            # The anchor target lands below the fixed header, not underneath it.
            wait_scroll_end(page)
            top = page.evaluate("document.getElementById('experience').getBoundingClientRect().top")
            header = page.evaluate("document.querySelector('.site-header').getBoundingClientRect().bottom")
            assert header - 1 <= top <= header + 60, f'experience anchor at {top} (header {header}) width {width}'
            page.evaluate('scrollTo({top:0,behavior:"instant"})')
            page.locator('.hero .button.primary').click()
            wait_scroll_end(page)
            assert page.evaluate("location.hash") == '#projects'
            top = page.evaluate("document.getElementById('projects').getBoundingClientRect().top")
            assert header - 1 <= top <= header + 60, f'projects anchor at {top} width {width}'
            page.evaluate('scrollTo({top:0,behavior:"instant"})')
            page.wait_for_timeout(300)
            page.screenshot(path=str(output / f'home-{width}.png'), full_page=True)
            for project in published:
                response = page.goto(f"{BASE}/projects/{project['slug']}", wait_until='networkidle')
                assert response.status == 200
                settle(page)
                assert_layout(page, f"{project['slug']} {width}")
                assert page.locator('h1').inner_text() == project['title']
                for key in ('live_url', 'github_url', 'external_url'):
                    if project[key]:
                        link = page.locator(f'a[href="{project[key]}"]')
                        assert link.count() == 1, f'{key} shown {link.count()} times'
                        assert link.get_attribute('target') == '_blank'
                        assert link.get_attribute('rel') == 'noopener noreferrer'
                text = page.locator('main').inner_text()
                for key in ('problem', 'objective', 'data', 'solution', 'architecture', 'features', 'result', 'future_improvement', 'tech_stack', 'my_contribution', 'team_contribution'):
                    for entry in project[key]:
                        assert entry in text, f'missing {key} content: {entry[:30]}'
                # Step list sits clear of the fixed header and of the body text.
                steps = page.locator('.detail-steps').bounding_box()
                content = page.locator('.detail-content').bounding_box()
                assert steps['x'] >= 0 and steps['x'] + steps['width'] <= width + 1
                assert steps['y'] + steps['height'] <= content['y'] + 1 or steps['x'] + steps['width'] <= content['x'] + 1
                page.screenshot(path=str(output / f"detail-{project['slug']}-{width}.png"), full_page=True)
            report.append({'width': width, 'status': 200, 'horizontal_overflow': False, 'mobile_menu': mobile_menu, 'detail_pages': len(published)})
        ok('home + published detail pages at 8 widths')

        page.set_viewport_size({'width': 1280, 'height': 720})
        page.goto(BASE + '/', wait_until='networkidle')
        page.locator('.copy-email').scroll_into_view_if_needed()
        page.locator('.copy-email').click()
        expect(page.locator('#copy-status')).to_contain_text('복사했습니다')
        assert page.locator('#copy-status').get_attribute('aria-live') == 'polite'
        assert page.locator('.email-link').get_attribute('href') == 'mailto:sojh90@naver.com'
        assert page.locator('.phone-link').get_attribute('href').startswith('tel:')
        ok('copy / mail / tel')
        denied = browser.new_context()
        denied_page = denied.new_page()
        denied_page.add_init_script("Object.defineProperty(navigator, 'clipboard', {value: undefined})")
        denied_page.goto(BASE + '/', wait_until='networkidle')
        denied_page.locator('.copy-email').click()
        expect(denied_page.locator('#copy-status')).to_contain_text('이메일 링크를 이용')
        denied.close()
        ok('copy failure message')

        # Content must not depend on motion, on JavaScript, or on IntersectionObserver.
        for name, options, script in (('reduced-motion', {'reduced_motion': 'reduce'}, None),
                                      ('no-js', {'java_script_enabled': False}, None),
                                      ('no-observer', {}, 'delete window.IntersectionObserver')):
            ctx = browser.new_context(viewport={'width': 390, 'height': 844}, **options)
            static_page = ctx.new_page()
            if script:
                static_page.add_init_script(script)
            for path in ['/'] + [f"/projects/{project['slug']}" for project in published]:
                static_page.goto(BASE + path, wait_until='networkidle')
                static_page.wait_for_timeout(700)
                # No scrolling here on purpose: nothing below the fold may be waiting to appear.
                static_page.screenshot(path=str(output / f"{name}{path.replace('/', '-')}.png"), full_page=True)
                if options.get('java_script_enabled') is not False:
                    hidden = static_page.evaluate("[...document.querySelectorAll('.reveal, .hero-copy, .hero-work')].filter(e => getComputedStyle(e).opacity !== '1' || getComputedStyle(e).transform !== 'none').length")
                    assert hidden == 0, f'{name} {path}: {hidden} hidden'
                else:
                    assert static_page.locator('.reveal-pending').count() == 0
                    # Without JS the mobile menu cannot open, so its links must already be on screen.
                    assert static_page.locator('#main-nav a').first.is_visible()
                    assert not static_page.evaluate('document.documentElement.scrollWidth > innerWidth')
                    expect(static_page.locator('h1')).to_be_visible()
                    expect(static_page.locator('main section').last).to_be_visible()
            ctx.close()
        ok('reduced motion / no JS / no IntersectionObserver')

        original = app.config['DATA_DIR']
        with tempfile.TemporaryDirectory() as directory:
            for name in ('profile.json', 'experiences.json'):
                shutil.copy(Path(original) / name, directory)
            app.config['DATA_DIR'] = Path(directory)
            sample = [{'slug': f'test-{n}', 'title': f'검증 전용 프로젝트 {n}', 'is_published': True, 'sort_order': n,
                       'description': '격리된 테스트 데이터입니다.', 'tech_stack': ['A', 'B', 'C', 'D', 'E'],
                       'thumbnail': 'images/projects/missing.png', 'external_url': 'https://example.com'} for n in (1, 2, 3)]
            sample.append({'slug': 'test-draft', 'title': '미공개 검증 프로젝트', 'is_published': False})
            for count in (0, 1, 2, 3):
                Path(directory, 'projects.json').write_text(json.dumps(sample[:count] + sample[3:]), encoding='utf-8')
                for width in (1280, 390):
                    page.set_viewport_size({'width': width, 'height': 900})
                    assert page.goto(BASE + '/', wait_until='networkidle').status == 200
                    settle(page)
                    assert_layout(page, f'{count} projects at {width}')
                    assert page.locator('.project-card').count() == count
                    assert page.locator('.empty-project').count() == (1 if count == 0 else 0)
                    assert '미공개 검증 프로젝트' not in page.content()
                    assert page.locator('main img').count() == 0
                    if count:
                        # No empty column: every row of cards is filled edge to edge.
                        grid = page.locator('.project-grid').bounding_box()
                        last = page.locator('.project-card').last.bounding_box()
                        assert abs((last['x'] + last['width']) - (grid['x'] + grid['width'])) < 2, f'gap after last card ({count} at {width})'
                        assert page.locator('.project-card .tags li').first.is_visible()
                        assert page.locator('.project-card').first.locator('.tags li').count() == 5  # 4 + "외 1개"
                    page.screenshot(path=str(output / f'projects-{count}-{width}.png'), full_page=True)
            assert page.goto(BASE + '/projects/test-draft').status == 404
            for width in (1440, 768, 360):
                page.set_viewport_size({'width': width, 'height': 900})
                response = page.goto(BASE + '/projects/test-1', wait_until='networkidle')
                assert response.status == 200
                assert page.locator('.image-placeholder').count() == 1
                assert not page.evaluate('document.documentElement.scrollWidth > innerWidth')
                link = page.locator('a[href="https://example.com"]')
                assert link.count() == 1
                assert link.get_attribute('target') == '_blank'
                assert link.get_attribute('rel') == 'noopener noreferrer'
            app.config['DATA_DIR'] = original
        ok('0/1/2/3 projects, unpublished hidden, missing image fallback (isolated data)')

        # Bundled live demos open from the detail page and run under the site's CSP without errors.
        for project in published:
            if not project['live_url'].startswith('/demo/'):
                continue
            for width in (1440, 360):
                page.set_viewport_size({'width': width, 'height': 900})
                page.goto(f"{BASE}/projects/{project['slug']}", wait_until='networkidle')
                link = page.locator(f'a[href="{project["live_url"]}"]')
                assert link.count() == 1
                with page.context.expect_page() as popup:
                    link.click()
                demo = popup.value
                demo_errors = []
                demo.on('console', lambda m: demo_errors.append(m.text) if m.type == 'error' else None)
                demo.on('pageerror', lambda e: demo_errors.append(str(e)))
                demo.wait_for_load_state('networkidle')
                demo.wait_for_selector('.loading', state='detached', timeout=30000)
                screens = demo.evaluate("[...document.querySelectorAll('#nav [data-screen]')].map(b => '#' + b.dataset.screen)")
                for screen in screens:  # every dashboard screen, so a CSP violation on any of them is caught
                    demo.evaluate(f"location.hash = {screen!r}")
                    demo.wait_for_timeout(700)
                    assert demo.locator('canvas, table').count() > 0, f'demo screen {screen} empty'
                    assert not demo.evaluate('document.documentElement.scrollWidth > innerWidth'), f'demo overflow {screen} at {width}'
                assert len(screens) >= 8, screens
                assert not demo_errors, demo_errors
                demo.evaluate("location.hash = ''")
                demo.wait_for_timeout(500)
                demo.screenshot(path=str(output / f"demo-{project['slug']}-{width}.png"))
                demo.close()
        ok('bundled live demos')

        for path, status in (('/privacy', 200), ('/projects/missing', 404)):
            assert page.goto(BASE + path).status == status
            assert not page.evaluate('document.documentElement.scrollWidth > innerWidth')
        for path, anchor in (('/sub1', 'projects'), ('/sub1/detail/any', 'projects'), ('/sub2', 'about'), ('/sub3', 'journey'), ('/sub4', 'experience')):
            page.goto(BASE + path)
            assert page.url == f'{BASE}/#{anchor}', page.url
        ok('privacy / 404 / legacy redirects')
        # A deliberate 404 produces a browser resource error, not an application JS error.
        errors = [e for e in errors if '404 (NOT FOUND)' not in e]
        browser.close()
    assert not errors, errors
finally:
    server.shutdown()
    (output / 'browser-report.json').write_text(json.dumps({'viewports': report, 'checks': checks, 'errors': errors}, indent=2, ensure_ascii=False), encoding='utf-8')
print(json.dumps({'viewports_passed': len(report), 'checks': checks, 'errors': errors}, ensure_ascii=False))
