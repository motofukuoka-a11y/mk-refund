import {readTokudane} from './tokudane.js?v=7.4.0';
const labels={ordinary:'普通乗車券',limited_express:'特急券',green:'グリーン券',seat_fee:'指定料金券',other:'その他・個別条件のある券',unknown:'判別できません',conflict:'券種の読取結果が一致しません'};
const combinedLabels={ordinary:'乗車券',limited_express:labels.limited_express,green:labels.green};
const labelForKinds=kinds=>kinds.length>1&&kinds.includes('ordinary')?kinds.map(k=>combinedLabels[k]||labels[k]).join('＋'):kinds.map(k=>labels[k]).join('＋');
const breakdownMarker=/内[訳议识識]/;
export function classifyTicket(raw,{includeBreakdown=true}={}){
 const lines=raw.normalize('NFKC').replace(/[ \t]/g,'').replace(/[‐‑−一]/g,'ー').split('\n').filter(Boolean);
 const headings=lines.filter(line=>line.length<=28&&!/お求め|お手持ち|有効|無効|です|ます|ご利用|必要|場合|乗車でき|払戻|別に|別途|申し受|発売|変更|ください|ません|旅客|取扱|につい|乗り継/.test(line));
 const text=headings.join('\n'),top=headings.slice(0,8).join(''),all=lines.join('');
 const titleKinds=[];
 if(/乗車券/.test(top))titleKinds.push('ordinary');
 if(/特急券|特急・グリーン券/.test(top))titleKinds.push('limited_express');
 if(/グリーン券/.test(top)||(/特急/.test(top)&&/グリーン/.test(top)))titleKinds.push('green');
 const breakdownKinds=[];
 if(breakdownMarker.test(all)){
  if(/乗(?:車券(?:運賃)?|車運賃|運賃)?[:：]?[¥￥]?[0-9,.]+/.test(all))breakdownKinds.push('ordinary');
  if(/特(?:急券|急料金|急)?[:：]?[¥￥]?[0-9,.]+/.test(all))breakdownKinds.push('limited_express');
  if(/(?:グリーン(?:券|料金)?|グ)[:：]?[¥￥]?[0-9,.]+/.test(all))breakdownKinds.push('green');
 }
 const kinds=[...new Set([...titleKinds,...(includeBreakdown?breakdownKinds:[])])];
 const other=/北海道[&＆]東日本[パバ]ス|周遊[パバ]ス|定期券|回数券|フリーパス|往復|連続|企画乗車券|入場券|団体乗車券|観光パス|かえり|かよエール/.test(top);
 const product=readTokudane(lines.join('\n'));
 if(product){
  const restricted=other||/障害|障がい|障割|障害者割|JREPOINT|料金(?:券)?のみ|チケットレス特急券|トク割|グリーン|自由席|立席|座席未指定/.test(top);
  return {id:'tokudane',kinds:['ordinary','limited_express'],label:'トクだ値（乗車券＋特急券）',seat:'reserved',calculable:false,restricted,...product,titleKinds,breakdownKinds};
 }
 const green=titleKinds.includes('green')||(includeBreakdown&&breakdownKinds.includes('green'));
 const seat=green?'green':/自由席|自由特急券/.test(top)?'unreserved':/指定席/.test(top)?'reserved':'unknown';
 if(kinds.length)return {id:kinds.join('+'),kinds,label:labelForKinds(kinds),seat,restricted:other,calculable:kinds.length===1&&kinds[0]==='ordinary'&&!other,titleKinds,breakdownKinds,breakdownOnly:includeBreakdown&&breakdownKinds.some(k=>!titleKinds.includes(k))};
 const id=/指定料金券/.test(text)?'seat_fee':other?'other':'unknown';
 return {id,kinds:id==='unknown'?[]:[id],label:labels[id],seat,restricted:other,calculable:false};
}
export function mergeTicketKinds(readings){
 const known=readings.map(r=>r.ticketKind).filter(r=>r&&r.id!=='unknown');
 if(!known.length)return classifyTicket('');
 const product=known.find(r=>r.product==='tokudane');
 if(product){
  const rates=[...new Set(known.filter(r=>r.product==='tokudane').map(r=>r.rate).filter(n=>n!==null))];
  const rateConflict=rates.length>1||known.some(r=>r.rateConflict);
  return {...product,city:mergeCity(known),rate:!rateConflict&&rates.length===1?rates[0]:null,rateConflict,restricted:known.some(r=>r.restricted)||known.some(r=>r.kinds.some(k=>!product.kinds.includes(k)))};
 }
 const ids=new Set(known.map(r=>r.id));
 const seats=new Set(known.map(r=>r.seat).filter(s=>s!=='unknown'));
 const combined=known.find(r=>r.kinds.length>1);
 if(combined&&known.every(r=>r.kinds.every(k=>combined.kinds.includes(k))))return {...combined,city:mergeCity(known),restricted:known.some(r=>r.restricted),seat:seats.size===1?[...seats][0]:'unknown'};
 if(ids.size>1)return {id:'conflict',kinds:[],label:labels.conflict,seat:'unknown',calculable:false,restricted:true};
 return {...known[0],city:mergeCity(known),restricted:known.some(r=>r.restricted),seat:seats.size===1?[...seats][0]:'unknown',calculable:known.every(r=>r.calculable)};
}
function mergeCity(known){return {from:known.some(r=>r.city?.from),to:known.some(r=>r.city?.to)};}

// A manual selection always represents an explicit user correction. Never
// convert an unsupported detection into an ordinary ticket automatically.
export function editableTicketKind(value){
 if(value==='tokudane')return {id:value,product:value,kinds:['ordinary','limited_express'],label:'トクだ値（乗車券＋特急券）',seat:'reserved',calculable:false};
 if(value==='other')return {id:value,kinds:['other'],label:labels.other,restricted:true,calculable:false};
 const kinds=value.split('+');
 if(!value||!kinds.every(k=>['ordinary','limited_express','green'].includes(k)))return null;
 return {id:value,kinds,label:labelForKinds(kinds),seat:'unknown',calculable:value==='ordinary'};
}
