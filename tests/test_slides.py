"""박람회 슬라이드(static/ppt/slides.js)의 성과 숫자가 사이트 데이터(data/*.json)와 같은지 대조한다."""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def squash(text):
    return re.sub(r'\s+', '', text)


class SlideNumbersTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.js = (ROOT / 'static' / 'ppt' / 'slides.js').read_text(encoding='utf-8')
        site = (ROOT / 'data' / 'projects.json').read_text(encoding='utf-8') + (ROOT / 'data' / 'profile.json').read_text(encoding='utf-8')
        cls.site = squash(site)

    def values(self):
        stats = re.findall(r"\[\s*'([^']+)',\s*'[^']*'\s*\]", ' '.join(re.findall(r'stats:\s*\[(.*?)\]\s*,\s*\n', self.js, re.S)))
        bigs = re.findall(r"big:\s*\{\s*value:\s*'([^']+)'", self.js)
        return stats + bigs

    def test_fifteen_slides_three_projects(self):
        self.assertEqual(len(re.findall(r"\btype:\s*'", self.js)), 15)
        for p in (1, 2, 3):
            self.assertEqual(len(re.findall(r'\{\s*\n\s*p:\s*%d,' % p, self.js)), 5, p)

    def test_numbers_match_site(self):
        vals = self.values()
        self.assertGreaterEqual(len(vals), 12)
        for v in vals:
            if not re.search(r'\d', v) or '자료 출처' in v:
                continue
            self.assertIn(squash(v), self.site, f'슬라이드 숫자 "{v}"가 사이트 데이터에 없음')

    def test_conditions_kept(self):
        for phrase in ('가상 데이터', '본인 1회 측정', '로컬 측정', '팀 결과'):
            self.assertIn(phrase, self.js, phrase)


if __name__ == '__main__':
    unittest.main()
