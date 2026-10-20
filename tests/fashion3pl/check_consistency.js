/* Fashion 3PL Control Tower — 계산 일치 점검 (Node)
 * 사용법: node tests/fashion3pl/check_consistency.js
 * 재고 수불, SLA·B2B·반품·입고 합계, 오늘 현황, 정산 대조, KPI 값, 필터 조합별 합계를 확인합니다. 실패가 있으면 종료 코드 1. */
'use strict';
var path = require('path');
var dir = path.join(__dirname, '..', '..', 'demos', 'scm-dashboard', 'js');
require(path.join(dir, 'data.js'));
require(path.join(dir, 'metrics.js'));
var D = globalThis.SCM_DATA, S = globalThis.SCMMetrics, C = D.cal, END = D.meta.END_DAY;
var pass = 0, fails = [];
function ok(c, name, detail) { if (c) pass++; else fails.push(name + (detail !== undefined ? ' :: ' + JSON.stringify(detail) : '')); }
function eq(a, b, name) { ok(a === b, name, [a, b]); }
function near(a, b, name, tol) { ok(Math.abs(a - b) <= (tol || 1e-6), name, [a, b]); }
function sum(a, f) { return a.reduce(function (s, x) { return s + (f ? f(x) : x); }, 0); }
function units(o) { return sum(o.lines, function (l) { return l[1]; }); }

/* 1) 재고 수불: 시작 + 적치(불량 제외) + A급 재입고 − B2C 출고·할당 − B2B 할당 = 가용, 할당 = 오늘 출고 예정 */
var inNet = D.skus.map(function () { return 0; }), retA = D.skus.map(function () { return 0; }), b2c = D.skus.map(function () { return 0; }), b2bA = D.skus.map(function () { return 0; }), plan = D.skus.map(function () { return 0; });
D.inbound.forEach(function (x) { if (x.putaway !== null) x.recv.forEach(function (l) { inNet[l[0]] += l[1] - l[2]; }); });
D.returns.forEach(function (r) { if (r.grade === 'A급 재입고') retA[r.sku]++; });
D.orders.forEach(function (o) {
  if (o.ship !== null) o.lines.forEach(function (l) { b2c[l[0]] += l[1]; });
  if (o.plan !== null) o.lines.forEach(function (l) { b2c[l[0]] += l[1]; plan[l[0]] += l[1]; });
  ok(!(o.ship !== null && o.plan !== null), '출고와 예정이 동시에 있으면 안 됨 ' + o.id);
});
D.b2b.forEach(function (x) { if (x.alloc) x.alloc.forEach(function (l) { b2bA[l[0]] += l[1]; }); if (x.plan !== undefined) x.alloc.forEach(function (l) { plan[l[0]] += l[1]; }); });
D.skus.forEach(function (s, i) {
  eq(D.startStock[i] + inNet[i] + retA[i] - b2c[i] - b2bA[i], D.stock[i], '수불 가용 ' + s.id);
  eq(D.alloc[i], plan[i], '할당 = 오늘 출고 예정 ' + s.id);
  ok(D.stock[i] >= 0, '가용 음수 없음 ' + s.id);
});
D.brands.forEach(function (b) {
  eq(D.stockDaily[END][b.id], sum(D.skus.filter(function (s) { return s.brand === b.id; }), function (s) { return D.stock[s.idx] + D.alloc[s.idx]; }), '마지막 날 브랜드 재고 = SKU 합계 ' + b.id);
});

/* 2) 주문 기본 규칙 */
D.orders.forEach(function (o) {
  if (o.ship !== null) {
    ok(o.ship >= o.day && C.isBiz(o.ship), '출고일은 접수일 이후 영업일 ' + o.id);
    ok(o.ship > o.day || o.shipT >= o.t, '같은 날 출고는 접수 이후 ' + o.id);
    ok(o.pickT <= o.packT && o.packT <= o.shipT, '피킹 ≤ 패킹 ≤ 출고 ' + o.id);
    eq(o.late, o.ship > o.due && o.hold === null, '지연 표시 = 납기 초과 ' + o.id);
  }
  if (o.late) ok(!!o.cause, '지연 주문에 원인 ' + o.id);
  var b = D.brands.filter(function (x) { return x.id === o.brand; })[0];
  if (!o.ex) eq(o.due, C.isBiz(o.day) && o.t < b.cutoff ? o.day : C.nextBiz(o.day), '납기 규칙(마감 시각) ' + o.id);
});
D.shipByDay.forEach(function (list, d) { list.forEach(function (o) { eq(o.ship, d, '출고일 인덱스 ' + o.id); }); });

/* 3) 필터 조합별 합계 */
var periods = ['7d', '30d', '90d', 'all'], brands = ['ALL'].concat(D.brands.map(function (b) { return b.id; })), types = ['ALL', 'B2C', 'B2B'];
periods.forEach(function (p) { brands.forEach(function (br) { types.forEach(function (ty) {
  var F = S.resolveFilter({ period: p, brand: br, type: ty }), tag = p + '/' + br + '/' + ty;
  var s = S.sla(F);
  eq(s.onTime + s.late, s.n, 'SLA 준수+지연=대상 ' + tag);
  eq(sum(Object.keys(s.causes), function (k) { return s.causes[k]; }), s.late, 'SLA 원인 합 = 지연 ' + tag);
  eq(sum(s.byBrand, function (x) { return x.n; }), s.n, 'SLA 화주사 합 ' + tag);
  var sd = S.slaDaily(F);
  eq(sum(sd, function (r) { return r.n; }), s.n, 'SLA 일별 합 ' + tag);
  eq(sum(sd, function (r) { return r.late; }), s.late, 'SLA 일별 지연 합 ' + tag);
  if (ty === 'B2B') eq(s.n, 0, 'B2B만 선택 시 B2C SLA 없음 ' + tag);

  var bb = S.b2b(F);
  eq(bb.list.filter(function (x) { return x.late; }).length, bb.late, 'B2B 지연 수 ' + tag);
  if (bb.qty) near(bb.fill, bb.shipQty / bb.qty, 'B2B 충족률 ' + tag);
  if (ty === 'B2C') eq(bb.n, 0, 'B2C만 선택 시 B2B 없음 ' + tag);

  var od = S.outboundDaily(F), ms = S.misship(F);
  eq(sum(od, function (r) { return r.shipped; }), ms.shipped, '일별 출고 합 = 오출고 분모 ' + tag);
  eq(sum(od, function (r) { return r.b2bPcs; }), bb.shippedPcs, '일별 B2B pcs 합 ' + tag);
  eq(sum(S.orderHours(F)), sum(od, function (r) { return r.received; }), '시간대별 합 = 접수 합 ' + tag);

  var rt = S.returns(F), rd = S.returnsDaily(F), before = S.returns(S.withPeriod(F, Math.max(0, F.from - 1), Math.max(0, F.from - 1)));
  eq(sum(rd, function (r) { return r.arrived; }), rt.arrived, '반품 일별 도착 합 ' + tag);
  eq(sum(rd, function (r) { return r.done; }), rt.done, '반품 일별 처리 합 ' + tag);
  eq(rd[rd.length - 1].backlog, rt.backlog, '반품 대기 = 마지막 날 대기 ' + tag);
  if (F.from > 0) eq(before.backlog + rt.arrived - rt.done, rt.backlog, '반품 대기 흐름(전일 대기+도착−처리) ' + tag);
  eq(sum(Object.keys(rt.reasons), function (k) { return rt.reasons[k]; }), rt.arrived, '반품 사유 합 ' + tag);
  eq(sum(Object.keys(rt.grades), function (k) { return rt.grades[k]; }), rt.done, '검수 판정 합 ' + tag);

  var ib = S.inbound(F);
  eq(ib.asn - ib.diff, ib.recv, '입고 예정 − 부족 = 실입고 ' + tag);

  var t = S.today(F);
  eq(sum(Object.keys(t.stages), function (k) { return t.stages[k]; }), t.target, '오늘 단계 합 = 대상 ' + tag);
  eq(t.done + t.inprog, t.target, '오늘 완료+진행 = 대상 ' + tag);
  eq(sum(t.brands, function (x) { return x.target; }), t.target, '오늘 화주사 합 ' + tag);
  eq(sum(t.brands, function (x) { return x.risk; }), t.risk, '오늘 위험 합 ' + tag);

  var k = S.kpis(F), get = function (key) { return k.filter(function (x) { return x.key === key; })[0]; };
  if (!get('sla').na) near(get('sla').value, s.rate, 'KPI SLA = sla() ' + tag);
  if (!get('b2b').na) near(get('b2b').value, bb.rate, 'KPI B2B = b2b() ' + tag);
  if (!get('mis').na) near(get('mis').value, ms.rate, 'KPI 오출고 = misship() ' + tag);
  if (!get('ret').na) near(get('ret').value, rt.avgLead, 'KPI 반품 = returns() ' + tag);
  var bl = S.billing(F);
  if (!get('bill').na) eq(get('bill').value, bl.diff, 'KPI 정산 = billing() ' + tag);
  eq(sum(bl.byBrand, function (x) { return x.billed; }), bl.billed, '정산 화주사 합 ' + tag);
  eq(sum(bl.months, function (x) { return x.actual; }), bl.actual, '정산 월 합 ' + tag);

  var sv = S.stockView(F);
  eq(sv.length, D.skus.filter(function (x) { return S.bOk(F, x.brand); }).length, '재고 SKU 수 ' + tag);
  var zs = S.zones(F);
  eq(sum(zs, function (z) { return z.onHand; }), sum(sv, function (r) { return r.onHand; }), '존 재고 합 = SKU 보유 합 ' + tag);
  zs.forEach(function (z) { eq(z.season.SS + z.season.FW + z.season.ALL, z.onHand, '존 시즌 구성 합 ' + z.id + ' ' + tag); });
}); }); });

/* 4) 정산: 실적 재계산 = 데이터 수량, 청구 차이는 의도한 3줄만 */
var Fall = S.resolveFilter({ period: 'all', brand: 'ALL', type: 'ALL' }), bl = S.billing(Fall);
bl.rows.forEach(function (r) {
  var err = D.billErrors.filter(function (e) { return e.month === r.month && e.brand === r.brand && e.item === r.item; })[0];
  var q = D.monthQty(D.brands.filter(function (b) { return b.id === r.brand; })[0], r.month);
  var it = D.billItems.filter(function (x) { return x.key === r.item; })[0];
  eq(r.qty, it.qty(q), '실적 수량 재계산 일치 ' + r.month + r.brand + r.item);
  if (!err) eq(r.diff, 0, '오류 없는 줄 차이 0 ' + r.month + r.brand + r.item);
  else eq(r.diff, err.kind === 'qty' ? Math.round((r.qty + err.delta) * r.rate) - r.actual : Math.round(r.qty * (r.rate + err.delta)) - r.actual, '오류 줄 차이 = 지정값 ' + r.month + r.brand + r.item);
});
eq(bl.diffRows.length, D.billErrors.length, '청구 차이 줄 수');

/* 5) 시나리오가 수치에 나타나는지 */
var sc = D.meta.scenarioDays;
eq(D.orders.some(function (o) { return o.cause === '프로모션 물량 급증'; }), true, '시나리오: 프로모션 지연 발생');
eq(D.orders.some(function (o) { return o.cause === '결품 대기' && o.lines.some(function (l) { return D.skus[l[0]].id === sc.stockoutSku; }); }), true, '시나리오: 결품 SKU 지연');
eq(D.orders.some(function (o) { return o.cause === '작업 인력 부족'; }), true, '시나리오: 인력 부족 지연');
eq(D.b2b.some(function (x) { return x.late && x.brand === 'C'; }), true, '시나리오: 브랜드 C B2B 지연');
var rS = S.returns(S.withPeriod(Fall, sc.retTempFrom - 1, sc.retTempFrom - 1));
ok(rS.backlog >= 300, '시나리오: 반품 인원 추가 전 대기 300건 이상', rS.backlog);

console.log(JSON.stringify({ pass: pass, fail: fails.length, fails: fails.slice(0, 30) }, null, 1));
process.exit(fails.length ? 1 : 0);
