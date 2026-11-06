"""박람회 슬라이드(static/ppt/slides.js)의 성과 숫자·경력 숫자가 사이트 데이터(data/*.json)와 같은지,
측정 조건 문구와 10장 핵심본 구성이 유지되는지 대조한다."""
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
        data = ROOT / 'data'
        cls.site = squash((data / 'projects.json').read_text(encoding='utf-8') + (data / 'profile.json').read_text(encoding='utf-8'))
        cls.career = squash((data / 'experiences.json').read_text(encoding='utf-8') + (data / 'profile.json').read_text(encoding='utf-8'))

    def stats(self):
        """stats: [['숫자', '설명', '측정 조건'], ...] → [(숫자, 조건)]"""
        blocks = re.findall(r'stats:\s*\[(.*?)\]\s*,\s*\n', self.js, re.S)
        return re.findall(r"\[\s*'([^']+)',\s*'[^']*'(?:,\s*'([^']*)')?\s*\]", ' '.join(blocks))

    def test_five_slides_per_project(self):
        projects = len(re.findall(r"\{\s*no:\s*\d+,", self.js))
        self.assertEqual(projects, 4)
        self.assertEqual(len(re.findall(r"\btype:\s*'", self.js)), projects * 5)
        for p in range(1, projects + 1):
            self.assertEqual(len(re.findall(r'\{\s*\n\s*p:\s*%d,' % p, self.js)), 5, p)

    def test_project_order_matches_site(self):
        # 사이트 순서: Excel(실무) → 다품종 3PL → AXPORT → REBOOT
        names = re.findall(r"\{\s*no:\s*\d+,\s*tag:\s*'[^']*',\s*name:\s*'([^']+)'", self.js)
        self.assertEqual([n.split()[0] for n in names], ['Excel', '다품종', 'AXPORT', 'REBOOT'])

    def test_numbers_match_site(self):
        vals = [v for v, _ in self.stats()] + re.findall(r"big:\s*\{\s*value:\s*'([^']+)'", self.js)
        self.assertGreaterEqual(len(vals), 15)
        for v in vals:
            if not re.search(r'\d', v) or '자료 출처' in v:
                continue
            self.assertIn(squash(v), self.site, f'슬라이드 숫자 "{v}"가 사이트 데이터에 없음')

    def test_every_stat_has_condition(self):
        for v, cond in self.stats():
            self.assertTrue(cond.strip(), f'성과 숫자 "{v}"에 측정 조건이 없음')

    def test_intro_career_numbers_match_resume(self):
        facts = re.search(r'facts:\s*\[(.*?)\]\s*,\s*\n\s*lead:', self.js, re.S).group(1)
        for num in re.findall(r'\d[\d,]*%?', facts):
            self.assertIn(num, self.career, f'소개 경력 숫자 "{num}"가 경력 데이터에 없음')
        for company in ('굿앤파트너스', '제이아이로지스', '두잇로지스', '젠미코리아'):
            self.assertIn(company, facts)

    def test_core_deck_is_ten(self):
        core = re.search(r'core:\s*\[(.*?)\]\s*,\s*\n', self.js, re.S).group(1)
        items = re.findall(r"\[\s*(?:'intro'|\d+,\s*'(\w+)')\s*\]", core)
        self.assertEqual(len(items), 10)
        self.assertIn("['intro']", core.replace(' ', ''))

    def test_conditions_kept(self):
        for phrase in ('가상 데이터 기반 테스트', '본인 1회 측정', '로컬 측정', '팀 결과', '비공개', '규칙을 만들 때 쓴 사례',
                       '여러 업무 개선의 결과', '모든 광고 위험 표현을 잡는다는 뜻이 아닙니다', 'FDA 공지 2020-07-29'):
            self.assertIn(phrase, self.js, phrase)

    def test_no_absolute_fda_wording(self):
        # '경고장을 받았다'처럼 효능 표현 = 곧 위반이라고 단정하지 않는다 (FDA 공지 문구 기준으로 표현)
        self.assertNotIn('효능 표현 때문에 경고장을 받았습니다', self.js)
        self.assertIn('승인받지 않은 신약', self.js)


if __name__ == '__main__':
    unittest.main()
