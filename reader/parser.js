import {classifyTicket,mergeTicketKinds} from './ticket-kind.js?v=3';
export function parseTicket(raw, stations) {
  const text=raw.normalize('NFKC').replace(/[‐‑−ー]/g,'ー');
  const compact=text.replace(/[ \t]/g,'');
  const warnings=[];
  const ticketKind=classifyTicket(raw);
  const unsupported=ticketKind.id!=='unknown'&&!ticketKind.calculable;
  const candidates=[];
  for (const line of compact.split('\n')) {
    const parts=line.split(/[→⇒➜]|\s+から\s+/);
    if(parts.length!==2) {
      if(/経由/.test(line)) continue;
      const hits=[];
      for(const station of [...stations].sort((a,b)=>b.length-a.length)) {
        const index=line.indexOf(station);
        if(index>=0&&!hits.some(h=>index<h.end&&index+station.length>h.index)) hits.push({station,index,end:index+station.length});
      }
      hits.sort((a,b)=>a.index-b.index);
      if(hits.length===2) candidates.push({from:hits[0].station,to:hits[1].station});
      continue;
    }
    const left=stations.filter(s=>parts[0].endsWith(s)||parts[0].endsWith(s+'駅'));
    const right=stations.filter(s=>parts[1].startsWith(s));
    const longest=arr=>arr.sort((a,b)=>b.length-a.length)[0];
    if(left.length&&right.length) candidates.push({from:longest(left),to:longest(right)});
  }
  const distinct=[...new Map(candidates.map(r=>[r.from+'|'+r.to,r])).values()];
  const route=distinct.length===1?distinct[0]:{};
  if(!route.from) warnings.push('発駅・着駅を特定できません。券面を見て入力してください。');
  const amounts=[...compact.matchAll(/(?:[¥￥\\*]\s*([\d,.]+)|([\d,.]+)円)/g)].map(m=>Number((m[1]||m[2]).replaceAll(',','').replace(/\.(?=\d{3}(?:\D|$))/g,''))).filter(n=>Number.isInteger(n)&&n>0);
  // OCR often drops the yen glyph. Only an entire standalone fare line is accepted.
  if(!amounts.length) for(const line of compact.split('\n')){if(/^(?:[1-9]\d{2,5}|[1-9]\d{0,2}[,.]\d{3})$/.test(line)){const n=Number(line.replace(/[,.]/g,''));if(n%10===0)amounts.push(n);}}
  const unique=[...new Set(amounts)];
  const price=unique.length===1?unique[0]:null;
  if(price===null) warnings.push('発売額を特定できません。乗車券単体の実際の発売額を入力してください。');
  const discount=/学割/.test(compact)?'student':/割|障|介/.test(compact)?null:'none';
  if(discount===null) warnings.push('割引表示があります。本人・介護者などの種別を選択してください。');
  warnings.push('経由駅・有効期間・割引種別は券面と照合してください。読取金額は必ず確認してください。');
  if(unsupported) warnings.unshift('普通片道乗車券以外の表示を検出しました。このサイトの自動計算対象を確認してください。');
  return {from:route.from||'',to:route.to||'',price,discount,passenger:/小児|小人/.test(compact)?'child':'adult',warnings,unsupported,ticketKind};
}

export function mergeReadings(readings){
 const ticketKind=mergeTicketKinds(readings);
 const unique=key=>[...new Set(readings.map(r=>r[key]).filter(v=>v!==null&&v!==''&&v!==undefined))];
 const routes=[...new Map(readings.filter(r=>r.from&&r.to).map(r=>[r.from+'|'+r.to,{from:r.from,to:r.to}])).values()];
 const amounts=unique('price'),discounts=unique('discount'),passengers=unique('passenger');
 const warnings=[...new Set(readings.flatMap(r=>r.warnings))].filter(w=>!(routes.length===1&&w.startsWith('発駅・着駅を特定'))&&!(amounts.length===1&&w.startsWith('発売額を特定')));
 if(routes.length>1)warnings.unshift('駅名の読取結果が一致しません。券面を確認して入力してください。');
 if(amounts.length>1)warnings.unshift('金額の読取結果が一致しません。発売額を入力してください。');
 if(discounts.length>1)warnings.unshift('割引の読取結果が一致しません。割引種別を選択してください。');
 return {from:routes.length===1?routes[0].from:'',to:routes.length===1?routes[0].to:'',price:amounts.length===1?amounts[0]:null,discount:discounts.length===1&&!(discounts[0]==='none'&&readings.some(r=>r.discount===null&&r.warnings.length))?discounts[0]:null,passenger:passengers.includes('child')?'child':'adult',unsupported:readings.some(r=>r.unsupported)||ticketKind.id==='conflict',warnings,ticketKind};
}
