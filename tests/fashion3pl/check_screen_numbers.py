"""Fashion 3PL Control Tower — 화면 숫자 점검 (Playwright)

사용법: python tests/fashion3pl/check_screen_numbers.py http://127.0.0.1:5000/demo/scm-dashboard/
화면에 보이는 카드·차트·표·CSV 숫자가 metrics.js 계산 결과와 같은지, 표 검색·페이지·CSV, 용어 해설 UI가 없는지 확인한다.
필터 조합(기간 × 화주사 × 출고 유형) 몇 가지마다 다시 그려 비교한다. 실패가 있으면 종료 코드 1.
"""
import csv
import io
import json
import os
import re
import sys
from playwright.sync_api import sync_playwright

base = sys.argv[1].rstrip('/') + '/'
COMBOS = [('90d', 'ALL', 'ALL'), ('30d', 'B', 'ALL'), ('all', 'ALL', 'B2C'), ('7d', 'C', 'B2B')]
GLOSSARY_TEXT = ['용어 풀이', '용어풀이', '용어 설명', '용어 사전']
GLOSSARY_SEL = '[class*="gloss"], [id*="gloss"], [data-term], abbr[title]'
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


# 배포 파일에 용어 해설 UI 흔적이 없는지
DEMO = os.path.join(os.path.dirname(__file__), '..', '..', 'demos', 'scm-dashboard')
for dp, dn, fn in os.walk(DEMO):
    for n in fn:
        if n.endswith(('.html', '.js', '.css')) and 'vendor' not in dp:
            t = open(os.path.join(dp, n), encoding='utf-8').read()
            for pat in [r'용어\s*풀이', r'용어\s*사전', r'glossary', r'helpText']:
                check(not re.search(pat, t, re.I), '파일에 용어 해설 흔적 없음 ' + n + ' ' + pat)

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={'width': 1440, 'height': 900}, accept_downloads=True)
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('console', lambda m: errs.append('console: ' + m.text) if m.type == 'error' else None)
    pg.goto(base, wait_until='networkidle')
    pg.wait_for_timeout(1500)

    def go(sid):
        pg.click('#nav [data-screen="%s"]' % sid)
        pg.wait_for_timeout(450)

    def set_filter(period, brand, typ):
        pg.click('#fReset'); pg.wait_for_timeout(250)
        pg.select_option('#fPeriod', period); pg.wait_for_timeout(250)
        pg.select_option('#fBrand', brand); pg.wait_for_timeout(250)
        pg.select_option('#fType', typ); pg.wait_for_timeout(350)

    def M(expr):
        return pg.evaluate("(() => { const F = SCMMetrics.resolveFilter(SCMApp.state.filter); return (%s); })()" % expr)

    def stats():
        return pg.evaluate("""() => Object.fromEntries(Array.from(document.querySelectorAll('.stat')).map(c => [
          (c.querySelector('.stat-label') || c).innerText.trim(), (c.querySelector('.stat-value') || c).innerText.trim()]))""")

    def chart_ds(cid, label):
        return pg.evaluate("""([id, lb]) => { const c = Chart.getChart(document.getElementById(id)); if (!c) return null;
          const d = c.data.datasets.filter(x => x.label === lb)[0]; return d ? d.data.reduce((a, v) => a + (v || 0), 0) : null; }""", [cid, label])

    def tcount(key):
        return pg.evaluate("(k) => { const e = document.querySelector('[data-total=\"' + k + '\"]'); return e ? +e.innerText : null; }", key)

    def csv_rows(key):
        with pg.expect_download() as d:
            pg.click('[data-export="%s"]' % key)
        return list(csv.reader(io.StringIO(open(d.value.path(), 'rb').read().decode('utf-8-sig'))))

    for period, brand, typ in COMBOS:
        set_filter(period, brand, typ)
        tag = '/'.join([period, brand, typ])

        # 01 운영 종합 현황
        go('overview')
        t = M('(() => { const r = SCMMetrics.today(F); return { target: r.target, done: r.done, risk: r.risk, staff: r.staffAct, brands: r.brands.map(x => [x.id, x.done, x.target]) }; })()')
        cards = pg.evaluate("Array.from(document.querySelectorAll('.today-card')).map(c => [c.querySelector('.t-label').innerText, c.querySelector('.t-value').innerText])")
        cv = {k: num(v) for k, v in cards}
        check(cv.get('금일 B2C 출고 대상') == t['target'] and cv.get('출고 완료') == t['done'] and cv.get('마감 위험 물량') == t['risk'] and cv.get('출고 작업 인원') == t['staff'], '오늘 카드 ' + tag, (cv, t))
        prog = pg.evaluate("Array.from(document.querySelectorAll('[data-brand-progress]')).map(r => [r.getAttribute('data-brand-progress'), r.querySelector('.p-val').innerText])")
        check(len(prog) == len(t['brands']) and all(re.search(r'([\d,]+) / ([\d,]+)건', v) and int(re.search(r'([\d,]+) / ([\d,]+)건', v).group(1).replace(',', '')) == x[1] for (bid, v), x in zip(prog, t['brands'])), '화주사별 진행률 ' + tag, prog)
        kp = M("SCMMetrics.kpis(F).map(k => [k.key, k.na ? null : k.value])")
        shown = pg.evaluate("Array.from(document.querySelectorAll('[data-kpi]')).map(c => [c.getAttribute('data-kpi'), c.querySelector('.kpi-value').innerText])")
        for (key, v), (key2, txt) in zip(kp, shown):
            if v is None:
                check(txt.strip() == '—', 'KPI 해당 없음 표시 ' + key + ' ' + tag); continue
            n = num(txt)
            exp = {'sla': v * 100, 'b2b': v * 100, 'acc': v * 100, 'mis': v * 100, 'uph': v, 'ret': v, 'bill': v}[key]
            dec = {'mis': 2, 'uph': 1, 'ret': 1, 'bill': 0}.get(key, 1)
            check(key == key2 and abs(n - round(exp, dec)) < 10 ** -dec / 2 + 1e-9, 'KPI 카드 ' + key + ' ' + tag, (txt, exp))
        if typ != 'B2B':
            od = M("SCMMetrics.outboundDaily(F).reduce((a, r) => a + r.shipped, 0)")
            check(chart_ds('chOvTrend', '출고(건)') == od, '추이 차트 출고 합 ' + tag)

        # 02 화주사
        go('clients')
        sb = M("SCMMetrics.sla(F).byBrand.map(x => [x.id, x.rate])")
        cardsB = pg.evaluate("Array.from(document.querySelectorAll('[data-brand-card]')).map(c => [c.getAttribute('data-brand-card'), c.innerText])")
        for (bid, rate), (bid2, txt) in zip(sb, cardsB):
            m = re.search(r'SLA 준수율\s*([\d.]+)%', txt)
            check(bid == bid2 and (rate is None or (m and abs(float(m.group(1)) - round(rate * 100, 1)) < 0.051)), '화주사 카드 SLA ' + bid + ' ' + tag, (txt[:80], rate))

        # 03 입고
        go('inbound')
        ib = M("(() => { const r = SCMMetrics.inbound(F); return { n: r.n, recv: r.recv, defect: r.defect, list: r.list.length }; })()")
        st = stats()
        check(num(st.get('입고 건수')) == ib['n'] and num(st.get('실입고 수량')) == ib['recv'] and num(st.get('검수 불량')) == ib['defect'], '입고 요약 ' + tag, (st, ib))
        check(tcount('inboundList') == ib['list'] and len(csv_rows('inboundList')) - 1 == ib['list'], '입고 목록·CSV ' + tag)

        # 04 재고
        go('inventory')
        sv = M("(() => { const r = SCMMetrics.stockView(F); return { n: r.length, on: r.reduce((a, x) => a + x.onHand, 0), so: r.filter(x => x.status === '결품').length }; })()")
        st = stats()
        check(num(st.get('SKU')) == sv['n'] and num(st.get('보유 재고')) == sv['on'] and num(st.get('결품')) == sv['so'], '재고 요약 ' + tag, (st, sv))
        mx = pg.evaluate("(() => { const t = document.querySelector('table.matrix'); return [t.getAttribute('data-matrix'), Array.from(t.querySelectorAll('tbody tr')).reduce((a, tr) => a + (+tr.lastElementChild.innerText.replace(/,/g, '')), 0)]; })()")
        mxe = M("SCMMetrics.matrix('%s').rows.reduce((a, r) => a + r.cells.reduce((x, c) => x + c.avail, 0), 0)" % mx[0])
        check(mx[1] == mxe, '색상·사이즈 표 합계 ' + tag, (mx, mxe))
        rows = csv_rows('skuStock')
        check(len(rows) - 1 == sv['n'] == tcount('skuStock'), 'SKU 표·CSV 행 수 ' + tag)
        oi = rows[0].index('보유(pcs)')
        check(sum(int(r[oi] or 0) for r in rows[1:]) == sv['on'], 'SKU CSV 보유 합 ' + tag)

        # 05 공간
        go('space')
        zs = M("SCMMetrics.zones(F).map(z => [z.id, Math.round(z.util * 100)])")
        zv = pg.evaluate("Array.from(document.querySelectorAll('[data-zone]')).map(z => [z.getAttribute('data-zone'), z.querySelector('.z-val').innerText])")
        check([[a, num(bb)] for a, bb in zv] == [[a, float(v)] for a, v in zs], '존 적치율 ' + tag, (zv, zs))

        # 06 B2C
        go('b2c')
        if typ == 'B2B':
            check(pg.locator('.na-box').count() == 1, 'B2B만 선택 시 B2C 안내 ' + tag)
        else:
            s = M("(() => { const r = SCMMetrics.sla(F); return { n: r.n, late: r.late, lateList: r.lateList.length }; })()")
            st = stats()
            check(num(st.get('납기 지연')) == s['late'], 'B2C 지연 카드 ' + tag, (st.get('납기 지연'), s))
            check(chart_ds('chCause', '지연(건)') == s['late'], '지연 원인 차트 합 ' + tag)
            check(chart_ds('chB2cDaily', '출고(건)') == num(st.get('출고')), '일별 출고 차트 = 출고 카드 ' + tag)
            check(tcount('lateOrders') == s['lateList'], '지연 주문 목록 수 ' + tag)
            if s['lateList']:
                lr = csv_rows('lateOrders')
                check(len(lr) - 1 == s['lateList'], '지연 주문 CSV 행 수 ' + tag)

        # 07 B2B
        go('b2b')
        if typ == 'B2C':
            check(pg.locator('.na-box').count() == 1, 'B2C만 선택 시 B2B 안내 ' + tag)
        else:
            bb = M("(() => { const r = SCMMetrics.b2b(F); return { n: r.n, late: r.late, pcs: r.shippedPcs }; })()")
            st = stats()
            check(num(st.get('납기 대상')) == bb['n'] and num(st.get('B2B 출고')) == bb['pcs'], 'B2B 요약 ' + tag, (st, bb))
            check(chart_ds('chB2b', 'B2B 출고(pcs)') == bb['pcs'], 'B2B 차트 합 ' + tag)
            check(tcount('b2bList') == bb['n'], 'B2B 목록 수 ' + tag)

        # 08 반품
        go('returns')
        rt = M("(() => { const r = SCMMetrics.returns(F); return { a: r.arrived, d: r.done, bl: r.backlog }; })()")
        st = stats()
        check(num(st.get('반품 도착')) == rt['a'] and num(st.get('검수 완료')) == rt['d'] and num(st.get('검수 대기')) == rt['bl'], '반품 요약 ' + tag, (st, rt))
        check(chart_ds('chRet', '도착(건)') == rt['a'] and chart_ds('chRet', '검수 완료(건)') == rt['d'], '반품 차트 합 ' + tag)
        check(tcount('retWait') == rt['bl'], '검수 대기 목록 수 ' + tag)

        # 09 인력
        go('labor')
        lb = M("(() => { const r = SCMMetrics.labor(F); return { days: r.days.length, ot: Math.round(r.otH) }; })()")
        st = stats()
        check(num(st.get('근무일')) == lb['days'] and num(st.get('연장 근무')) == lb['ot'], '인력 요약 ' + tag, (st, lb))
        check(tcount('laborDays') == lb['days'], '일별 인원 표 행 수 ' + tag)

        # 10 정산
        go('billing')
        bl = M("(() => { const r = SCMMetrics.billing(F); return { diff: r.diff, rows: r.rows.length, d: r.diffRows.length }; })()")
        st = stats()
        check(num(st.get('정산 차이')) == bl['diff'], '정산 차이 카드 ' + tag, (st.get('정산 차이'), bl))
        rows = csv_rows('billRows')
        check(len(rows) - 1 == bl['rows'], '정산 명세 CSV 행 수 ' + tag)
        di = rows[0].index('차이(원)')
        check(sum(int(r[di] or 0) for r in rows[1:]) == bl['diff'], '정산 명세 CSV 차이 합 ' + tag)

        # 11 이슈
        go('issues')
        n_is = M('SCMMetrics.issues(F).length')
        check(tcount('issueLog') == n_is, '이슈 로그 수 ' + tag)
        rep = csv_rows('report')
        check(len(rep) > 5, '일일 보고서 CSV ' + tag)

        # 용어 해설 UI 없음
        for sid in ['intro', 'overview', 'inventory', 'billing']:
            go(sid)
            txt = pg.evaluate('document.body.innerText')
            check(not any(g in txt for g in GLOSSARY_TEXT) and pg.evaluate('(s) => document.querySelectorAll(s).length', GLOSSARY_SEL) == 0, '용어 해설 UI 없음 ' + sid + ' ' + tag)

    # 표 검색·페이지
    set_filter('90d', 'ALL', 'ALL')
    go('inventory')
    total = tcount('skuStock')
    pg.fill('[data-search="skuStock"]', 'B-SL')
    pg.wait_for_timeout(300)
    n = tcount('skuStock')
    exp = M("SCMMetrics.stockView(F).filter(r => r.id.indexOf('B-SL') === 0).length")
    check(n == exp and n < total, '표 검색 결과 수', (n, exp, total))
    check(len(csv_rows('skuStock')) - 1 == n, '검색 후 CSV = 검색 결과')
    pg.fill('[data-search="skuStock"]', '')
    pg.wait_for_timeout(300)
    first = pg.evaluate("document.querySelector('[data-tbody=\"skuStock\"] tbody tr td').innerText")
    pg.click('[data-page="skuStock"][data-dir="1"]')
    pg.wait_for_timeout(300)
    second = pg.evaluate("document.querySelector('[data-tbody=\"skuStock\"] tbody tr td').innerText")
    check(first != second and pg.locator('.pager').first.inner_text().startswith('16'), '표 다음 페이지', (first, second))
    # 기간 직접 선택: 시작 > 종료면 자동 교체
    pg.select_option('#fPeriod', 'custom'); pg.wait_for_timeout(300)
    pg.fill('#fFrom', '2026-09-20'); pg.dispatch_event('#fFrom', 'change'); pg.wait_for_timeout(200)
    pg.fill('#fTo', '2026-09-01'); pg.dispatch_event('#fTo', 'change'); pg.wait_for_timeout(400)
    rng = M('[F.from, F.to]')
    check(rng[0] < rng[1], '직접 선택 기간 순서 보정', rng)

    check(not errs, '콘솔 오류 없음', errs[:3])
    b.close()

print(json.dumps({'pass': passes, 'fail': len(fails), 'fails': fails[:30]}, ensure_ascii=False, indent=1))
sys.exit(1 if fails else 0)
