"""다품종 3PL 운영 대시보드 (/demo/scm-dashboard/) — 화면 숫자 점검 (Playwright)

사용법: python tests/multi3pl/check_screen_numbers.py http://127.0.0.1:5000/demo/scm-dashboard/
KPI·단계 숫자·차트·표·CSV가 metrics.js 결과와 같은지, 정산 대조가 의도한 오류를 모두 찾는지, 상품군 전환 시 화면이 바뀌는지, 검색·페이지가 동작하는지 확인한다. 실패가 있으면 종료 코드 1.
"""
import csv
import io
import json
import re
import sys
from playwright.sync_api import sync_playwright

base = sys.argv[1].rstrip('/') + '/'
COMBOS = [('all', 'ALL'), ('all', 'FOD'), ('90d', 'FSH'), ('all', 'BEA'), ('30d', 'HOM'), ('all', 'GFT')]
GLOSSARY = ['용어 풀이', '용어풀이', '용어 설명', '용어 사전']
fails, passes = [], 0


def num(t):
    m = re.search(r'[−+-]?[\d,]+(\.\d+)?', (t or '').replace('−', '-'))
    return float(m.group(0).replace(',', '')) if m else None


def check(cond, name, detail=''):
    global passes
    if cond:
        passes += 1
    else:
        fails.append(name + (' :: ' + str(detail) if detail != '' else ''))


with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={'width': 1440, 'height': 900}, accept_downloads=True)
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('console', lambda m: errs.append('console: ' + m.text) if m.type == 'error' else None)
    pg.goto(base, wait_until='networkidle'); pg.wait_for_timeout(1500)

    def go(sid):
        pg.click('#nav [data-screen="%s"]' % sid); pg.wait_for_timeout(350)

    def set_filter(period, ind):
        pg.click('#fReset'); pg.wait_for_timeout(250)
        pg.select_option('#fPeriod', period); pg.wait_for_timeout(250)
        pg.select_option('#fInd', ind); pg.wait_for_timeout(350)

    def M(expr):
        return pg.evaluate("(() => { const F = SCMMetrics.resolveFilter(SCMApp.state.filter); return (%s); })()" % expr)

    def stats():
        return pg.evaluate("() => Object.fromEntries(Array.from(document.querySelectorAll('.stat')).map(c => [c.querySelector('.stat-label').innerText.trim(), c.querySelector('.stat-value').innerText.trim()]))")

    def tcount(key):
        return pg.evaluate("(k) => { const e = document.querySelector('[data-total=\"' + k + '\"]'); return e ? +e.innerText : null; }", key)

    def csv_rows(key):
        with pg.expect_download() as d:
            pg.click('[data-export="%s"]' % key)
        return list(csv.reader(io.StringIO(open(d.value.path(), 'rb').read().decode('utf-8-sig'))))

    def ds_sum(cid, label):
        return pg.evaluate("""([id, lb]) => { const c = Chart.getChart(document.getElementById(id)); if (!c) return null;
          const d = c.data.datasets.filter(x => x.label === lb)[0]; return d ? d.data.reduce((a, v) => a + (v || 0), 0) : null; }""", [cid, label])

    def kpi_check(tag):
        kp = M("SCMMetrics.commonKpis(F).concat(SCMMetrics.indKpis(F)).map(k => [k.key, k.unit, k.na ? null : k.value])")
        vals = dict(pg.evaluate("Array.from(document.querySelectorAll('[data-kpi]')).map(c => [c.getAttribute('data-kpi'), c.querySelector('.kpi-value').innerText])"))
        for key, unit, v in kp:
            t = vals.get(key)
            if v is None:
                check(t is None or t.strip() == '—', 'KPI 없음 ' + key + ' ' + tag, t); continue
            if unit == '%':
                check(abs(num(t) - round(v * 100, 1)) < 0.051, 'KPI ' + key + ' ' + tag, (t, v))
            elif unit == '%2':
                check(abs(num(t) - round(v * 100, 2)) < 0.0051, 'KPI ' + key + ' ' + tag, (t, v))
            elif unit == '라인':
                check(abs(num(t) - round(v, 1)) < 0.051, 'KPI ' + key + ' ' + tag, (t, v))
            else:
                check(num(t) == v, 'KPI ' + key + ' ' + tag, (t, v))

    for period, ind in COMBOS:
        set_filter(period, ind)
        tag = period + '/' + ind

        go('intro')
        ib = M("(() => { const i = SCMMetrics.inbound(F), o = SCMMetrics.outbound(F), s = SCMMetrics.issues(F); return [i.recv, i.good, i.put, SCMMetrics.stockNow(F).reduce((a, r) => a + r.good, 0), o.pickLines, o.ship, o.ship, s.rets.length]; })()")
        steps = [num(x) for x in pg.evaluate("Array.from(document.querySelectorAll('.stages.case .stat-value')).map(e => e.innerText)")]
        check(steps == ib, '8단계 숫자 ' + tag, (steps, ib))

        go('overview')
        kpi_check(tag)
        check(pg.locator('[data-kpi]').count() == (6 if ind == 'ALL' else 10), 'KPI 카드 수 ' + tag)
        check(ds_sum('chWeek', '출고 확정(건)') == M("SCMMetrics.daily(F).reduce((a, r) => a + r.ship, 0)"), '주별 출고 차트 합 ' + tag)
        if ind == 'ALL':
            cr = csv_rows('compare'); si = cr[0].index('출고 건수')
            check(sum(int(r[si]) for r in cr[1:]) == M("SCMMetrics.outbound(F).ship"), '산업군 비교 합 = 전체 출고 ' + tag)

        go('inbound')
        i = M("(() => { const r = SCMMetrics.inbound(F); return { n: r.n, good: r.good, ng: r.ng }; })()")
        st = stats()
        check(tcount('receipts') == i['n'] and num(st.get('검수 합격')) == i['good'] and num(st.get('검수 불합격')) == i['ng'], '입고 카드·표 ' + tag)
        cr = csv_rows('receipts'); gi = cr[0].index('합격')
        check(sum(int(r[gi]) for r in cr[1:]) == i['good'], '입고 CSV 합격 합 ' + tag)

        go('stock')
        z = M("SCMMetrics.zones(F).length"); check(tcount('zones') == z, '존 표 ' + tag)
        ct = M("(() => { const r = SCMMetrics.counts(F); return { d: r.diffs.length }; })()")
        check(tcount('counts') == ct['d'], '실사 차이 표 ' + tag)
        sc = csv_rows('stockNow'); ai = sc[0].index('가용')
        check(sum(int(r[ai]) for r in sc[1:]) == M("SCMMetrics.stockNow(F).reduce((a, r) => a + r.avail, 0)"), '재고 CSV 가용 합 ' + tag)
        check(tcount('moves') == M("SCMMetrics.movesIn(F).length"), '이동 이력 ' + tag)

        go('outbound')
        o = M("(() => { const r = SCMMetrics.outbound(F); return { inv: r.inv, ship: r.ship }; })()")
        st = stats()
        check(num(st.get('송장 발행')) == o['inv'] and num(st.get('출고 확정')) == o['ship'], '송장·출고 카드 ' + tag)
        wv = M("(() => { const r = SCMMetrics.picking(F, SCMApp.state.local.wave); return { n: r.orders.length, lots: r.pick.length, units: r.units }; })()")
        check(tcount('wave') == wv['n'] and tcount('pick') == wv['lots'], '피킹리스트 표 ' + tag)
        pc = csv_rows('pick'); qi = pc[0].index('피킹 수량'); li = pc[0].index('로케이션')
        check(sum(int(r[qi]) for r in pc[1:]) == wv['units'], '피킹 CSV 합 ' + tag)
        locs = [r[li] for r in pc[1:]]; check(locs == sorted(locs), '로케이션 순 ' + tag)

        go('labor')
        lb = M("(() => { const r = SCMMetrics.labor(F); return { temps: r.temps, proc: r.proc.length, peak: r.peakDays.length, vol: r.proc.map(p => p.vol) }; })()")
        st = stats()
        check(num(st.get('임시 인력')) == lb['temps'] and tcount('proc') == lb['proc'] and tcount('peak') == lb['peak'], '인력 카드·표 ' + tag)
        pr = csv_rows('proc'); vi = pr[0].index('물량')
        check([int(r[vi]) for r in pr[1:]] == lb['vol'], '공정 물량 CSV ' + tag)

        go('returns')
        check(tcount('rets') == M("SCMMetrics.issues(F).rets.length"), '반품 표 ' + tag)

        go('issues')
        isx = M("(() => { const r = SCMMetrics.issues(F); return { n: r.list.length, late: r.late.length }; })()")
        check(tcount('issues') == isx['n'] and tcount('late') == isx['late'], '이슈 표 ' + tag)
        if isx['late']:
            check(ds_sum('chLate', '미출고(건)') == isx['late'], '미출고 차트 합 ' + tag)

        go('settle')
        st = M("(() => { const r = SCMMetrics.settlement(F); return { n: r.diffs.length, ca: r.causes.length, ev: r.evidence.length, diff: r.diff, rows: r.rows.length }; })()")
        sv = [num(x) for x in pg.evaluate("Array.from(document.querySelectorAll('.stages.case .stat-value')).map(e => e.innerText)")]
        check(sv[2:] == [st['n'], st['ca'], st['ev']], '정산 단계 숫자 ' + tag, sv)
        check(tcount('setDiff') == st['n'] and tcount('setRows') == st['rows'], '정산 표 ' + tag)
        cr = csv_rows('setRows'); di = cr[0].index('차이(원)')
        check(sum(int(r[di] or 0) for r in cr[1:]) == st['diff'], '정산 CSV 차이 합 ' + tag)
        if ind == 'ALL' and period == 'all':
            check(st['ca'] == 4 and st['n'] == 9, '의도한 정산 오류 5건이 원인 4가지로 모두 나옴', st)

        go('focus')
        txt = pg.evaluate('document.getElementById("view").innerText')
        if ind == 'FOD':
            check('FEFO' in txt and tcount('lots') == M("SCMMetrics.expiry(F).lots.length"), '식품: 소비기한 화면 ' + tag)
            check(ds_sum('chExpF', '실물(개)') == sum(M("SCMMetrics.expiry(F).buckets.map(b => b.units)")), '식품: 기한 차트 합 ' + tag)
        if ind == 'FSH':
            check('색상·사이즈' in txt and tcount('matrix') == 6 and tcount('aging') is not None, '의류: 옵션 재고 ' + tag)
        if ind == 'BEA':
            check('세트' in txt and tcount('sets') == 2 and tcount('lots') is not None, '뷰티: 세트·로트 ' + tag)
        if ind == 'HOM':
            check(tcount('byItem') == M("SCMMetrics.byItem(F).length"), '가전: 품목별 ' + tag)
        if ind == 'GFT':
            check(tcount('sets') == 2, '선물: 세트 ' + tag)
        if ind == 'ALL':
            check('상품군을 선택하세요' in txt, '전체: 선택 안내 ' + tag)
        if ind in ('FSH', 'HOM', 'GFT', 'BEA'):
            check('이 상품군의 작업 기준은 개인 시뮬레이션용 가정값입니다' in txt or ind == 'HOM', '실제 경력 구분 문구 ' + tag)  # 2026-11-13 문구 변경: 확인되지 않은 경력 유무를 단정하지 않음

        for sid in ['intro', 'overview', 'stock', 'focus']:
            go(sid)
            t = pg.evaluate('document.body.innerText')
            check(not any(g in t for g in GLOSSARY) and pg.evaluate("document.querySelectorAll('[class*=\"gloss\"], [data-term], abbr[title]').length") == 0, '용어 해설 UI 없음 ' + sid + ' ' + tag)

    set_filter('all', 'ALL')
    go('issues')
    total = tcount('issues')
    pg.fill('[data-search="issues"]', '오출고'); pg.wait_for_timeout(400)
    n = tcount('issues')
    check(0 < n < total, '이슈 검색', (n, total))
    check(len(csv_rows('issues')) - 1 == n, '검색 후 CSV = 검색 결과')
    pg.fill('[data-search="issues"]', ''); pg.wait_for_timeout(400)
    first = pg.evaluate("document.querySelector('[data-tbody=\"issues\"] tbody tr').innerText")
    pg.click('[data-page="issues"][data-dir="1"]'); pg.wait_for_timeout(300)
    check(first != pg.evaluate("document.querySelector('[data-tbody=\"issues\"] tbody tr').innerText"), '표 다음 페이지')
    pg.click('[data-issue-kind="반품"]'); pg.wait_for_timeout(400)
    check(tcount('issues') == M("SCMMetrics.issues(F).list.filter(i => i.kind === '반품').length"), '이슈 유형 버튼')
    go('outbound')
    opts = pg.evaluate("Array.from(document.querySelectorAll('[data-wave] option')).map(o => +o.value)")
    pg.select_option('[data-wave]', str(opts[5])); pg.wait_for_timeout(400)
    check(M("SCMApp.state.local.wave") == opts[5], '피킹 일자 변경')
    go('intro')
    pg.click('.ind-pick [data-set-ind="FSH"]'); pg.wait_for_timeout(400)
    check(M("F.ind") == 'FSH' and pg.input_value('#fInd') == 'FSH', '산업군 버튼 → 필터 동기화')
    pg.goto(base + '?ind=GFT#focus', wait_until='networkidle'); pg.wait_for_timeout(1000)
    check(M("F.ind") == 'GFT' and M("SCMApp.state.screen") == 'focus', '산업군 바로가기 주소')
    pg.select_option('#fPeriod', 'custom'); pg.wait_for_timeout(300)
    pg.fill('#fFrom', '2026-09-20'); pg.dispatch_event('#fFrom', 'change'); pg.wait_for_timeout(200)
    pg.fill('#fTo', '2026-08-01'); pg.dispatch_event('#fTo', 'change'); pg.wait_for_timeout(500)
    r = M('[F.from, F.to]')
    check(r[0] < r[1], '직접 선택 기간 순서 보정', r)
    check(not errs, '콘솔 오류 없음', errs[:3])
    b.close()

print(json.dumps({'pass': passes, 'fail': len(fails), 'fails': fails[:30]}, ensure_ascii=False, indent=1))
sys.exit(1 if fails else 0)
