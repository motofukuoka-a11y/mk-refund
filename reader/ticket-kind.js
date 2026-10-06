const labels={ordinary:'普通乗車券',limited_express:'特急券',green:'グリーン券',seat_fee:'指定料金券',other:'その他の券',unknown:'判別できません',conflict:'券種の読取結果が一致しません'};
const combinedLabels={ordinary:'乗車券',limited_express:labels.limited_express,green:labels.green};
const labelForKinds=kinds=>kinds.length>1&&kinds.includes('ordinary')?kinds.map(k=>combinedLabels[k]||labels[k]).join('＋'):kinds.map(k=>labels[k]).join('＋');

export function classifyTicket(raw,{includeBreakdown=true}={}){
 const lines=raw.normalize('NFKC').replace(/[ \t]/g,'').replace(/[‐‑−一]/g,'ー').split('\n').filter(Boolean);
 // Printed instructions mentioning another ticket are not ticket titles.
 const headings=lines.filter(line=>line.length<=28&&! /お求め|お手持ち|有効|無効|です|ます|ご利用|必要|場合|乗車でき|払戻|別に|別途|申し受|発売|変更|ください|ません|旅客|取扱|につい|乗り継/.test(line));
 const text=headings.join('\n'),top=headings.slice(0,8).join(''),all=lines.join('');
 const titleKinds=[];
 if(/乗車券/.test(top))titleKinds.push('ordinary');
 if(/特急券|特急・グリーン券/.test(top))titleKinds.push('limited_express');
 if(/グリーン券/.test(top)||(/特急/.test(top)&&/グリーン/.test(top)))titleKinds.push('green');
 const breakdownKinds=[];
 if(/内[訳议]/.test(all)){
  if(/乗[0-9,.]+/.test(all))breakdownKinds.push('ordinary');
  if(/特[0-9,.]+/.test(all))breakdownKinds.push('limited_express');
  if(/グ[0-9,.]+/.test(all))breakdownKinds.push('green');
 }
 const kinds=[...new Set([...titleKinds,...(includeBreakdown?breakdownKinds:[])])];
 const other=/北海道[&＆]東日本[パバ]ス|周遊[パバ]ス|定期券|回数券|フリーパス|往復|連続|企画乗車券|入場券|団体乗車券|観光パス|かえり|かよエール|トクだ[値值]/.test(lines.join(''));
 const green=titleKinds.includes('green')||(includeBreakdown&&breakdownKinds.includes('green'));
 const seat=green?'green':/自由席|自由特急券/.test(top)?'unreserved':/指定席/.test(top)?'reserved':'unknown';
 if(kinds.length) return {id:kinds.join('+'),kinds,label:labelForKinds(kinds),seat,restricted:other,calculable:kinds.length===1&&kinds[0]==='ordinary'&&!other,titleKinds,breakdownKinds,breakdownOnly:includeBreakdown&&breakdownKinds.some(k=>!titleKinds.includes(k))};
 const id=/指定料金券/.test(text)?'seat_fee':other?'other':'unknown';return {id,kinds:id==='unknown'?[]:[id],label:labels[id],seat,calculable:false};
}
export function mergeTicketKinds(readings){
 const known=readings.map(r=>r.ticketKind).filter(r=>r&&r.id!=='unknown');
 if(!known.length)return classifyTicket('');
 const ids=new Set(known.map(r=>r.id));
 // Partial readings of one combined title may miss a component.
 const combined=known.find(r=>r.kinds.length>1);
 if(combined&&known.every(r=>r.kinds.every(k=>combined.kinds.includes(k))))return {...combined,city:mergeCity(known),restricted:known.some(r=>r.restricted)};
 if(ids.size>1)return {id:'conflict',kinds:[],label:labels.conflict,seat:'unknown',calculable:false};
 const seats=new Set(known.map(r=>r.seat).filter(s=>s!=='unknown'));
 return {...known[0],city:mergeCity(known),restricted:known.some(r=>r.restricted),seat:seats.size===1?[...seats][0]:'unknown',calculable:known.every(r=>r.calculable)};
}

function mergeCity(known){return {from:known.some(r=>r.city?.from),to:known.some(r=>r.city?.to)};}
