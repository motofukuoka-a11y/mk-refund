const $ = id => document.getElementById(id);
const yen = n => `${Math.max(0, Math.round(n)).toLocaleString('ja-JP')}円`;
const floor10 = n => Math.floor(n / 10) * 10;
const ceil10 = n => Math.ceil(n / 10) * 10;
const parseDate = value => value ? new Date(`${value}T00:00:00`) : null;
const addDays = (date, days) => { const next = new Date(date); next.setDate(next.getDate() + days); return next; };
const addMonths = (date, months) => { const next = new Date(date); const day = next.getDate(); next.setDate(1); next.setMonth(next.getMonth() + months); const last = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate(); next.setDate(Math.min(day, last)); return next; };
const compareDate = (a, b) => a.getTime() - b.getTime();
const formatDateInput = date => {
  const local = new Date(date);
  local.setMinutes(local.getMinutes() - local.getTimezoneOffset());
  return local.toISOString().slice(0, 10);
};

const [segments, stations, mainFares, localFares, charges, commuterFares] = await Promise.all(
  ['segments', 'stations', 'ordinary_fares_main', 'ordinary_fares_local', 'charges', 'teiki_fare_master']
    .map(name => fetch(`./data/${name}.json`).then(response => response.json()))
);

stations.forEach(station => { const option = document.createElement('option'); option.value = station; $('stations').append(option); });
const graph = new Map();
for (const segment of segments) {
  if (segment.status !== 'active') continue;
  for (const [from, to] of [[segment.from, segment.to], [segment.to, segment.from]]) {
    if (!graph.has(from)) graph.set(from, []);
    graph.get(from).push({ ...segment, from, to });
  }
}

function shortest(start, goal) {
  const distances = new Map([[start, 0]]), previous = new Map(), queue = [{ station: start, cost: 0 }];
  while (queue.length) {
    queue.sort((a, b) => a.cost - b.cost);
    const current = queue.shift();
    if (current.cost !== distances.get(current.station)) continue;
    if (current.station === goal) break;
    for (const edge of graph.get(current.station) || []) {
      const cost = current.cost + Number(edge.business_km || 0);
      if (cost < (distances.get(edge.to) ?? Infinity)) {
        distances.set(edge.to, cost);
        previous.set(edge.to, { station: current.station, edge });
        queue.push({ station: edge.to, cost });
      }
    }
  }
  if (!distances.has(goal)) throw new Error(`${start}から${goal}までの経路を特定できません。`);
  const result = [];
  let station = goal;
  while (station !== start) {
    const item = previous.get(station);
    result.unshift(item.edge);
    station = item.station;
  }
  return result;
}

function route(from, to, vias) {
  const points = [from, ...vias, to], result = [];
  for (let index = 0; index < points.length - 1; index += 1) result.push(...shortest(points[index], points[index + 1]));
  return result;
}

function totals(routeSegments) {
  const business = routeSegments.reduce((sum, segment) => sum + Number(segment.business_km || 0), 0);
  const conversion = routeSegments.reduce((sum, segment) => sum + Number(segment.conversion_km || 0), 0);
  const main = routeSegments.some(segment => segment.line_type === '幹線');
  const local = routeSegments.some(segment => segment.line_type === '地方交通線');
  if (main && local && business > 10) return { business, conversion, km: Math.ceil(conversion), table: mainFares, label: '幹線表（運賃計算キロ）', commuterLineType: '幹線' };
  if (local && !main) return { business, conversion, km: Math.ceil(business), table: localFares, label: '地方交通線表（営業キロ）', commuterLineType: '地方交通線' };
  if (main && local) return { business, conversion, km: Math.ceil(business), table: localFares, label: '地方交通線表（10km以内）', commuterLineType: '幹線' };
  return { business, conversion, km: Math.ceil(business), table: mainFares, label: '幹線表（営業キロ）', commuterLineType: '幹線' };
}

function fare(table, km, passenger) {
  const row = table.find(item => km >= Number(item['最小km']) && km <= Number(item['最大km']));
  if (!row) throw new Error(`${km}kmに対応する普通運賃がありません。`);
  return Number(row[passenger === 'child' ? '小児片道運賃' : '大人片道運賃']);
}

function commuterMasterFare(routeInfo, category, months) {
  const businessKm = Math.ceil(routeInfo.business);
  const findFare = period => {
    const row = commuterFares.find(item => item.lineType === routeInfo.commuterLineType
      && Number(item.businessKm) === businessKm
      && item.category === category
      && Number(item.months) === period);
    if (!row) throw new Error(`${routeInfo.commuterLineType} ${businessKm}km・${category}・${period}箇月の定期運賃がマスタにありません。`);
    return Number(row.fare);
  };
  if ([1, 3, 6].includes(months)) return findFare(months);
  if (months === 2) return findFare(1) * 2;
  if (months === 4) return findFare(3) + findFare(1);
  if (months === 5) return findFare(3) + findFare(1) * 2;
  throw new Error('期間は1箇月から6箇月で選択してください。');
}

function oneMonthCommuterFare(routeInfo, category) {
  return commuterMasterFare(routeInfo, category, 1);
}

function charge(kind, km, passenger) {
  let rows = charges.filter(row => row['構成要素'] === kind);
  if (kind === 'limited_express_reserved') rows = rows.filter(row => row['表ID'] === (km <= 150 ? 'JRH_HOKKAIDO_SPECIAL_RESERVED' : 'JRH_A_EXPRESS_RESERVED'));
  const row = rows.find(item => km >= Number(item['最小km']) && km <= Number(item['最大km']));
  if (!row) throw new Error(`${km}kmに対応する料金がありません。`);
  return Number(row[passenger === 'child' ? '小児' : '大人']);
}

function createJunPeriods(start, end) {
  const periods = [];
  let month = 0;
  while (true) {
    const monthStart = addMonths(start, month);
    if (compareDate(monthStart, end) > 0) break;
    let monthEnd = addDays(addMonths(start, month + 1), -1);
    if (compareDate(monthEnd, end) > 0) monthEnd = new Date(end);
    const firstEnd = compareDate(addDays(monthStart, 9), monthEnd) <= 0 ? addDays(monthStart, 9) : new Date(monthEnd);
    periods.push({ start: monthStart, end: firstEnd });
    const secondStart = addDays(firstEnd, 1);
    if (compareDate(secondStart, monthEnd) <= 0) {
      const secondEnd = compareDate(addDays(secondStart, 9), monthEnd) <= 0 ? addDays(secondStart, 9) : new Date(monthEnd);
      periods.push({ start: secondStart, end: secondEnd });
      const thirdStart = addDays(secondEnd, 1);
      if (compareDate(thirdStart, monthEnd) <= 0) periods.push({ start: thirdStart, end: new Date(monthEnd) });
    }
    month += 1;
  }
  return periods;
}

function ordinaryRefund(price) {
  if ($('ordinaryStatus').value === 'before') return { ok: true, price, fee: 220, refund: Math.max(0, price - 220), formula: `${yen(price)} − 220円 ＝ ${yen(price - 220)}`, reason: '使用開始前・有効期間内として計算しました。' };
  const unusedFare = Number($('unusedFare').value || 0), remainingKm = Number($('remainingKm').value || 0);
  if (remainingKm < 101) return { ok: false, price, fee: 0, refund: 0, formula: '未使用区間が101km未満のため自動払戻対象外です。', reason: '旅行開始後の普通乗車券は、未使用区間の営業キロが101km以上の場合を対象とします。' };
  if (unusedFare <= 0) throw new Error('未使用区間の運賃を入力してください。');
  return { ok: true, price: unusedFare, fee: 220, refund: Math.max(0, unusedFare - 220), formula: `${yen(unusedFare)} − 220円 ＝ ${yen(unusedFare - 220)}`, reason: '旅行開始後の未使用区間額から払戻手数料を差し引きました。' };
}

function expressRefund(type, price, request, departure) {
  if (['unreserved'].includes(type)) return { ok: true, price, fee: 220, refund: Math.max(0, price - 220), formula: `${yen(price)} − 220円 ＝ ${yen(price - 220)}`, reason: '使用開始前・有効期間内の自由席特急券として計算しました。' };
  if (type === 'unassigned') return { ok: true, price, fee: 340, refund: Math.max(0, price - 340), formula: `${yen(price)} − 340円 ＝ ${yen(price - 340)}`, reason: '旅行日まで・使用開始前の座席未指定券として計算しました。' };
  if (!departure) throw new Error('列車出発日時を入力してください。');
  if (request > departure) return { ok: false, price, fee: 0, refund: 0, formula: '列車出発時刻経過後のため自動計算対象外です。', reason: '列車出発時刻を過ぎています。' };
  const departureDay = new Date(departure.getFullYear(), departure.getMonth(), departure.getDate());
  const requestDay = new Date(request.getFullYear(), request.getMonth(), request.getDate());
  const days = Math.round((departureDay - requestDay) / 86400000);
  const fee = days >= 2 ? 340 : Math.max(340, floor10(price * 0.3));
  return { ok: true, price, fee, refund: Math.max(0, price - fee), formula: `${yen(price)} − ${yen(fee)} ＝ ${yen(price - fee)}`, reason: days >= 2 ? '列車出発日の2日前までの申出として計算しました。' : '出発日前日から出発時刻までの申出として、料金の30％（最低340円）を適用しました。' };
}

function couponRefund(oneWayFare) {
  const price = Number($('couponPrice').value || oneWayFare * 10), used = Number($('couponUsed').value || 0);
  if (used < 0 || !Number.isInteger(used)) throw new Error('使用済枚数は0以上の整数で入力してください。');
  const usedAmount = oneWayFare * used, fee = 220, refund = Math.max(0, price - usedAmount - fee);
  return { ok: refund > 0, price, fee, refund, formula: `${yen(price)} −（${yen(oneWayFare)} × ${used}枚）− 220円 ＝ ${yen(refund)}`, reason: refund > 0 ? '発売額から使用券片数分の片道普通運賃と払戻手数料を差し引きました。' : '差引後の残額がないため払戻額は0円です。', extra: [{ label: '使用分', value: usedAmount }] };
}

function commuterRefund(calculatedOneWayFare, routeInfo) {
  const start = parseDate($('commuterStart').value), request = parseDate($('commuterRequest').value);
  const price = Number($('commuterPrice').value || 0), months = Number($('commuterMonths').value || 1);
  const category = $('commuterCategory').value;
  const oneWayFare = Number($('commuterOneWayFare').value || calculatedOneWayFare || 0);
  if (!start || !request) throw new Error('有効期間開始日と申出日を入力してください。');
  if (!Number.isInteger(months) || months < 1 || months > 6) throw new Error('期間は1箇月から6箇月で選択してください。');
  if (price <= 0) throw new Error('券面金額を確認してください。');
  if (oneWayFare <= 0) throw new Error('片道普通運賃を確認してください。');

  const end = addDays(addMonths(start, months), -1);
  $('commuterEnd').value = formatDateInput(end);
  if (compareDate(request, end) > 0) return { ok: false, price, fee: 0, refund: 0, formula: '有効期間終了後のため自動計算対象外です。', reason: `申出日が有効期間終了日（${end.toLocaleDateString('ja-JP')}）を過ぎています。` };

  const fee = 220;
  if (compareDate(request, start) < 0) {
    const refund = Math.max(0, price - fee);
    return {
      ok: refund > 0,
      price,
      fee,
      refund,
      formula: `有効期間開始前：${yen(price)} − 220円 ＝ ${yen(refund)}`,
      reason: `申出日が有効期間開始日前のため、使用経過相当額および旬割使用額を差し引かず、券面金額から払戻手数料のみを差し引きました。有効期間終了日は${end.toLocaleDateString('ja-JP')}です。`,
      extra: [
        { label: '片道普通運賃', value: oneWayFare },
        { label: '使用日数', value: '0日' },
        { label: '採用計算', value: '有効期間開始前' }
      ]
    };
  }

  const roundTripFare = oneWayFare * 2;
  const usedDays = Math.floor((request - start) / 86400000) + 1;
  const elapsedEquivalentAmount = roundTripFare * usedDays;
  const usageRefund = Math.max(0, price - elapsedEquivalentAmount - fee);

  const periods = createJunPeriods(start, end);
  const index = periods.findIndex(period => compareDate(request, period.start) >= 0 && compareDate(request, period.end) <= 0);
  const usedJun = index >= 0 ? index + 1 : periods.length;
  const oneMonthFare = oneMonthCommuterFare(routeInfo, category);
  // 旬額は「1箇月定期運賃 ÷ 30日 × 10日」の結果を10円未満切捨て。
  // 例：7,690円 ÷ 30 × 10 ＝ 2,563.33…円 → 2,560円
  const oneJunAmount = floor10((oneMonthFare / 30) * 10);
  const junUsedAmount = oneJunAmount * usedJun;
  const junRefund = Math.max(0, price - junUsedAmount - fee);
  const useJun = junRefund > usageRefund;
  const refund = Math.max(usageRefund, junRefund);
  return {
    ok: refund > 0,
    price,
    fee,
    refund,
    formula: `使用経過計算：${yen(price)} −（片道普通運賃 ${yen(oneWayFare)} × 2 × ${usedDays}日）− 220円 ＝ ${yen(usageRefund)}
旬割計算：${yen(price)} −（1箇月定期運賃 ${yen(oneMonthFare)} ÷ 30日 × 10日・10円未満切捨て × ${usedJun}旬）− 220円 ＝ ${yen(junRefund)}
採用：${useJun ? '旬割計算' : '使用経過計算'} ${yen(refund)}`,
    reason: `券面金額は定期運賃マスタから自動算出し、入力欄で修正可能です。${months}箇月定期の旬割計算には、同一区間・同一定期種別の1箇月定期運賃${yen(oneMonthFare)}をマスタから取得しました。使用経過計算と旬割計算を比較し、払戻額が多い${useJun ? '旬割計算' : '使用経過計算'}を採用しました。有効期間終了日は${end.toLocaleDateString('ja-JP')}です。`,
    extra: [
      { label: '片道普通運賃', value: oneWayFare },
      { label: '往復普通運賃', value: roundTripFare },
      { label: '使用日数', value: `${usedDays}日` },
      { label: '使用経過相当額', value: elapsedEquivalentAmount },
      { label: '使用経過計算', value: usageRefund },
      { label: '1箇月定期運賃', value: oneMonthFare },
      { label: '旬割計算', value: junRefund },
      { label: '使用旬数', value: `${usedJun}旬` }
    ]
  };
}

function updateCommuterEnd() {
  const start = parseDate($('commuterStart').value);
  const months = Number($('commuterMonths').value || 1);
  $('commuterEnd').value = start && Number.isInteger(months) && months >= 1 && months <= 6
    ? formatDateInput(addDays(addMonths(start, months), -1))
    : '';
}

function updateCommuterAutoAmounts() {
  if ($('type').value !== 'commuter') return;
  const from = $('from').value.trim(), to = $('to').value.trim();
  if (!stations.includes(from) || !stations.includes(to)) return;
  try {
    const vias = $('via').value.split(/[,、]/).map(value => value.trim()).filter(Boolean);
    if (vias.some(value => !stations.includes(value))) return;
    const info = totals(route(from, to, vias));
    const months = Number($('commuterMonths').value || 1);
    $('commuterOneWayFare').value = fare(info.table, info.km, $('passenger').value);
    $('commuterPrice').value = commuterMasterFare(info, $('commuterCategory').value, months);
  } catch (_) {
    // 入力途中またはマスタ未登録時は自動入力を行わない。
  }
}

function conditional() {
  const type = $('type').value;
  const isExpress = ['unreserved', 'reserved', 'green', 'unassigned'].includes(type);
  $('ordinaryBox').classList.toggle('hidden', type !== 'ordinary');
  $('dateBox').classList.toggle('hidden', !isExpress);
  $('departureBox').classList.toggle('hidden', !['reserved', 'green'].includes(type));
  $('commuterBox').classList.toggle('hidden', type !== 'commuter');
  $('couponBox').classList.toggle('hidden', type !== 'coupon');
  $('ordinaryAfterBox').classList.toggle('hidden', $('ordinaryStatus').value !== 'after');
}

function renderResult(result, routeInfo, routeSegments) {
  $('result').classList.remove('hidden');
  $('status').textContent = result.ok ? '払戻可能' : '払戻不可・要確認';
  $('status').className = `badge ${result.ok ? '' : 'no'}`;
  const metrics = [
    { label: '券面額・料金', value: yen(result.price) },
    ...(result.extra || []).map(item => ({ label: item.label, value: typeof item.value === 'number' ? yen(item.value) : item.value })),
    { label: '払戻手数料', value: yen(result.fee) },
    { label: '払戻額', value: yen(result.refund) }
  ];
  $('metrics').innerHTML = metrics.map(item => `<div class="metric">${item.label}<b>${item.value}</b></div>`).join('');
  $('formula').textContent = result.formula;
  const distanceText = routeInfo ? `\n営業キロ：${routeInfo.business.toFixed(1)}km／換算キロ：${routeInfo.conversion.toFixed(1)}km\n運賃参照：${routeInfo.label}、検索距離${routeInfo.km}km` : '';
  $('reason').textContent = `${result.reason}${distanceText}`;
  $('routeDetails').classList.toggle('hidden', !routeSegments);
  if (routeSegments) $('route').innerHTML = `<table><thead><tr><th>区間</th><th>線名</th><th>営業キロ</th><th>換算キロ</th></tr></thead><tbody>${routeSegments.map(segment => `<tr><td>${segment.from} → ${segment.to}</td><td>${segment.line}</td><td>${segment.business_km}km</td><td>${segment.conversion_km ?? '—'}km</td></tr>`).join('')}</tbody></table>`;
}

$('type').addEventListener('change', conditional);
$('ordinaryStatus').addEventListener('change', conditional);
$('commuterStart').addEventListener('change', updateCommuterEnd);
$('commuterMonths').addEventListener('change', updateCommuterEnd);
['from', 'to', 'via'].forEach(id => $(id).addEventListener('change', updateCommuterAutoAmounts));
$('passenger').addEventListener('change', updateCommuterAutoAmounts);
$('commuterCategory').addEventListener('change', updateCommuterAutoAmounts);
$('commuterMonths').addEventListener('change', updateCommuterAutoAmounts);
$('type').addEventListener('change', () => { updateCommuterEnd(); updateCommuterAutoAmounts(); });
$('form').addEventListener('submit', event => {
  event.preventDefault();
  try {
    const from = $('from').value.trim(), to = $('to').value.trim(), type = $('type').value;
    if (!type) throw new Error('券種を選択してください。');
    if (!stations.includes(from) || !stations.includes(to)) throw new Error('発駅・着駅は候補から正確に入力してください。');
    const vias = $('via').value.split(/[,、]/).map(value => value.trim()).filter(Boolean);
    if (vias.some(value => !stations.includes(value))) throw new Error('経由駅に未登録の駅名があります。');
    const routeSegments = route(from, to, vias), routeInfo = totals(routeSegments), passenger = $('passenger').value;
    const oneWayFare = fare(routeInfo.table, routeInfo.km, passenger);
    if (type === 'commuter') {
      if (!$('commuterOneWayFare').value) $('commuterOneWayFare').value = oneWayFare;
      if (!$('commuterPrice').value) $('commuterPrice').value = commuterMasterFare(routeInfo, $('commuterCategory').value, Number($('commuterMonths').value || 1));
    }
    let result;
    if (type === 'ordinary') result = ordinaryRefund(oneWayFare);
    else if (type === 'coupon') result = couponRefund(oneWayFare);
    else if (type === 'commuter') result = commuterRefund(oneWayFare, routeInfo);
    else {
      let price = 0;
      if (type === 'unreserved') price = charge('limited_express_unreserved', Math.ceil(routeInfo.business), passenger);
      else if (['reserved', 'unassigned'].includes(type)) price = charge('limited_express_reserved', Math.ceil(routeInfo.business), passenger);
      else if (type === 'green') price = charge('limited_express_reserved', Math.ceil(routeInfo.business), passenger) + charge('green_charge', Math.ceil(routeInfo.business), passenger);
      const request = $('request').value ? new Date($('request').value) : new Date();
      const departure = $('departure').value ? new Date($('departure').value) : null;
      result = expressRefund(type, price, request, departure);
    }
    renderResult(result, routeInfo, routeSegments);
  } catch (error) { alert(error.message); }
});

$('clear').addEventListener('click', () => { $('form').reset(); conditional(); $('result').classList.add('hidden'); setInitialDates(); updateCommuterEnd(); });
$('theme').addEventListener('click', () => { const dark = document.documentElement.dataset.theme === 'dark'; document.documentElement.dataset.theme = dark ? 'light' : 'dark'; localStorage.setItem('mk-theme', dark ? 'light' : 'dark'); });

document.documentElement.dataset.theme = localStorage.getItem('mk-theme') || 'light';
function setInitialDates() {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  $('request').value = now.toISOString().slice(0, 16);
  $('travel').value = now.toISOString().slice(0, 10);
  $('commuterRequest').value = now.toISOString().slice(0, 10);
}
setInitialDates();
conditional();
updateCommuterEnd();
