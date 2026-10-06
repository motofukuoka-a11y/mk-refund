import {normalizeTicketText} from './ocr-lines.js?v=6';
import {classifyTicket,mergeTicketKinds} from './ticket-kind.js?v=7.2';
export function parseTicket(raw, stations) {
  const text=normalizeTicketText(raw).replace(/[‐‑−ー]/g,'ー');
  const compact=text.replace(/[ \t]/g,'');
  const warnings=[];
  const cityFrom=/札幌(?:[（(]市内[）)]|市内)\s*[→⇒➜]/.test(compact),cityTo=/[→⇒➜]\s*札幌(?:[（(]市内[）)]|市内)/.test(compact);
  let ticketKind={...classifyTicket(text),city:{from:cityFrom,to:cityTo}};if(/市内|都区内|山手線内/.test(compact)&&!cityFrom&&!cityTo){ticketKind={...ticketKind,restricted:true,calculable:false};warnings.push('市内制度等の表示があります。このページの普通乗車券計算には対応していません。');}
  const candidates=[];
  for (const line of compact.replace(/札幌(?:[（(]市内[）)]|市内)/g,'札幌').split('\n')) {
    const parts=line.split(/[→⇒➜]|\s+から\s+/);
    if(parts.length!==2) {
      if(/経由|発行|MR|MV/.test(line)) continue;
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
  const uncertainCurrency=/(?:^|\n|[¥￥])\d[\d,.]*元(?:$|\n|[)])/.test(compact);
  const price=unique.length===1&&!uncertainCurrency?unique[0]:null;
  if(uncertainCurrency)warnings.push('金額の通貨表記が不鮮明です。券面の発売額を入力してください。');
  if(price===null) warnings.push('発売額を特定できません。乗車券単体の実際の発売額を入力してください。');
  let fees=parseFeeBreakdown(compact,ticketKind,price);
  // A partial title such as "乗車券・特" is promoted by a fee breakdown only
  // when the breakdown is complete and adds up to the printed total. If that
  // check fails, retain the explicit title evidence and do not guess a joint
  // ticket from OCR fragments.
  if(ticketKind.breakdownOnly&&!fees){
    ticketKind={...classifyTicket(text,{includeBreakdown:false}),city:{from:cityFrom,to:cityTo}};
    if(/市内|都区内|山手線内/.test(compact)&&!cityFrom&&!cityTo)ticketKind={...ticketKind,restricted:true,calculable:false};
  }
  if(/内[訳议]/.test(compact)&&!fees)warnings.push('料金内訳を確定できません。合計額と券面の内訳を照合してください。');
  const unsupported=ticketKind.id!=='unknown'&&!ticketKind.calculable;
  const discount=/学割/.test(compact)?'student':/割|障|介/.test(compact)?null:'none';
  if(discount===null) warnings.push('割引表示があります。本人・介護者などの種別を選択してください。');
  warnings.push('経由駅・有効期間・割引種別は券面と照合してください。読取金額は必ず確認してください。');
  if(unsupported) warnings.unshift('普通片道乗車券以外の表示を検出しました。このサイトの自動計算対象を確認してください。');
  const train=/^北斗[0-9]+号/m.test(compact)?'北斗':null;
  const chargeSeat=/座席未指定券/.test(compact)?'unassigned':/立席特急券/.test(compact)?'standing':/自由席|自由特急券/.test(compact)?'unreserved':/指定席|[0-9]+号車[0-9]+番[A-Z]?席/.test(compact)?'reserved':null;
  if(chargeSeat)ticketKind={...ticketKind,seat:chargeSeat};
  const combinedProbe=compact.replace(/\n/g,'');
  const combinedCandidate=ticketKind.id==='ordinary'&&(/内[訳议].*(?:特|グ)/.test(combinedProbe)||/乗車券.{0,4}(?:特|グ)|(?:特|グ).{0,4}乗車券/.test(combinedProbe));
  return {chargeSeat,train,from:route.from||'',to:route.to||'',price,fees,discount,passenger:/(?:^|\n)[(【\[]?小(?:児|人)?[)】\]]?(?:$|\n)|小児乗車券/.test(compact)?'child':/(?:^|\n)大人(?:$|\n)/.test(compact)?'adult':null,warnings,unsupported,ticketKind,combinedCandidate};
}

export function mergeReadings(readings){
 const unique=key=>[...new Set(readings.map(r=>r[key]).filter(v=>v!==null&&v!==''&&v!==undefined))];
 const chargeSeats=unique('chargeSeat');
 let ticketKind=mergeTicketKinds(readings);
 if(chargeSeats.length===1)ticketKind={...ticketKind,seat:chargeSeats[0]};
 const routes=[...new Map(readings.filter(r=>r.from&&r.to).map(r=>[r.from+'|'+r.to,{from:r.from,to:r.to}])).values()];
 const feeCandidates=[...new Map(readings.filter(r=>r.fees).map(r=>[JSON.stringify(r.fees),r.fees])).values()];
 const amounts=unique('price'),discounts=unique('discount'),passengers=unique('passenger');
 const warnings=[...new Set(readings.flatMap(r=>r.warnings))].filter(w=>!(routes.length===1&&w.startsWith('発駅・着駅を特定'))&&!(amounts.length===1&&w.startsWith('発売額を特定')));
 if(routes.length>1)warnings.unshift('駅名の読取結果が一致しません。券面を確認して入力してください。');
 if(feeCandidates.length>1)warnings.unshift('料金内訳の読取結果が一致しません。券面を確認してください。');
 if(amounts.length>1)warnings.unshift('金額の読取結果が一致しません。発売額を入力してください。');
 if(discounts.length>1)warnings.unshift('割引の読取結果が一致しません。割引種別を選択してください。');
 return {chargeSeat:chargeSeats.length===1?chargeSeats[0]:null,train:unique('train').length===1?unique('train')[0]:null,from:routes.length===1?routes[0].from:'',to:routes.length===1?routes[0].to:'',price:amounts.length===1?amounts[0]:null,fees:feeCandidates.length===1&&amounts.length===1&&Object.values(feeCandidates[0]).reduce((a,b)=>a+b,0)===amounts[0]?feeCandidates[0]:null,discount:discounts.length===1&&!(discounts[0]==='none'&&readings.some(r=>r.discount===null&&r.warnings.length))?discounts[0]:null,passenger:passengers.length===1?passengers[0]:null,unsupported:readings.some(r=>r.unsupported)||ticketKind.id==='conflict',warnings,ticketKind};
}

export function needsAdditionalReading(parsed){
 if(!parsed?.ticketKind)return false;
 if(parsed.ticketKind.id==='ordinary')return Boolean(parsed.combinedCandidate);
 return parsed.ticketKind.kinds?.length>1&&!parsed.fees;
}

export function canStopAfterReading(parsed){
 return Boolean(parsed?.from&&parsed?.to&&parsed?.price&&parsed.ticketKind?.id!=='unknown'&&!needsAdditionalReading(parsed));
}

// Only an explicit breakdown with a matching total is accepted; train numbers,
// dates, seat numbers and uncertain OCR digits are never used to fill a fee.
export function parseFeeBreakdown(text,kind,total){
 if(!total)return null;const lines=text.normalize('NFKC').replace(/[ \t]/g,'').split('\n').filter(l=>/内[訳议]/.test(l));
 const candidates=[];for(const line of lines){const tail=line.split(/内[訳议][:：]?/)[1];if(!tail)continue;
  const matches=[...tail.matchAll(/(乗|特|グ)([0-9]+(?:[,.][0-9]{3})*)(?![0-9,.])/g)];
  const fees={},keys={乗:'ordinary',特:'limited_express',グ:'green'};let valid=true;
  for(const m of matches){const key=keys[m[1]],n=Number(m[2].replace(/[,.]/g,''));if(!kind.kinds.includes(key)||Object.hasOwn(fees,key)||n<=0||n%10!==0){valid=false;break;}fees[key]=n;}
  if(valid&&matches.length>=2&&kind.kinds.every(k=>Object.hasOwn(fees,k))&&Object.values(fees).reduce((a,b)=>a+b,0)===total)candidates.push(fees);
 }
 return candidates.length===1?candidates[0]:null;
}
