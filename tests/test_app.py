import json
import tempfile
import unittest
from pathlib import Path
from app import app


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
                        'tech_stack': None, 'gallery': [None, {'src': '/etc/passwd'}]}])
        response = self.client.get('/projects/safe-test')
        self.assertEqual(response.status_code, 200)
        self.assertNotIn('<script>alert', response.text)
        self.assertNotIn('javascript:', response.text)
        self.assertNotIn('//evil.test', response.text)
        self.assertIn('rel="noopener noreferrer"', response.text)
        self.assertIn('https://example.com', response.text)

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
        self.assertFalse(app.debug)


if __name__ == '__main__':
    unittest.main()
