/* 다품종 3PL 운영 대시보드 — 계산 일치 점검 (Node)
 * 사용법: node tests/check_consistency.js   (실패가 있으면 종료 코드 1)
 * 전체 = 산업별 합계, 필터별 KPI, 재고 중복 차감, 취소·반품 중복 처리, 산업별 재고 규칙, 소비기한·로트, 옵션별 재고 합계, 정산 합계를 확인합니다. */
'use strict';
var path = require('path');
var dir = path.join(__dirname, '..', '..', 'demos', 'scm-dashboard', 'js');
require(path.join(dir, 'data.js'));
require(path.join(dir, 'metrics.js'));
var D = globalThis.SCM_DATA, S = globalThis.SCMMetrics, C = D.cal, M = D.meta, END = M.END_DAY, IT = D.IT, INDI = D.INDI;
var pass = 0, fails = [];
function ok(c, name, detail) { if (c) pass++; else fails.push(name + (detail !== undefined ? ' :: ' + JSON.stringify(detail) : '')); }
function eq(a, b, name) { ok(a === b, name, [a, b]); }
function near(a, b, name) { ok(Math.abs(a - b) < 1e-6, name, [a, b]); }
function sum(a, f) { return a.reduce(function (s, x) { return s + (f ? f(x) : x); }, 0); }
var ALL = S.resolveFilter({ period: 'all', ind: 'ALL', ch: 'ALL' });
var INDS = D.inds.map(function (x) { return x.id; });

/* 1) 주문 단계와 수량 */
D.orders.forEach(function (o) {
  var st = o.cancelStage;
  if (st === '피킹 전 취소') { eq(o.waved, null, '피킹 전 취소는 피킹 없음 ' + o.id); eq(o.inv, null, '피킹 전 취소는 송장 없음 ' + o.id); }
  if (st === '송장 발행 후 취소') { eq(o.ship, null, '송장 취소 주문 출고 없음 ' + o.id); eq(D.INV[o.inv].status, '취소', '취소 송장 상태 ' + o.id); }
  if (o.waved !== null) { ok(C.isBiz(o.waved) && o.waved >= o.elig, '피킹일 ≥ 가능일, 영업일 ' + o.id); eq(o.invDay, o.waved, '송장 등록 = 피킹일 ' + o.id); }
  if (o.ship !== null) {
    ok(o.ship >= o.waved, '출고 ≥ 송장 ' + o.id);
    Object.keys(o.need).forEach(function (c) { eq(sum(o.picks.filter(function (p) { return p.item === c; }), function (p) { return p.qty; }), o.need[c], '세트 전개 수량 = 피킹 수량 ' + o.id + ' ' + c); });
    o.picks.forEach(function (p) { var l = D.LOT[p.lot]; eq(l.item, p.item, '로트 상품 일치 ' + o.id); ok(o.waved >= l.holdUntil && (l.exp === null || l.exp - o.waved >= M.MIN_REMAIN), '배정 로트는 보류·출고 제한 아님 ' + o.id); });
  }
  if (o.kind === '재출고') ok(D.OD[o.parent] && D.OD[o.parent].kind === '주문' && D.OD[o.parent].ind === o.ind, '재출고 원주문 연결 ' + o.id);
});
D.dailyOps.forEach(function (x) { ok(x.shipped <= x.cap || (x.cap === 0 && x.shipped === 0), '처리 능력 이내 ' + C.isoOf(x.d)); });

/* 2) 산업별 재고 규칙 */
D.orders.forEach(function (o) {
  if (o.waved === null || !o.picks) return;
  o.picks.forEach(function (p) { var it = IT[p.item]; eq(it.ind, o.ind, '화주 간 재고 혼용 없음 ' + o.id); if (INDI[o.ind].hasExpiry) ok(p.exp !== null, '기한 관리 산업군은 소비기한 있음 ' + o.id); else eq(p.exp, null, '기한 없는 산업군 ' + o.id); });
});
D.items.forEach(function (x) { if (x.ind === 'FSH') ok(x.color && x.size && x.season, '의류 옵션 필드 ' + x.id); if (x.ind === 'HOM' && x.serial) ok(x.model, '가전 모델명 ' + x.id); if (x.ind === 'GFT' && x.id.indexOf('-NK') > 0) ok(x.option, '주얼리 옵션 ' + x.id); });
var fefoBad = 0; D.orders.forEach(function (o) { if (o.ship === null || !INDI[o.ind].hasExpiry) return; var by = {}; o.picks.forEach(function (p) { (by[p.item] = by[p.item] || []).push(p.exp); }); Object.keys(by).forEach(function (k) { var a = by[k]; for (var i = 1; i < a.length; i++) if (a[i] < a[i - 1]) fefoBad++; }); });
eq(fefoBad, 0, '한 주문 안 FEFO 배정 순서');

/* 3) 로트 재고 재계산 (중복 차감 방지) */
var outByLot = {}; D.orders.forEach(function (o) { if (o.ship !== null) o.picks.forEach(function (p) { outByLot[p.lot] = (outByLot[p.lot] || 0) + p.qty; }); });
D.lots.forEach(function (l) {
  var ret = sum(D.moves.filter(function (m) { return m.lot === l.id && m.type === '반품 입고'; }), function (m) { return m.qty; });
  var dmg = sum(D.damages.filter(function (x) { return x.lot === l.id; }), function (x) { return x.qty; });
  var mis = sum(D.gaps.filter(function (g) { return g.lot === l.id && /오출고/.test(g.cause); }), function (g) { return g.q; });
  eq(l.inQty + ret - (outByLot[l.id] || 0) - dmg + mis, l.good, '로트 실물 재계산 ' + l.id);
  ok(l.good >= 0 && l.res >= 0 && l.dmg >= 0, '음수 재고 없음 ' + l.id);
});
eq(sum(D.lots, function (l) { return l.res; }), sum(D.orders, function (o) { return o.waved !== null && o.ship === null && o.cancelStage !== '송장 발행 후 취소' ? sum(o.picks, function (p) { return p.qty; }) : 0; }), '출고 예약 = 미출고 주문 배정 수량');

/* 4) 실사 */
var ct = S.counts(ALL);
ct.diffs.forEach(function (r) { eq(sum(r.causes, function (c) { return c.qty; }), r.diff, '실사 차이 = 원인 합계 ' + C.isoOf(r.d) + ' ' + r.item); });
ok(ct.diffs.some(function (r) { return r.causes.some(function (c) { return c.cause === '출고 확정 전산 누락'; }); }), '전산 누락 시나리오');
ok(ct.diffs.some(function (r) { return r.causes.some(function (c) { return c.cause === '파손 전산 미등록'; }); }), '파손 미등록 시나리오');

/* 5) 전체 = 산업별 합계 */
function perInd(fn) { return sum(INDS, function (i) { return fn(S.resolveFilter({ period: 'all', ind: i, ch: 'ALL' })); }); }
eq(perInd(function (F) { return S.flow(F).reach['주문 접수']; }), S.flow(ALL).reach['주문 접수'], '주문 접수 전체 = 산업별 합');
eq(perInd(function (F) { return S.outbound(F).ship; }), S.outbound(ALL).ship, '출고 건수 전체 = 산업별 합');
eq(perInd(function (F) { return S.outbound(F).shipUnits; }), S.outbound(ALL).shipUnits, '출고 수량 전체 = 산업별 합');
eq(perInd(function (F) { return S.inbound(F).recv; }), S.inbound(ALL).recv, '입고 수량 전체 = 산업별 합');
eq(perInd(function (F) { return S.inbound(F).good; }), S.inbound(ALL).good, '입고 합격 전체 = 산업별 합');
eq(perInd(function (F) { return S.issues(F).rets.length; }), S.issues(ALL).rets.length, '반품 전체 = 산업별 합');
eq(perInd(function (F) { return S.counts(F).n; }), S.counts(ALL).n, '실사 행 전체 = 산업별 합');
eq(perInd(function (F) { return sum(S.stockNow(F), function (r) { return r.good; }); }), sum(S.stockNow(ALL), function (r) { return r.good; }), '재고 전체 = 산업별 합');
eq(perInd(function (F) { return S.settlement(F).diff; }), S.settlement(ALL).diff, '정산 차이 전체 = 산업별 합');
D.proc.forEach(function (p) { eq(perInd(function (F) { return S.labor(F).proc.filter(function (x) { return x.key === p.key; })[0].vol; }), S.labor(ALL).proc.filter(function (x) { return x.key === p.key; })[0].vol, '공정 물량 전체 = 산업별 합 ' + p.key); });
D.channels.forEach(function (c) { ok(S.outbound(S.resolveFilter({ period: 'all', ind: 'ALL', ch: c.id })).ship > 0, '채널 출고 있음 ' + c.id); });
eq(sum(D.channels, function (c) { return S.outbound(S.resolveFilter({ period: 'all', ind: 'ALL', ch: c.id })).ship; }), S.outbound(ALL).ship, '출고 전체 = 채널별 합');
var dtotal = sum(D.labor, function (l) { return l.vol.pack; }); eq(dtotal, S.outbound(ALL).ship, '인력 실적 패킹 = 출고 건수');

/* 6) 재고 구조 */
var sn = S.stockNow(ALL);
sn.forEach(function (r) { eq(r.normal + r.hold + r.limited, r.good, '정상 + 보류 + 제한 = 실물 ' + r.item); eq(r.avail, r.normal - r.res, '가용 = 정상 − 예약 ' + r.item); ok(r.avail >= 0, '가용 음수 없음 ' + r.item); });
eq(sum(S.matrix(), function (s) { return s.total; }), sum(sn.filter(function (r) { return r.ind === 'FSH'; }), function (r) { return r.good; }), '색상·사이즈 합계 = 의류 재고');
var ex = S.expiry(ALL);
eq(sum(ex.buckets, function (b) { return b.units; }), sum(sn.filter(function (r) { return INDI[r.ind].hasExpiry; }), function (r) { return r.good; }), '소비기한 구간 합계 = 기한 관리 재고');
eq(ex.buckets[0].units, sum(sn, function (r) { return r.limited; }), '60일 미만 구간 = 출고 제한 재고');
ok(ex.buckets[0].units > 0, '임박 재고 시나리오');
eq(sum(S.zones(ALL), function (z) { return z.units; }), sum(D.lots, function (l) { return l.good + l.dmg; }), '존 합계 = 전체 실물');
S.zones(ALL).forEach(function (z) { ok(z.util > 0 && z.util < 1.05, '존 적치율 범위 ' + z.id, z.util); });
S.sets(ALL).forEach(function (s) { ok(s.can >= 0, '세트 조립 가능 ' + s.item); });
eq(D.stockDaily[END].FSH, sum(D.lots.filter(function (l) { return l.ind === 'FSH'; }), function (l) { return l.good; }), '일별 재고 기록');

/* 7) 반품 */
var seen = {}; D.retLog.forEach(function (x) { if (x.result === '재고 반영') { ok(!seen[x.ret], '반품 1회 반영 ' + x.ret); seen[x.ret] = 1; } });
eq(D.retLog.filter(function (x) { return x.result === '중복 등록 차단'; }).length, 2, '반품 중복 차단 2건');
D.orders.forEach(function (o) { if (o.ret && o.ret.done !== null) { eq(D.moves.filter(function (m) { return m.ref === o.ret.id; }).length, 1, '반품 이동 이력 1건 ' + o.ret.id); ok(INDI[o.ind].retGrades.indexOf(o.ret.grade) >= 0, '산업군 판정 기준 ' + o.ret.id); } });
ok(D.orders.filter(function (o) { return o.ind === 'FOD' && o.ret && o.ret.grade; }).every(function (o) { return o.ret.grade === '폐기'; }), '식품 반품은 재판매 안 함');

/* 8) 입고 */
D.receipts.forEach(function (r) { eq(r.ok + r.ng, r.recv, '합격 + 불량 = 입고 ' + r.id); eq(sum(r.ngBy), r.ng, '항목별 불량 합 ' + r.id); ok(r.recv <= r.plan, '입고 ≤ 예정 ' + r.id); ok(r.put > r.arrive, '적치 > 도착 ' + r.id); if (r.ind === 'FOD') ok(r.hold > r.put, '식품 라벨 보류 ' + r.id); });

/* 9) 정산 */
var st = S.settlement(ALL), B = M.sc.bill;
eq(st.causes.length, 4, '정산 원인 4종', st.causes.map(function (c) { return c.cause; }));
eq(sum(st.diffs, function (d) { return d.diff; }), st.diff, '차이 합계');
near(sum(st.evidence, function (e) { return e.amount; }), st.diff, '근거 금액 합계 = 정산 차이');
eq(sum(st.causes, function (c) { return c.amount; }), st.diff, '원인별 합계 = 정산 차이');
st.diffs.forEach(function (d) { ok(d.cause !== S.CAUSES[4], '근거 없는 차이 없음 ' + d.month + d.ind + d.item); });
st.rows.forEach(function (r) { eq(r.billed, r.billQty * r.billRate, '금액 = 수량 × 단가 ' + r.month + r.ind + r.item); });
C.months.forEach(function (m) { INDS.forEach(function (i) { eq(st.rows.filter(function (r) { return r.month === m && r.ind === i; }).length, D.billItems.length, '정산 항목 수 ' + m + i); }); });

/* 10) 필터 조합 */
var COMBOS = [['all', 'ALL', 'ALL'], ['all', 'FOD', 'ALL'], ['all', 'FSH', 'OMA'], ['90d', 'BEA', 'ALL'], ['30d', 'HOM', 'B2B'], ['30d', 'GFT', 'OWN'], ['custom', 'ALL', 'ALL', '2026-09-01', '2026-09-30'], ['custom', 'FOD', 'OMB', '2026-08-10', '2026-08-25']];
COMBOS.forEach(function (cb) {
  var F = S.resolveFilter({ period: cb[0], ind: cb[1], ch: cb[2], from: cb[3], to: cb[4] }), tag = cb.join('/'), fl = S.flow(F), k = {}; S.commonKpis(F).forEach(function (x) { k[x.key] = x; });
  S.integrity(F).filter(function (c) { return !c.info; }).forEach(function (c) { eq(c.n, 0, '정합성 ' + c.check + ' ' + tag); });
  if (fl.sameDayRate !== null) near(k.same.value, fl.sameDayRate, 'KPI 당일 출고 ' + tag);
  eq(k.ship.value, D.orders.filter(function (o) { return o.ship !== null && o.ship >= F.from && o.ship <= F.to && (F.ind === 'ALL' || o.ind === F.ind) && (F.ch === 'ALL' || o.ch === F.ch); }).length, 'KPI 출고 ' + tag);
  var r = fl.reach, st2 = S.STAGES; for (var i = 1; i < st2.length; i++) ok(r[st2[i]] <= r[st2[i - 1]], '단계 감소 ' + st2[i] + ' ' + tag);
  var p = S.pivot(F, 'ind', 'month', 'orders'), ob = S.outbound(F); eq(p.total, ob.ship, '피벗 합계 = 출고 건수 ' + tag);
  var p2 = S.pivot(F, 'ch', 'ind', 'units'); eq(p2.total, ob.shipUnits, '피벗 수량 합계 ' + tag);
  var dl = S.daily(F); eq(dl.length ? dl[dl.length - 1].backlog : 0, D.orders.filter(function (o) { return (F.ind === 'ALL' || o.ind === F.ind) && (F.ch === 'ALL' || o.ch === F.ch) && o.invDay !== null && o.invDay <= F.to && !(o.ship !== null && o.ship <= F.to) && !(o.cancelStage === '송장 발행 후 취소' && o.cancel <= F.to); }).length, '출고 대기 ' + tag);
  var oc = S.orderCheck(F); eq(oc.rows, fl.list.length + oc.dups.length, '주문서 행 ' + tag);
  if (F.ind !== 'ALL') S.indKpis(F).forEach(function (x) { ok(x.value === null || !isNaN(x.value), '산업 KPI 숫자 ' + x.key + ' ' + tag); });
  eq(S.indKpis(S.resolveFilter({ period: 'all', ind: 'ALL', ch: 'ALL' })).length, 0, '전체에서 산업 전용 KPI 없음 ' + tag);
});

console.log('pass', pass, 'fail', fails.length);
if (fails.length) { console.log(fails.slice(0, 30).join('\n')); process.exit(1); }
