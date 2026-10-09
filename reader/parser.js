import {normalizeTicketText} from './ocr-lines.js?v=7.4.1';
import {classifyTicket,mergeTicketKinds} from './ticket-kind.js?v=7.4.1';
const breakdownMarker=/内[訳议识識]/;
const numberValue=s=>/^(?:\d+|\d{1,3}(?:[,.]\d{3})+)$/.test(s)?Number(s.replace(/[,.]/g,'')):null;
const feePattern=/(乗車券(?:運賃)?|乗車運賃|乗運賃|乗|特急(?:券|料金)?|特|グリーン(?:券|料金)?|グ)[:：]?[¥￥]?([0-9]+(?:[,.][0-9]{3})*)(?![0-9,.])/g;
export function parseTicket(raw,stations){
 const text=normalizeTicketText(raw).replace(/[‐‑−ー]/g,'ー'),compact=text.replace(/[ \t]/g,''),warnings=[];
 const cityLabel='札幌(?:[（(]市内[）)]|市内)',lines=compact.split('\n');
 const cityFrom=new RegExp(cityLabel+'[→⇒➜]').test(compact)||lines.some(line=>new RegExp('^'+cityLabel).test(line)&&stations.some(s=>s!=='札幌'&&line.endsWith(s))),cityTo=new RegExp('[→⇒➜]'+cityLabel).test(compact)||lines.some(line=>new RegExp(cityLabel+'$').test(line)&&stations.some(s=>s!=='札幌'&&line.startsWith(s)));
 const cityRestricted=/市内|都区内|山手線内/.test(compact)&&!cityFrom&&!cityTo;
 let ticketKind={...classifyTicket(text),city:{from:cityFrom,to:cityTo}};
 if(cityRestricted){ticketKind={...ticketKind,restricted:true,calculable:false};warnings.push('市内制度等の表示があります。このページの登録経路で計算できるか確認してください。');}
 const candidates=[];
 for(const line of compact.replace(/札幌(?:[（(]市内[）)]|市内)/g,'札幌').split('\n')){
  const parts=line.split(/[→⇒➜]|から/);
  if(parts.length!==2){
   if(/経由|発行|MR|MV|お求め|ご利用|場合/.test(line))continue;
   const hits=[];
   for(const station of [...stations].sort((a,b)=>b.length-a.length)){
    const index=line.indexOf(station);
    if(index>=0&&!hits.some(h=>index<h.end&&index+station.length>h.index))hits.push({station,index,end:index+station.length});
   }
   hits.sort((a,b)=>a.index-b.index);if(hits.length===2)candidates.push({from:hits[0].station,to:hits[1].station});
   continue;
  }
  const left=stations.filter(s=>parts[0].endsWith(s)||parts[0].endsWith(s+'駅')),right=stations.filter(s=>parts[1].startsWith(s));
  const longest=arr=>arr.sort((a,b)=>b.length-a.length)[0];
  if(left.length||right.length)candidates.push({from:longest(left)||'',to:longest(right)||''});
 }
 const distinct=[...new Map(candidates.map(r=>[r.from+'|'+r.to,r])).values()],origins=[...new Set(distinct.map(r=>r.from).filter(Boolean))],destinations=[...new Set(distinct.map(r=>r.to).filter(Boolean))],route=origins.length<=1&&destinations.length<=1?{from:origins[0],to:destinations[0]}:{};
 if(!route.from||!route.to)warnings.push('発駅・着駅を特定できません。券面を見て入力してください。');
 // Component amounts are not alternative total fares. Keep an explicitly
 // printed total before the breakdown marker, then read the breakdown apart.
 const moneyLines=compact.split('\n').map(l=>l.split(breakdownMarker)[0]).filter(l=>! /^(?:乗車券運賃|乗車運賃|運賃|特急料金|グリーン料金)[:：]?[¥￥]?\d/.test(l));
 const amounts=moneyLines.flatMap(line=>[...line.matchAll(/(?:[¥￥\\*]\s*([\d,.]+)|([\d,.]+)円)/g)].map(m=>numberValue(m[1]||m[2]))).filter(n=>Number.isSafeInteger(n)&&n>0);
 if(!amounts.length)for(const line of moneyLines){if(/^(?:[1-9]\d{2,5}|[1-9]\d{0,2}[,.]\d{3})$/.test(line)){const n=numberValue(line);if(n%10===0)amounts.push(n);}}
 const unique=[...new Set(amounts)],uncertainCurrency=/(?:^|\n|[¥￥])\d[\d,.]*元(?:$|\n|[)])/.test(compact),price=unique.length===1&&!uncertainCurrency?unique[0]:null;
 if(uncertainCurrency)warnings.push('金額の通貨表記が不鮮明です。券面の発売額を入力してください。');
 if(price===null)warnings.push('発売額を特定できません。券面の合計発売額を入力してください。');
 const fees=parseFeeBreakdown(compact,ticketKind,price);
 if(ticketKind.breakdownOnly&&!fees){ticketKind={...classifyTicket(text,{includeBreakdown:false}),city:{from:cityFrom,to:cityTo}};if(cityRestricted)ticketKind={...ticketKind,restricted:true,calculable:false};}
 if(breakdownMarker.test(compact)&&!fees)warnings.push('料金内訳を確定できません。合計額と券面の内訳を照合してください。');
 const unsupported=ticketKind.id!=='unknown'&&!ticketKind.calculable;
 const discountNeedsReview=ticketKind.product!=='tokudane'&&/割|障|介/.test(compact)&&! /学割/.test(compact);
 const discount=/学割/.test(compact)?'student':discountNeedsReview?null:'none';
 if(discountNeedsReview)warnings.push('割引表示があります。本人・介護者などの種別を選択してください。');
 if(ticketKind.product==='tokudane'&&ticketKind.rate===null)warnings.push(ticketKind.rateConflict?'トクだ値の割引率が一致しません。券面・申込内容で確認して入力してください。':'トクだ値の割引率を確認して入力してください。商品名の1・14・28等は申込期限を表し、割引率ではありません。');
 warnings.push('経由駅・有効期間・割引種別は券面と照合してください。読取金額は必ず確認してください。');
 if(unsupported)warnings.unshift('普通片道乗車券以外の表示を検出しました。券種・商品と払戻条件を確認してください。');
 const train=/^北斗[0-9]+号/m.test(compact)?'北斗':null;
 const seats=[];
 if(/座席未指定券/.test(compact))seats.push('unassigned');
 if(/立席特急券/.test(compact))seats.push('standing');
 if(/自由席|自由特急券/.test(compact))seats.push('unreserved');
 if(/指定席|[0-9]+号車[0-9]+番[A-Z]?席/.test(compact)&&! /座席未指定券/.test(compact))seats.push('reserved');
 const chargeSeat=seats.length===1?seats[0]:null;
 if(chargeSeat)ticketKind={...ticketKind,seat:chargeSeat};else if(seats.length>1){ticketKind={...ticketKind,seat:'unknown'};warnings.push('座席区分の表示が一致しません。券面で確認して選択してください。');}
 const probe=compact.replace(/\n/g,''),combinedCandidate=ticketKind.id==='ordinary'&&(breakdownMarker.test(probe)&&/(?:特|グ)/.test(probe)||/乗車券.{0,4}(?:特|グ)|(?:特|グ).{0,4}乗車券/.test(probe)||Boolean(chargeSeat));
 return {chargeSeat,seatConflict:seats.length>1,train,from:route.from||'',to:route.to||'',price,fees,discount,discountNeedsReview,passenger:/(?:^|\n)[(【\[]?小(?:児|人)?[)】\]]?(?:$|\n)|小児乗車券/.test(compact)?'child':/(?:^|\n)大人(?:$|\n)/.test(compact)?'adult':null,warnings,unsupported,ticketKind,combinedCandidate};
}
// A station-only crop is evidence for stations and city notation, not prices,
// ticket type or discounts printed in adjacent parts of the ticket.
export function stationOnlyReading(parsed){return {from:parsed.from,to:parsed.to,ticketKind:{id:'unknown',kinds:[],city:parsed.ticketKind.city},warnings:[],price:null,fees:null,discount:null,discountNeedsReview:false,chargeSeat:null,seatConflict:false,passenger:null,train:null,unsupported:false};}
export function mergeReadings(readings){
 const unique=key=>[...new Set(readings.map(r=>r[key]).filter(v=>v!==null&&v!==''&&v!==undefined))];
 const chargeSeats=unique('chargeSeat'),seatConflict=chargeSeats.length>1||readings.some(r=>r.seatConflict);
 let ticketKind=mergeTicketKinds(readings);
 ticketKind={...ticketKind,city:{from:readings.some(r=>r.ticketKind?.city?.from),to:readings.some(r=>r.ticketKind?.city?.to)}};
 if(seatConflict)ticketKind={...ticketKind,seat:'unknown'};else if(chargeSeats.length===1)ticketKind={...ticketKind,seat:chargeSeats[0]};
 const routes=[...new Map(readings.filter(r=>r.from&&r.to).map(r=>[r.from+'|'+r.to,{from:r.from,to:r.to}])).values()];
 const origins=unique('from'),destinations=unique('to'),routeConflict=routes.length>1||origins.length>1||destinations.length>1,completeRoute=!routeConflict&&origins.length===1&&destinations.length===1;
 const feeCandidates=[...new Map(readings.filter(r=>r.fees).map(r=>[JSON.stringify(Object.entries(r.fees).sort()),r.fees])).values()];
 const amounts=unique('price'),discounts=unique('discount'),passengers=unique('passenger');
 const discountNeedsReview=ticketKind.product!=='tokudane'&&(discounts.length>1||readings.some(r=>r.discountNeedsReview));
 const warnings=[...new Set(readings.flatMap(r=>r.warnings))].filter(w=>!(completeRoute&&w.startsWith('発駅・着駅を特定'))&&!(amounts.length===1&&w.startsWith('発売額を特定'))&&!(ticketKind.product==='tokudane'&&w.startsWith('割引表示があります')));
 if(routeConflict)warnings.unshift('駅名の読取結果が一致しません。券面を確認して入力してください。');
 if(feeCandidates.length>1)warnings.unshift('料金内訳の読取結果が一致しません。券面を確認してください。');
 if(amounts.length>1)warnings.unshift('金額の読取結果が一致しません。発売額を入力してください。');
 if(discounts.length>1&&ticketKind.product!=='tokudane')warnings.unshift('割引の読取結果が一致しません。割引種別を選択してください。');
 if(seatConflict)warnings.unshift('座席区分の読取結果が一致しません。券面を確認して選択してください。');
 if(ticketKind.rateConflict)warnings.unshift('トクだ値の割引率が一致しません。確認して入力してください。');
 return {chargeSeat:!seatConflict&&chargeSeats.length===1?chargeSeats[0]:null,seatConflict,train:unique('train').length===1?unique('train')[0]:null,from:!routeConflict&&origins.length===1?origins[0]:'',to:!routeConflict&&destinations.length===1?destinations[0]:'',price:amounts.length===1?amounts[0]:null,fees:feeCandidates.length===1&&amounts.length===1&&Object.values(feeCandidates[0]).reduce((a,b)=>a+b,0)===amounts[0]?feeCandidates[0]:null,discount:!discountNeedsReview&&discounts.length===1?discounts[0]:null,discountNeedsReview,passenger:passengers.length===1?passengers[0]:null,unsupported:readings.some(r=>r.unsupported)||ticketKind.id==='conflict',warnings,ticketKind};
}
export function needsAdditionalReading(parsed){
 if(!parsed?.ticketKind)return false;
 if(parsed.ticketKind.id==='ordinary')return Boolean(parsed.combinedCandidate);
 if(parsed.ticketKind.product==='tokudane')return parsed.ticketKind.rate===null||!parsed.fees;
 return parsed.ticketKind.kinds?.length>1&&!parsed.fees;
}
export function canStopAfterReading(parsed){return Boolean(parsed?.from&&parsed?.to&&parsed?.price&&parsed.ticketKind?.id!=='unknown'&&!needsAdditionalReading(parsed));}
export function parseFeeBreakdown(text,kind,total){
 if(!total)return null;
 const compact=text.normalize('NFKC').replace(/[ \t]/g,'');
 const blocks=compact.split(/内[訳议识識][:：]?/).slice(1),candidates=[];
 for(const block of blocks){
  const fees={};let valid=true;
  for(const line of block.split('\n')){
   const matches=[...line.matchAll(feePattern)];
   if(!matches.length){if(Object.keys(fees).length)break;continue;}
   for(const m of matches){const key=m[1].startsWith('乗')?'ordinary':m[1].startsWith('特')?'limited_express':'green',n=numberValue(m[2]);
    if(!kind.kinds.includes(key)||Object.hasOwn(fees,key)||!Number.isSafeInteger(n)||n<=0||n%10!==0){valid=false;break;}fees[key]=n;
   }
   if(!valid)break;
  }
  if(valid&&Object.keys(fees).length>=2&&kind.kinds.every(k=>Object.hasOwn(fees,k))&&Object.values(fees).reduce((a,b)=>a+b,0)===total)candidates.push(fees);
 }
 const unique=[...new Map(candidates.map(f=>[JSON.stringify(Object.entries(f).sort()),f])).values()];
 return unique.length===1?unique[0]:null;
}
