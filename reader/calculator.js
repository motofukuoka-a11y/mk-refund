export function createCalculator(segments, stations, mainFares, localFares, discountData) {
const graph = new Map();
for (const segment of segments) {
  if (segment.status !== 'active') continue;
  for (const [from, to] of [[segment.from,segment.to],[segment.to,segment.from]]) {
    if (!graph.has(from)) graph.set(from,[]);
    graph.get(from).push({...segment,from,to});
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


function calculate(input) {
  const {from,to,stop,price,discount='none',passenger='adult',vias=[],companion=false,valid=false}=input;
  if (!valid) throw new Error('券面の有効期間内であることを確認してください。');
  if (![from,to,stop,...vias].every(s=>stations.includes(s))) throw new Error('発駅・着駅・旅行中止駅・経由駅を登録駅から入力してください。');
  if (from===to) throw new Error('発駅と着駅は別の駅を入力してください。');
  if (!Number.isInteger(price)||price<=0) throw new Error('元券の実際の発売額を円単位で確認してください。');
  if (!['adult','child'].includes(passenger)) throw new Error('旅客区分を確認してください。');
  const rule=discountData.discounts.find(r=>r.id===discount);
  if (!rule) throw new Error('割引種別を確認してください。');
  if (passenger==='child' && discount!=='none') throw new Error('小児の割引併用条件は自動判定できません。個別取扱いを確認してください。');
  if (rule.requiresCompanion&&!companion) throw new Error('本人・介護者の同一種類・同一区間での同行を確認してください。');
  const path=route(from,to,vias), originalInfo=totals(path);
  const qualifies=info=>rule.minimumBusinessKmExclusive===null||Math.round(info.business*10)>Number(rule.minimumBusinessKmExclusive)*10;
  if (!qualifies(originalInfo)) throw new Error('元券区間が選択した割引の距離条件を満たしません。');
  const points=[from,...path.map(s=>s.to)];
  const positions=points.flatMap((s,i)=>s===stop?[i]:[]);
  if (!positions.length) throw new Error('旅行中止駅が元券の経路上にありません。経由駅を確認してください。');
  if (positions.length>1) throw new Error('同じ旅行中止駅を複数回通るため中止位置を特定できません。');
  const used=path.slice(0,positions[0]), unused=path.slice(positions[0]);
  const usedInfo=totals(used), unusedInfo=totals(unused);
  const usedFare=used.length?fare(usedInfo.table,usedInfo.km,passenger):0;
  const usedDiscount=used.length>0 && qualifies(usedInfo) && Number(rule.rate)>0;
  const deduction=usedDiscount?Math.ceil(usedFare*(1-Number(rule.rate))/10)*10:usedFare;
  const eligible=Math.round(unusedInfo.business*10)>=1010;
  const refund=eligible?Math.max(0,price-deduction-220):0;
  return {from,to,stop,price,rule,usedInfo,unusedInfo,usedFare,usedDiscount,deduction,refund,eligible,
    fee:eligible?220:0, path,
    reason:!eligible?'未使用区間の営業キロが101km未満のため自動計算対象外です。':`元券発売額から既乗区間の運賃と220円を控除しました。${usedDiscount?'既乗区間が割引条件を満たすため割引運賃を控除しています。':Number(rule.rate)>0?'既乗区間だけでは割引条件を満たさないため無割引運賃を控除しています。':''}`};
}
return {route,totals,fare,calculate};
}
