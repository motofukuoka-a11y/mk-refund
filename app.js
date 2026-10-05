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
const formatJapaneseDate = date => `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`;

const DISCOUNT_RULES = new Map();

function discountRule(type) {
  const rule = DISCOUNT_RULES.get(type);
  if (!rule) throw new Error('割引種別の設定を確認できません。');
  return rule;
}

function validateDiscount(type, businessKm) {
  const rule = discountRule(type);
  if (rule.minimumBusinessKmExclusive !== null && businessKm <= Number(rule.minimumBusinessKmExclusive)) {
    return {
      ok: false,
      message: `${rule.label}は、片道の営業キロが100kmを超える区間に限り適用できます。現在の営業キロは${businessKm.toFixed(1)}kmです。`
    };
  }
  return { ok: true, message: '' };
}

function applyOrdinaryDiscount(normalFare, type, businessKm) {
  const rule = discountRule(type);
  const validation = validateDiscount(type, businessKm);
  if (!validation.ok) throw new Error(validation.message);
  const discountedFare = rule.rate > 0 ? ceil10(normalFare * (1 - Number(rule.rate))) : normalFare;
  return {
    type,
    label: rule.label,
    rate: Number(rule.rate),
    normalFare,
    discountedFare,
    conditionNote: rule.requiresCompanion ? '本人と介護者が同一種類・同一区間を同時に利用する場合として計算します。' : ''
  };
}

function updateDiscountNotice() {
  const type = $('ordinaryDiscount').value;
  const rule = DISCOUNT_RULES.get(type);
  if (!rule) return;
  const notes = [];
  if (rule.rate > 0) notes.push(`${Math.round(rule.rate * 100)}％引`);
  if (rule.minimumBusinessKmExclusive !== null) notes.push('片道の営業キロが100kmを超える場合に適用');
  if (rule.requiresCompanion) notes.push('本人・介護者が同一種類・同一区間を同行する場合');
  $('discountNotice').textContent = notes.length ? `${rule.label}：${notes.join('／')}` : '普通運賃をそのまま払戻計算に使用します。';
}

const [segments, stations, mainFares, localFares, charges, commuterFares, accidentRules, discountRuleData] = await Promise.all(
  ['segments', 'stations', 'ordinary_fares_main', 'ordinary_fares_local', 'charges', 'teiki_fare_master', 'accident_refund_rules', 'discount_rules']
    .map(name => fetch(`./data/${name}.json`).then(response => response.json()))
);
discountRuleData.discounts.forEach(rule => DISCOUNT_RULES.set(rule.id, rule));
discountRuleData.discounts.forEach(rule => {
  const option = document.createElement('option'); option.value = rule.id; option.textContent = rule.label;
  $('ordinaryDiscount').append(option);
});
const accidentRuleMap = new Map(accidentRules.map(rule => [rule.id, rule]));

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
  const mainBusiness = routeSegments.filter(s=>s.line_type==='幹線').reduce((a,s)=>a+Number(s.business_km||0),0);
  const localBusiness = routeSegments.filter(s=>s.line_type==='地方交通線').reduce((a,s)=>a+Number(s.business_km||0),0);
  const localConversion = routeSegments.filter(s=>s.line_type==='地方交通線').reduce((a,s)=>a+Number(s.conversion_km||0),0);
  const business = mainBusiness+localBusiness;
  const hasMain=mainBusiness>0, hasLocal=localBusiness>0;
  if(hasMain&&hasLocal&&business>10){
    const fareCalculationKm=mainBusiness+localConversion;
    return {business,conversion:localConversion,mainBusiness,localBusiness,fareCalculationKm,km:Math.ceil(fareCalculationKm),table:mainFares,label:'幹線普通運賃表（幹線営業キロ＋地方交通線換算キロ）',commuterLineType:'幹線'};
  }
  if(hasLocal&&!hasMain){
    return {business,conversion:localConversion,mainBusiness,localBusiness,fareCalculationKm:localBusiness,km:Math.ceil(localBusiness),table:localFares,label:'地方交通線普通運賃表（営業キロ）',commuterLineType:'地方交通線'};
  }
  return {business,conversion:business,mainBusiness,localBusiness,fareCalculationKm:business,km:Math.ceil(business),table:mainFares,label:'幹線普通運賃表（営業キロ）',commuterLineType:'幹線'};
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

function renderJunDetails(forceOpen = false) {
  const panel = $('junDetailsPanel');
  const button = $('junDetailsButton');
  const list = $('junDetailsList');
  const summary = $('junDetailsSummary');

  const start = parseDate($('commuterStart').value);
  const request = parseDate($('commuterRequest').value);
  const months = Number($('commuterMonths').value || 1);

  if (!start || !Number.isInteger(months) || months < 1 || months > 6) {
    list.innerHTML = '<p class="muted">有効期間開始日と定期期間を選択してください。</p>';
    summary.textContent = '';
    if (forceOpen) panel.classList.remove('hidden');
    button.setAttribute('aria-expanded', String(!panel.classList.contains('hidden')));
    return;
  }

  const end = addDays(addMonths(start, months), -1);
  const periods = createJunPeriods(start, end);
  const currentIndex = request
    ? periods.findIndex(period => compareDate(request, period.start) >= 0 && compareDate(request, period.end) <= 0)
    : -1;

  summary.textContent = request
    ? currentIndex >= 0
      ? `申出日 ${formatJapaneseDate(request)} は第${currentIndex + 1}旬です。`
      : `申出日 ${formatJapaneseDate(request)} は有効期間外です。`
    : '申出日を選択すると、計算対象の旬を強調表示します。';

  list.innerHTML = periods.map((period, index) => {
    const isCurrent = index === currentIndex;
    const stateClass = isCurrent
      ? 'is-current'
      : request && compareDate(period.end, request) < 0
        ? 'is-past'
        : 'is-future';

    return `<article class="jun-item ${stateClass}">
      <strong>第${index + 1}旬</strong>
      <span class="jun-range">${formatJapaneseDate(period.start)} ～ ${formatJapaneseDate(period.end)}</span>
      ${isCurrent ? `<span class="jun-request-date">該当日：${formatJapaneseDate(request)}</span>` : ''}
    </article>`;
  }).join('');

  if (forceOpen) panel.classList.remove('hidden');
  button.setAttribute('aria-expanded', String(!panel.classList.contains('hidden')));
}

function toggleJunDetails() {
  const panel = $('junDetailsPanel');
  const willOpen = panel.classList.contains('hidden');
  panel.classList.toggle('hidden');
  $('junDetailsButton').setAttribute('aria-expanded', String(willOpen));
  if (willOpen) renderJunDetails(true);
}

function ordinaryRefund(normalFare, routeInfo, routeSegments, destination) {
  const discountType = $('ordinaryDiscount').value;
  const original = applyOrdinaryDiscount(normalFare, discountType, routeInfo.business);
  const rule = discountRule(discountType);
  if (rule.requiresCompanion && !$('discountCompanion').checked) {
    throw new Error('本人・介護者が同一種類・同一区間を同時に利用することを確認してください。');
  }
  const baseExtra = [
    { label: '元券区間', value: `${routeSegments[0]?.from} → ${destination}` },
    { label: '割引種別', value: original.label }
  ];
  if ($('ordinaryStatus').value === 'before') {
    const refund = Math.max(0, original.discountedFare - 220);
    return { ok: true, price: original.discountedFare, fee: 220, refund,
      formula: `${yen(normalFare)} × ${Math.round((1-original.rate)*100)}％ → ${yen(original.discountedFare)}（割引時は10円単位切上げ） − 220円 ＝ ${yen(refund)}`,
      reason: `使用開始前・有効期間内として計算しました。${original.conditionNote}`,
      extra: [...baseExtra, { label: '割引前普通運賃', value: normalFare }, { label: '割引後発売額', value: original.discountedFare }] };
  }
  const stop = $('ordinaryStop').value.trim();
  if (!stations.includes(stop)) throw new Error('旅行中止駅は登録駅から入力してください。');
  const routeStations = [routeSegments[0]?.from, ...routeSegments.map(segment => segment.to)];
  const indices = routeStations.flatMap((station, index) => station === stop ? [index] : []);
  if (!indices.length) throw new Error('旅行中止駅は元券の経路上の駅を入力してください。経由駅も確認してください。');
  if (indices.length > 1) throw new Error('旅行中止駅を複数回通る経路のため中止位置を特定できません。個別取扱いを確認してください。');
  const unused = routeSegments.slice(indices[0]);
  const info = totals(unused);
  const unusedNormalFare = unused.length ? fare(info.table, info.km, $('passenger').value) : 0;
  const eligible = Math.round(info.business * 10) >= 1010;
  const validation = validateDiscount(discountType, info.business);
  const discount = validation.ok && unused.length ? applyOrdinaryDiscount(unusedNormalFare, discountType, info.business) : null;
  const amount = discount?.discountedFare ?? 0;
  const ok = eligible && validation.ok;
  const refund = ok ? Math.max(0, amount - 220) : 0;
  return { ok, price: original.discountedFare, fee: ok ? 220 : 0, refund,
    formula: ok
      ? `${yen(unusedNormalFare)} × ${Math.round((1-original.rate)*100)}％ → ${yen(amount)}（割引時は10円単位切上げ） − 220円 ＝ ${yen(refund)}`
      : '自動計算対象外。払戻手数料の控除は行いません。',
    reason: !eligible ? '未使用区間の営業キロが101km未満のため、通常の旅行中止払戻は自動計算対象外です。'
      : !validation.ok ? validation.message
      : `元券の経路から未使用区間を抽出し、元券と同じ割引を適用しました。${original.conditionNote}`,
    extra: [...baseExtra,
      { label: '旅行中止駅', value: stop },
      { label: '未使用区間', value: `${stop} → ${destination}` },
      { label: '未使用区間営業キロ', value: `${info.business.toFixed(1)}km` },
      { label: '地方交通線換算キロ', value: `${info.localBusiness ? info.conversion.toFixed(1) : '0.0'}km` },
      { label: '運賃計算キロ', value: `${info.fareCalculationKm.toFixed(1)}km（運賃表検索：${info.km}km）` },
      { label: '参照運賃表', value: unused.length ? info.label : '未使用区間なし' },
      { label: '割引前未使用区間運賃', value: unusedNormalFare },
      { label: '割引後払戻対象額', value: validation.ok ? amount : '割引条件を満たさないため算出不可' },
      { label: '通常払戻手数料', value: '220円（自動計算対象外の場合は控除なし）' }
    ] };
}

function accidentRule(id) {
  const rule = accidentRuleMap.get(id);
  if (!rule) throw new Error(`事故払戻ルール（${id}）が見つかりません。`);
  return rule;
}

function manualAccidentResult(reason, formula, price = 0) {
  return {
    ok: false,
    manual: true,
    price,
    fee: 0,
    refund: 0,
    formula: formula || `自動計算対象外：${reason}\n駅係員の取扱いが必要です。`,
    reason
  };
}

function accidentPurchaseCheck() {
  if ($('accidentPurchased').value !== 'yes') {
    return manualAccidentResult('事故発生前に購入した乗車券類であることを確認できないため、自動計算を停止しました。');
  }
  return null;
}

function remainingRoute(routeSegments, stop, destination) {
  if (stop === destination) return [];
  const startIndex = routeSegments.findIndex(segment => segment.from === stop);
  if (startIndex < 0) throw new Error('旅行中止駅は発着区間の経路上の駅を入力してください。');
  const remaining = routeSegments.slice(startIndex);
  if (!remaining.length || remaining[remaining.length - 1].to !== destination) {
    throw new Error('旅行中止駅から着駅までの経路を特定できません。経由駅を確認してください。');
  }
  return remaining;
}

function accidentFareRefund(oneWayFare, routeSegments, destination) {
  const purchaseCheck = accidentPurchaseCheck();
  if (purchaseCheck) return purchaseCheck;

  const status = $('accidentStatus').value;
  if (status === 'before') {
    const rule = accidentRule('ACCIDENT_CANCEL_BEFORE');
    return {
      ok: true,
      price: oneWayFare,
      fee: 0,
      refund: oneWayFare,
      formula: `${yen(oneWayFare)} − 払戻手数料0円 ＝ ${yen(oneWayFare)}`,
      reason: '運休により旅行開始前の旅行を中止するものとして、普通乗車券の運賃全額を無手数料で計算しました。',
      source: `${rule.source}（${rule.reference}）`,
      extra: [{ label: '対象', value: '乗車券・運賃全額' }]
    };
  }

  const stop = $('accidentStop').value.trim();
  if (!stop || !stations.includes(stop)) throw new Error('旅行中止駅は登録駅から入力してください。');
  const remainingSegments = remainingRoute(routeSegments, stop, destination);
  if (!remainingSegments.length) {
    const rule = accidentRule('ACCIDENT_CANCEL_AFTER_FARE');
    return manualAccidentResult('旅行中止駅が着駅のため、未使用区間の運賃はありません。', '旅行中止駅・着駅間の普通運賃 0円。払戻額は0円です。', oneWayFare);
  }
  const remainingInfo = totals(remainingSegments);
  const remainingFare = fare(remainingInfo.table, remainingInfo.km, $('passenger').value);
  const rule = accidentRule('ACCIDENT_CANCEL_AFTER_FARE');
  return {
    ok: remainingFare > 0,
    price: oneWayFare,
    fee: 0,
    refund: remainingFare,
    formula: `旅行中止駅・着駅間の普通運賃 ${yen(remainingFare)} − 払戻手数料0円 ＝ ${yen(remainingFare)}`,
    reason: `旅行開始後の運休として、旅行中止駅（${stop}）から着駅までの未使用区間の普通運賃を計算しました。元の券面額から既乗区間の運賃を差し引く方式ではなく、規則上の未使用区間運賃を採用しています。`,
    source: `${rule.source}（${rule.reference}）`,
    extra: [
      { label: '対象', value: '乗車券・未使用区間' },
      { label: '旅行中止駅・着駅間', value: remainingFare },
      { label: '未使用区間営業キロ', value: `${remainingInfo.business.toFixed(1)}km` }
    ]
  };
}

function commuterAccidentRefund(routeInfo, routeSegments) {
  const purchaseCheck = accidentPurchaseCheck();
  if (purchaseCheck) return purchaseCheck;

  const rule = accidentRule('ACCIDENT_SUSPEND_COMMUTER');
  const months = Number($('commuterMonths').value || 1);
  const days = Number($('commuterAccidentDays').value || 0);
  const price = Number($('commuterPrice').value || 0);
  const category = $('commuterCategory').value;
  const periodDays = { 1: 30, 3: 90, 6: 180 }[months];

  if (![1, 3, 6].includes(months)) {
    return manualAccidentResult('定期券の事故払戻は、現行の自動計算では1・3・6箇月定期のみを対象とします。2・4・5箇月定期は個別確認が必要です。', undefined, price);
  }
  if (!Number.isInteger(days) || days < 5) {
    return manualAccidentResult('定期券の運休事故払戻は、使用不能日数が5日以上の場合を対象とします。', undefined, price);
  }
  if (days > periodDays) {
    return manualAccidentResult(`使用不能日数が定期期間の日数（${periodDays}日）を超えています。入力と個別取扱いを確認してください。`, undefined, price);
  }
  if (price <= 0) throw new Error('定期券の券面金額を確認してください。');

  let standardFare;
  try {
    standardFare = commuterMasterFare(routeInfo, category, months);
  } catch (error) {
    return manualAccidentResult(`標準定期運賃を特定できないため自動計算できません。${error.message}`, undefined, price);
  }
  if (price !== standardFare) {
    return manualAccidentResult(`入力された券面金額（${yen(price)}）と標準定期運賃（${yen(standardFare)}）が一致しないため、特殊な定期券・割引商品の可能性があります。券面を確認してください。`, undefined, price);
  }

  let basisFare = standardFare;
  let scopeLabel = '定期券区間全体';
  if ($('commuterAccidentScope').value === 'partial') {
    const unusedFrom = $('commuterAccidentUnusedFrom').value.trim();
    const unusedTo = $('commuterAccidentUnusedTo').value.trim();
    if (!unusedFrom || !unusedTo || !stations.includes(unusedFrom) || !stations.includes(unusedTo)) {
      return manualAccidentResult('使用不能区間の発駅・着駅を登録駅から入力してください。', undefined, price);
    }
    const originalStations = [routeSegments[0]?.from, ...routeSegments.map(segment => segment.to)];
    const fromIndex = originalStations.indexOf(unusedFrom);
    const toIndex = originalStations.indexOf(unusedTo);
    if (fromIndex < 0 || toIndex < 0 || fromIndex >= toIndex) {
      return manualAccidentResult('使用不能区間は、元の定期券経路上で発駅から着駅へ向かう順序で入力してください。', undefined, price);
    }
    const unusedVia = $('commuterAccidentUnusedVia').value.split(/[,、]/).map(value => value.trim()).filter(Boolean);
    if (unusedVia.length) {
      return manualAccidentResult('使用不能区間の経由駅を入力した場合は、複数区間の個別取扱いとなるため自動計算しません。', undefined, price);
    }
    const unusedSegments = routeSegments.slice(fromIndex, toIndex);
    const unusedInfo = totals(unusedSegments);
    basisFare = commuterMasterFare(unusedInfo, category, months);
    scopeLabel = `${unusedFrom}〜${unusedTo}（1区間）`;
  }

  const dailyAmount = Math.ceil(basisFare / periodDays);
  const rawRefund = Math.min(price, dailyAmount * days);
  const refund = floor10(rawRefund);
  const roundingText = rawRefund === refund
    ? `端数整理後 ${yen(refund)}`
    : `${yen(rawRefund)} → 10円未満切捨て → ${yen(refund)}`;
  return {
    ok: refund > 0,
    price,
    fee: 0,
    refund,
    formula: `${scopeLabel}の${months}箇月定期運賃 ${yen(basisFare)} ÷ ${periodDays}日 ＝ ${yen(dailyAmount)}／日 × 使用不能${days}日 ＝ ${roundingText}`,
    reason: `運休により${scopeLabel}が${days}日間使用できなかったものとして、定期券の同一種類・同一期間の運賃を日割り計算しました。第288条に基づく事故払戻のため、手数料は0円です。`,
    source: `${rule.source}（${rule.reference}）`,
    extra: [
      { label: '対象', value: '定期券・使用不能区間' },
      { label: '計算基礎定期運賃', value: basisFare },
      { label: '使用不能日数', value: `${days}日` },
      { label: '1日あたり', value: dailyAmount },
      ...(rawRefund !== refund ? [{ label: '端数整理前', value: rawRefund }] : [])
    ]
  };
}

function accidentChargeRefund(type, price) {
  const purchaseCheck = accidentPurchaseCheck();
  if (purchaseCheck) return purchaseCheck;
  if ($('accidentChargeCondition').value !== 'unavailable') {
    return manualAccidentResult('指定列車または対象区間を利用できなかったことを確認できないため、料金券の自動計算を停止しました。', undefined, price);
  }

  const rule = $('accidentStatus').value === 'before'
    ? accidentRule('ACCIDENT_CANCEL_BEFORE')
    : accidentRule('ACCIDENT_CANCEL_AFTER_CHARGE');
  const label = type === 'green' ? '特急料金・グリーン料金' : '特急料金';
  return {
    ok: price > 0,
    price,
    fee: 0,
    refund: price,
    formula: `${label} ${yen(price)} − 払戻手数料0円 ＝ ${yen(price)}`,
    reason: `運休により${label}の指定列車・対象区間を利用できなかったものとして、料金券相当額の全額を無手数料で計算しました。`,
    source: `${rule.source}（${rule.reference}）`,
    extra: [{ label: '対象', value: `${label}・全額` }]
  };
}

function accidentRefund(type, oneWayFare, routeSegments, destination, price, routeInfo) {
  if (type === 'ordinary') return accidentFareRefund(oneWayFare, routeSegments, destination);
  if (['unreserved', 'reserved', 'green', 'unassigned'].includes(type)) return accidentChargeRefund(type, price);
  if (type === 'commuter') return commuterAccidentRefund(routeInfo, routeSegments);
  return manualAccidentResult('普通回数乗車券はこの運休事故払戻の自動計算対象外です。休止日数・券片数等を含む個別取扱いを確認してください。', undefined, price);
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
  if (compareDate(request, end) > 0) return {
    ok: false,
    price,
    fee: 0,
    refund: 0,
    formula: '有効期間終了後のため自動計算対象外です。',
    reason: `申出日が有効期間終了日（${end.toLocaleDateString('ja-JP')}）を過ぎています。`
  };

  const fee = 220;
  if (compareDate(request, start) < 0) {
    const refund = Math.max(0, price - fee);
    return {
      ok: refund > 0,
      price,
      fee,
      refund,
      formula: `有効期間開始前：${yen(price)} − 220円 ＝ ${yen(refund)}`,
      reason: `申出日が有効期間開始日前のため、使用経過相当額を差し引かず、券面金額から払戻手数料のみを差し引きました。有効期間終了日は${end.toLocaleDateString('ja-JP')}です。`,
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

  // 旬割運賃は、選択した定期期間そのものの券面金額を基礎に算出する。
  // 1箇月：1箇月定期運賃 ÷ 30 × 10
  // 3箇月：3箇月定期運賃 ÷ 90 × 10
  // 6箇月：6箇月定期運賃 ÷ 180 × 10
  // 2・4・5箇月は、選択期間の券面金額 ÷（期間月数 × 30）× 10 とする。
  const periods = createJunPeriods(start, end);
  const index = periods.findIndex(period => compareDate(request, period.start) >= 0 && compareDate(request, period.end) <= 0);
  const usedJun = index >= 0 ? index + 1 : periods.length;
  const periodDays = months * 30;
  // 定期運賃を期間日数で除した直後に小数点以下を切り上げ、その整数に10を乗じる。
  // 例：22,000円 ÷ 90日 ＝ 244.44…円 → 245円 × 10日 ＝ 2,450円
  const dailyJunBasis = Math.ceil(price / periodDays);
  const oneJunAmount = dailyJunBasis * 10;
  const junUsedAmount = oneJunAmount * usedJun;
  const junRefund = Math.max(0, price - junUsedAmount - fee);

  // 1箇月超え払戻計算
  // 完了した1箇月ごとに1箇月定期運賃を差し引く。
  // 端数日については「往復普通運賃×残日数」と「1箇月定期運賃」を比較し、
  // 控除額が少ない方（＝払戻額が多い方）を採用する。
  const oneMonthFare = oneMonthCommuterFare(routeInfo, category);
  let completedMonths = 0;
  while (completedMonths < months) {
    const nextMonthStart = addMonths(start, completedMonths + 1);
    if (compareDate(request, nextMonthStart) < 0) break;
    completedMonths += 1;
  }

  const remainderStart = addMonths(start, completedMonths);
  const remainingDays = Math.max(0, Math.floor((request - remainderStart) / 86400000) + 1);
  const completedMonthAmount = oneMonthFare * completedMonths;
  const remainingDayAmount = roundTripFare * remainingDays;
  const remainingMonthAmount = remainingDays > 0 ? oneMonthFare : 0;
  const appliedRemainderAmount = remainingDays > 0
    ? Math.min(remainingDayAmount, remainingMonthAmount)
    : 0;
  const overOneMonthUsedAmount = completedMonthAmount + appliedRemainderAmount;
  const overOneMonthRefund = Math.max(0, price - overOneMonthUsedAmount - fee);
  const overOneMonthAvailable = months > 1 && completedMonths >= 1;

  const candidates = [
    { name: '使用経過計算', refund: usageRefund },
    { name: '旬割計算', refund: junRefund }
  ];
  if (overOneMonthAvailable) {
    candidates.push({ name: '1箇月超え払戻計算', refund: overOneMonthRefund });
  }

  const adopted = candidates.reduce((best, current) => current.refund > best.refund ? current : best);
  const refund = adopted.refund;

  const overOneMonthFormula = overOneMonthAvailable
    ? `1箇月超え払戻計算：${yen(price)} −（1箇月定期運賃 ${yen(oneMonthFare)} × ${completedMonths}箇月）−（残${remainingDays}日分：${yen(remainingDayAmount)} と 1箇月定期運賃 ${yen(remainingMonthAmount)} の少ない方 ${yen(appliedRemainderAmount)}）− 220円 ＝ ${yen(overOneMonthRefund)}`
    : '';

  return {
    ok: refund > 0,
    price,
    fee,
    refund,
    formula: `使用経過計算：${yen(price)} −（片道普通運賃 ${yen(oneWayFare)} × 2 × ${usedDays}日）− 220円 ＝ ${yen(usageRefund)}
旬割計算：${yen(price)} −（${months}箇月定期運賃 ${yen(price)} ÷ ${periodDays}日 ＝ ${yen(dailyJunBasis)}（小数点以下切上げ）× 10日 ＝ ${yen(oneJunAmount)} × ${usedJun}旬）− 220円 ＝ ${yen(junRefund)}
${overOneMonthFormula ? `${overOneMonthFormula}
` : ''}採用：${adopted.name} ${yen(refund)}`,
    reason: `${months}箇月定期の旬割運賃は、選択した期間の定期運賃${yen(price)}を${periodDays}日で除した直後に小数点以下を切り上げ、その金額に10日を乗じて算出しました。${overOneMonthAvailable ? `また、使用期間が1箇月を超えているため「1箇月超え払戻計算」も行い、完了${completedMonths}箇月分の1箇月定期運賃と、残${remainingDays}日分について普通運賃計算と追加1箇月分計算の有利な方を適用しました。` : ''}各計算結果を比較し、払戻額が最も多い${adopted.name}を採用しました。有効期間終了日は${end.toLocaleDateString('ja-JP')}です。`,
    extra: [
      { label: '片道普通運賃', value: oneWayFare },
      { label: '往復普通運賃', value: roundTripFare },
      { label: '使用日数', value: `${usedDays}日` },
      { label: '使用経過相当額', value: elapsedEquivalentAmount },
      { label: '使用経過計算', value: usageRefund },
      { label: '1旬運賃', value: oneJunAmount },
      { label: '旬割計算', value: junRefund },
      { label: '使用旬数', value: `${usedJun}旬` },
      ...(overOneMonthAvailable ? [
        { label: '経過月数', value: `${completedMonths}箇月` },
        { label: '残日数', value: `${remainingDays}日` },
        { label: '1箇月定期運賃', value: oneMonthFare },
        { label: '1箇月超え払戻計算', value: overOneMonthRefund }
      ] : [])
    ]
  };
}

function updateCommuterEnd() {
  const start = parseDate($('commuterStart').value);
  const months = Number($('commuterMonths').value || 1);
  $('commuterEnd').value = start && Number.isInteger(months) && months >= 1 && months <= 6
    ? formatDateInput(addDays(addMonths(start, months), -1))
    : '';
  if (!$('junDetailsPanel').classList.contains('hidden')) renderJunDetails();
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
  const type = $('type').value, accident = $('refundMode').value === 'accident';
  const isExpress = ['unreserved', 'reserved', 'green', 'unassigned'].includes(type);
  $('accidentBox').classList.toggle('hidden', !accident);
  $('accidentStatusBox').classList.toggle('hidden', !accident || type === 'commuter');
  $('accidentTravelNotice').classList.toggle('hidden', !accident || type === 'commuter');
  $('ordinaryBox').classList.toggle('hidden', type !== 'ordinary' || accident);
  $('dateBox').classList.toggle('hidden', !isExpress || accident);
  $('departureBox').classList.toggle('hidden', !['reserved', 'green'].includes(type) || accident);
  $('commuterBox').classList.toggle('hidden', type !== 'commuter');
  $('commuterRegularNote').classList.toggle('hidden', accident || type !== 'commuter');
  $('couponBox').classList.toggle('hidden', type !== 'coupon' || accident);
  $('accidentChargeBox').classList.toggle('hidden', !accident || !isExpress);
  $('accidentStopBox').classList.toggle('hidden', !accident || type !== 'ordinary' || $('accidentStatus').value !== 'after');
  $('accidentUnsupportedNotice').classList.toggle('hidden', !accident || type !== 'coupon');
  $('commuterAccidentBox').classList.toggle('hidden', !accident || type !== 'commuter');
  $('commuterAccidentPartialBox').classList.toggle('hidden', !accident || type !== 'commuter' || $('commuterAccidentScope').value !== 'partial');
  if (type !== 'commuter' || accident) {
    $('junDetailsPanel').classList.add('hidden');
    $('junDetailsButton').setAttribute('aria-expanded', 'false');
  }
  $('discountCompanionBox').classList.toggle('hidden', !discountRule($('ordinaryDiscount').value).requiresCompanion);
  $('ordinaryStop').required = type === 'ordinary' && !accident && $('ordinaryStatus').value === 'after';
  updateDiscountNotice();
  $('ordinaryAfterBox').classList.toggle('hidden', $('ordinaryStatus').value !== 'after');
}

function renderResult(result, routeInfo, routeSegments) {
  $('result').classList.remove('hidden');
  $('status').textContent = result.manual ? '事故払戻・要確認' : result.ok ? '払戻可能' : '払戻不可・要確認';
  $('status').className = `badge ${result.ok ? '' : 'no'}`;
  const metrics = [
    { label: '券面額・料金', value: yen(result.price) },
    ...(result.extra || []).map(item => ({ label: item.label, value: typeof item.value === 'number' ? yen(item.value) : item.value })),
    { label: '払戻手数料', value: yen(result.fee) },
    { label: '払戻額', value: yen(result.refund) }
  ];
  $('metrics').innerHTML = metrics.map(item => `<div class="metric">${item.label}<b>${item.value}</b></div>`).join('');
  $('formula').textContent = result.formula;
  const distanceText = routeInfo ? (routeInfo.mainBusiness>0&&routeInfo.localBusiness>0 ?
`\n幹線営業キロ：${routeInfo.mainBusiness.toFixed(1)}km\n地方交通線営業キロ：${routeInfo.localBusiness.toFixed(1)}km\n地方交通線換算キロ：${routeInfo.conversion.toFixed(1)}km\n運賃計算キロ：${routeInfo.mainBusiness.toFixed(1)} + ${routeInfo.conversion.toFixed(1)} = ${routeInfo.fareCalculationKm.toFixed(1)}km\n運賃参照：${routeInfo.label}\n検索距離：${routeInfo.km}km`
:
`\n営業キロ：${routeInfo.business.toFixed(1)}km\n運賃参照：${routeInfo.label}\n検索距離：${routeInfo.km}km`) : '';
  const sourceText = result.source ? `\n\n制度根拠：${result.source}` : '';
  $('reason').textContent = `${result.reason}${sourceText}${distanceText}`;
  $('routeDetails').classList.toggle('hidden', !routeSegments);
  if (routeSegments) $('route').innerHTML = `<table><thead><tr><th>区間</th><th>線名</th><th>営業キロ</th><th>換算キロ</th></tr></thead><tbody>${routeSegments.map(segment => `<tr><td>${segment.from} → ${segment.to}</td><td>${segment.line}</td><td>${segment.business_km}km</td><td>${segment.conversion_km ?? '—'}km</td></tr>`).join('')}</tbody></table>`;
}

$('type').addEventListener('change', conditional);
$('ordinaryDiscount').addEventListener('change', () => { $('discountCompanion').checked = false; conditional(); });
$('ordinaryStatus').addEventListener('change', conditional);
$('refundMode').addEventListener('change', conditional);
$('accidentStatus').addEventListener('change', conditional);
$('commuterAccidentScope').addEventListener('change', conditional);
$('commuterStart').addEventListener('change', updateCommuterEnd);
$('commuterMonths').addEventListener('change', updateCommuterEnd);
$('commuterRequest').addEventListener('change', () => {
  if (!$('junDetailsPanel').classList.contains('hidden')) renderJunDetails();
});
$('junDetailsButton').addEventListener('click', toggleJunDetails);
['from', 'to', 'via'].forEach(id => $(id).addEventListener('change', updateCommuterAutoAmounts));
$('passenger').addEventListener('change', updateCommuterAutoAmounts);
$('commuterCategory').addEventListener('change', updateCommuterAutoAmounts);
$('commuterMonths').addEventListener('change', updateCommuterAutoAmounts);
$('type').addEventListener('change', () => { updateCommuterEnd(); updateCommuterAutoAmounts(); });
$('form').addEventListener('submit', event => {
  event.preventDefault();
  try {
    const from = $('from').value.trim(), to = $('to').value.trim(), type = $('type').value, mode = $('refundMode').value;
    if (!type) throw new Error('券種を選択してください。');
    if (!stations.includes(from) || !stations.includes(to)) throw new Error('発駅・着駅は候補から正確に入力してください。');
    const vias = $('via').value.split(/[,、]/).map(value => value.trim()).filter(Boolean);
    if (vias.some(value => !stations.includes(value))) throw new Error('経由駅に未登録の駅名があります。');
    const routeSegments = route(from, to, vias), routeInfo = totals(routeSegments), passenger = $('passenger').value;
    const oneWayFare = fare(routeInfo.table, routeInfo.km, passenger);
    if (type === 'commuter' && mode !== 'accident') {
      if (!$('commuterOneWayFare').value) $('commuterOneWayFare').value = oneWayFare;
      if (!$('commuterPrice').value) $('commuterPrice').value = commuterMasterFare(routeInfo, $('commuterCategory').value, Number($('commuterMonths').value || 1));
    }
    let result;
    if (mode === 'accident') {
      let accidentPrice = 0;
      if (type === 'ordinary') accidentPrice = oneWayFare;
      else if (type === 'unreserved') accidentPrice = charge('limited_express_unreserved', Math.ceil(routeInfo.business), passenger);
      else if (['reserved', 'unassigned'].includes(type)) accidentPrice = charge('limited_express_reserved', Math.ceil(routeInfo.business), passenger);
      else if (type === 'green') accidentPrice = charge('limited_express_reserved', Math.ceil(routeInfo.business), passenger) + charge('green_charge', Math.ceil(routeInfo.business), passenger);
      else if (type === 'commuter') {
        if (!$('commuterPrice').value) $('commuterPrice').value = commuterMasterFare(routeInfo, $('commuterCategory').value, Number($('commuterMonths').value || 1));
        accidentPrice = Number($('commuterPrice').value || 0);
      }
      result = accidentRefund(type, oneWayFare, routeSegments, to, accidentPrice, routeInfo);
    } else if (type === 'ordinary') result = ordinaryRefund(oneWayFare, routeInfo, routeSegments, to);
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
  } catch (error) { $('result').classList.add('hidden'); alert(error.message); }
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
