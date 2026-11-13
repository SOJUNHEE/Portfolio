import json
import tempfile
import unittest
from pathlib import Path
from app import app, get_projects


class PortfolioTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.original = app.config['DATA_DIR']
        app.config.update(TESTING=True, DATA_DIR=Path(self.temp.name))
        self.client = app.test_client()

    def tearDown(self):
        app.config['DATA_DIR'] = self.original
        self.temp.cleanup()

    def projects(self, data):
        (Path(self.temp.name) / 'projects.json').write_text(json.dumps(data), encoding='utf-8')

    def test_home_missing_and_empty_data(self):
        for data in (None, [], {}, [None, 4]):
            if data is not None:
                self.projects(data)
            response = self.client.get('/')
            self.assertEqual(response.status_code, 200)
            self.assertIn('Coming Soon', response.text)
        # Malformed profile lists are dropped or normalised instead of breaking the page.
        (Path(self.temp.name) / 'profile.json').write_text(json.dumps({
            'skills': [{'category': 'A', 'state': 3, 'items': None}, 'x'], 'competencies': [{'title': 'T', 'items': 'abc'}],
            'metrics': [{'value': 5}, None], 'certifications': 'x'}), encoding='utf-8')
        response = self.client.get('/')
        self.assertEqual(response.status_code, 200)
        self.assertIn('<li>abc</li>', response.text)

    def test_invalid_json_falls_back(self):
        (Path(self.temp.name) / 'projects.json').write_text('{broken', encoding='utf-8')
        self.assertEqual(self.client.get('/').status_code, 200)

    def test_sparse_project_and_missing_image(self):
        self.projects([{'slug': 'test-only', 'is_published': True, 'thumbnail': 'images/projects/missing.png'}])
        for path in ('/', '/projects/test-only'):
            response = self.client.get(path)
            self.assertEqual(response.status_code, 200)
            self.assertIn('Project Preview', response.text)
            self.assertNotIn('<img ', response.text)
            self.assertNotIn('Live Demo', response.text)
            self.assertNotIn('GitHub', response.text)

    def test_unpublished_and_invalid_slug(self):
        self.projects([{'slug': 'draft', 'is_published': False}, {'slug': '../app.py', 'is_published': True}])
        for path in ('/projects/draft', '/projects/unknown', '/projects/..%2Fapp.py'):
            self.assertEqual(self.client.get(path).status_code, 404)

    def test_unsafe_urls_paths_and_html(self):
        self.projects([{'slug': 'safe-test', 'is_published': True, 'title': '<script>alert(1)</script>',
                        'github_url': 'javascript:alert(1)', 'live_url': '//evil.test',
                        'external_url': 'https://example.com', 'thumbnail': '../../.env',
                        'tech_stack': None, 'gallery': [None, {'src': '/etc/passwd'}]},
                       {'slug': 'demo-test', 'is_published': True, 'live_url': '/demo/not-bundled/'},
                       {'slug': 'demo-escape', 'is_published': True, 'live_url': '/demo/../app.py/'}])
        for slug in ('demo-test', 'demo-escape'):  # internal demo paths only when the bundle exists
            self.assertNotIn('/demo/', self.client.get(f'/projects/{slug}').text)
        response = self.client.get('/projects/safe-test')
        self.assertEqual(response.status_code, 200)
        self.assertNotIn('<script>alert', response.text)
        self.assertNotIn('javascript:', response.text)
        self.assertNotIn('//evil.test', response.text)
        self.assertIn('rel="noopener noreferrer"', response.text)
        self.assertIn('https://example.com', response.text)
        # A bundled demo is served only while a published project links to it.
        self.assertEqual(self.client.get('/demo/scm-dashboard/').status_code, 404)
        self.projects([{'slug': 'x', 'is_published': False, 'live_url': '/demo/scm-dashboard/'}])
        self.assertEqual(self.client.get('/demo/scm-dashboard/').status_code, 404)
        self.projects([{'slug': 'x', 'is_published': True, 'live_url': '/demo/scm-dashboard/'}])
        with self.client.get('/demo/scm-dashboard/') as demo:
            self.assertEqual(demo.status_code, 200)

    def test_full_schema(self):
        item = {'slug': 'schema-test', 'is_published': True}
        for field in ('problem', 'objective', 'data', 'solution', 'architecture', 'features', 'tech_stack', 'result', 'future_improvement'):
            item[field] = [field + ' test content']
        long_role = '긴 역할 원문 ' * 20
        item.update(description='full description', role=long_role.strip(), program='program label')
        # Optional display fields fall back to existing ones; wrong types are ignored.
        later = {'slug': 'a-later', 'is_published': True, 'is_featured': True, 'sort_order': 5, 'title': 'Later project', 'role': 'short role',
                 'card_summary': 'card only summary', 'card_role': 7, 'my_contribution': ['mine entry'], 'team_contribution': 'team entry'}
        self.projects([later, dict(item, sort_order=1)])
        response = self.client.get('/projects/schema-test')
        self.assertEqual(response.status_code, 200)
        for field in ('problem', 'objective', 'data', 'solution', 'architecture', 'features', 'tech_stack', 'result', 'future_improvement'):
            self.assertIn(field + ' test content', response.text)
        self.assertIn(long_role.strip(), response.text)
        home = self.client.get('/').text
        grid = home[home.index('class="project-grid"'):]
        self.assertLess(grid.index('/projects/schema-test'), grid.index('/projects/a-later'))
        for word in ('full description', 'program label', 'card only summary', 'short role'):
            self.assertIn(word, home)
        self.assertNotIn(long_role.strip(), home)
        # is_featured 프로젝트가 정렬 순서와 관계없이 Hero 대표 프로젝트로 나온다
        hero = home[home.index('class="hero-work"'):home.index('</figure>')]
        self.assertIn('/projects/a-later', hero)
        self.assertNotIn('/projects/schema-test', hero)
        detail = self.client.get('/projects/a-later').text
        for word in ('mine entry', 'team entry', 'short role'):
            self.assertIn(word, detail)

    def test_story_layout(self):
        # 문제 → 해결 과정 → AI 적용 → 성과 4블록이 있으면 그 순서로 보이고, 기존 항목은 '자세히 보기' 안으로 들어간다
        item = {'slug': 'story-test', 'is_published': True, 'title': 'Story', 'card_summary': 'one line summary',
                'ax_problem': ['story problem'], 'ax_steps': ['step one', 'step two'], 'ax_trial': 'trial text',
                'ai_note': ['no ai inside'], 'ai_tool': ['ai wrote code'], 'ai_human': ['i defined kpi'], 'ai_check': ['checked by script'],
                'ax_result': ['result line'], 'ax_numbers': [{'value': '3 / 3', 'label': 'found'}, {'value': 5, 'label': 'bad'}, 'x', {'value': ' ', 'label': 'empty'}],
                'problem': ['old problem'], 'data': ['old data'], 'future_improvement': ['old future'], 'team_contribution': ['team part']}
        sparse = {'slug': 'half-story', 'is_published': True, 'ax_problem': ['only problem'], 'problem': ['legacy problem']}
        self.projects([item, sparse])
        html = self.client.get('/projects/story-test').text
        order = [html.index(w) for w in ('story problem', 'step one', 'ai wrote code', 'i defined kpi', 'checked by script', '3 / 3', 'result line', 'team part', 'old data')]
        self.assertEqual(order, sorted(order))
        self.assertIn('one line summary', html)
        self.assertIn('trial text', html)
        self.assertIn('<details id="step-more"', html)
        self.assertLess(html.index('<details id="step-more"'), html.index('old data'))
        self.assertNotIn('old problem', html)  # 4블록의 문제가 기존 문제 정의를 대신한다
        self.assertNotIn('>bad<', html)
        self.assertNotIn('>empty<', html)
        self.assertIn('④ 성과', html)  # kind가 없으면 기존 제목
        legacy = self.client.get('/projects/half-story').text  # 해결 과정이 없으면 기존 서술 방식 유지
        self.assertIn('legacy problem', legacy)
        self.assertNotIn('step-more', legacy)

    def test_number_kind_label(self):
        # 2026-11-13: 구성 개수(kind='제작 범위')는 카드·상세에서 '확인된 결과'가 아니라 그 분류로 표시
        item = {'slug': 'kind-test', 'is_published': True, 'title': 'Kind', 'ax_problem': ['p'], 'ax_steps': ['s'],
                'ax_numbers': [{'value': '5개', 'label': 'pivot tables', 'kind': '제작 범위'}, {'value': '7일 → 3일', 'label': 'closing days'}]}
        self.projects([item])
        home = self.client.get('/').text
        self.assertIn('<dt>제작 범위</dt>', home)
        self.assertNotIn('<dt>확인된 결과</dt>', home)
        detail = self.client.get('/projects/kind-test').text
        self.assertIn('제작 범위와 성과', detail)
        self.assertIn('<span class="num-kind">제작 범위</span>pivot tables', detail)

    def test_production_content_and_routes(self):
        app.config['DATA_DIR'] = self.original
        home = self.client.get('/')
        self.assertEqual(home.status_code, 200)
        for word in ('젠미코리아', '두잇로지스', '제이아이로지스', '굿앤파트너스', 'sojh90@naver.com'):
            self.assertIn(word, home.text)
        for word in ('대한사료', 'leaflet', 'chatbot', 'href="#"', 'onclick='):
            self.assertNotIn(word, home.text)
        self.assertTrue(home.text.startswith('<!DOCTYPE html>'))
        self.assertNotIn('﻿', home.text)
        for anchor in ('home', 'about', 'experience', 'projects', 'skills', 'journey', 'contact'):
            self.assertIn(f'<section id="{anchor}"', home.text)
        self.assertIn('class="button primary" href="#projects"', home.text)
        for path in ('/sub1', '/sub1/detail/chicken', '/sub2', '/sub3', '/sub4'):
            self.assertEqual(self.client.get(path).status_code, 301)
        self.assertEqual(self.client.get('/privacy').status_code, 200)
        self.assertIn("object-src 'none'", home.headers['Content-Security-Policy'])
        self.assertNotIn('unsafe-inline', home.headers['Content-Security-Policy'])
        # Crawling is blocked (robots.txt, X-Robots-Tag, meta robots); security headers on every response.
        robots = self.client.get('/robots.txt')
        self.assertEqual((robots.status_code, robots.mimetype), (200, 'text/plain'))
        self.assertIn('Disallow: /', robots.text)
        self.assertIn('<meta name="robots" content="noindex', home.text)
        for path in ('/', '/projects/scm-operations-dashboard', '/demo/scm-dashboard/', '/robots.txt', '/projects/missing'):
            with self.client.get(path) as r:
                self.assertIn('noindex', r.headers['X-Robots-Tag'], path)
                self.assertEqual(r.headers['X-Frame-Options'], 'DENY')
                self.assertIn('camera=()', r.headers['Permissions-Policy'])
        self.assertNotIn('Strict-Transport-Security', home.headers)  # plain-http local run
        self.assertIn('max-age', self.client.get('/', base_url='https://localhost').headers['Strict-Transport-Security'])
        self.assertIn('<meta property="og:image" content="http://localhost/static/images/projects/', home.text)
        proxied = self.client.get('/', headers={'X-Forwarded-Proto': 'https, http'}).text
        self.assertIn('<meta property="og:image" content="https://localhost/static/images/projects/', proxied)
        hosted = self.client.get('/', base_url='http://example.onrender.com').text
        self.assertIn('<meta property="og:image" content="https://example.onrender.com/static/', hosted)
        # Bundled demo: served under /demo/<slug>/, linked as Live Demo, scripts still 'self'-only, no traversal.
        for path in ('/demo/scm-dashboard/', '/demo/scm-dashboard/vendor/chart.umd.min.js'):
            with self.client.get(path) as demo:
                self.assertEqual(demo.status_code, 200)
                self.assertIn("script-src 'self';", demo.headers['Content-Security-Policy'])
        for path in ('/demo/scm-dashboard/../../../app.py', '/demo/missing/', '/demo/Bad_Slug/',
                     '/static/demos/scm-dashboard/index.html', '/static/../demos/scm-dashboard/index.html'):
            self.assertEqual(self.client.get(path).status_code, 404)
        self.assertIn('href="/demo/scm-dashboard/"', self.client.get('/projects/scm-operations-dashboard').text)
        self.assertFalse(app.debug)

    def test_production_featured_is_excel(self):
        # 실제 data/projects.json 기준: 대표 프로젝트는 실무 Excel 하나, 이미지는 잘리지 않게(contain),
        # 화면은 가상 데이터 재현본이라는 표시가 함께 나온다.
        app.config['DATA_DIR'] = self.original
        with app.test_request_context():
            featured = [p for p in get_projects() if p['is_featured']]
        self.assertEqual([p['slug'] for p in featured], ['excel-sales-dashboard'])
        home = self.client.get('/').text
        hero = home[home.index('class="hero-work"'):home.index('</figure>')]
        self.assertIn('href="/projects/excel-sales-dashboard"', hero)
        self.assertIn('hero-work-media fit-contain', hero)
        self.assertIn('실무 · 직접 제작', hero)
        self.assertIn('가상 데이터 재현본', hero)

    def test_gallery_images_reserve_space(self):
        # 상세 갤러리 이미지는 실제 파일 크기를 width/height로 넣어 늦게 로드돼도 페이지 길이가 바뀌지 않게 한다(CLS).
        import re
        app.config['DATA_DIR'] = self.original
        with app.test_request_context():
            slugs = [p['slug'] for p in get_projects() if p['gallery']]
        self.assertTrue(slugs)
        for slug in slugs:
            html = self.client.get(f'/projects/{slug}').text
            gallery = html[html.index('class="gallery"'):]
            imgs = re.findall(r'<img [^>]*>', gallery)
            self.assertTrue(imgs, slug)
            for tag in imgs:
                self.assertRegex(tag, r'width="\d+" height="\d+"', f'{slug}: {tag[:80]}')


if __name__ == '__main__':
    unittest.main()
