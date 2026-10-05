const labels={ordinary:'普通乗車券',limited_express:'特急券',green:'グリーン券',seat_fee:'指定料金券',other:'その他の券',unknown:'判別できません',conflict:'券種の読取結果が一致しません'};
export function classifyTicket(raw){
 const lines=raw.normalize('NFKC').replace(/[ \t]/g,'').replace(/[‐‑−一]/g,'ー').split('\n').filter(Boolean);
 // Printed instructions mentioning another ticket are not ticket titles.
 const headings=lines.filter(line=>line.length<=28&&! /お求め|お手持ち|有効|無効|です|ます|ご利用|必要|場合|乗車でき|払戻|別に|別途|申し受|発売|変更|ください|ません|旅客|取扱|につい|乗り継/.test(line));
 const text=headings.join('\n'),top=headings.slice(0,8).join('');
 const breakdown=/内[訳议].*乗[0-9,.]+.*特[0-9,.]+/.test(lines.join('')),ordinary=/乗車券/.test(top)||breakdown,express=/特急券|特急・グリーン券/.test(top)||breakdown,green=/グリーン券/.test(top)||(express&&/グリーン/.test(top));
 const kinds=[];if(ordinary)kinds.push('ordinary');if(express)kinds.push('limited_express');if(green)kinds.push('green');
 const other=/北海道[&＆]東日本[パバ]ス|周遊[パバ]ス|定期券|回数券|フリーパス|往復|連続|企画乗車券|入場券|団体乗車券|観光パス|かえり|かよエール|トクだ値/.test(lines.join(''));
 const seat=green?'green':/自由席|自由特急券/.test(top)?'unreserved':/指定席/.test(top)?'reserved':'unknown';
 if(kinds.length) return {id:kinds.join('+'),kinds,label:kinds.map(k=>labels[k]).join('＋'),seat,calculable:kinds.length===1&&kinds[0]==='ordinary'&&!other};
 const id=/指定料金券/.test(text)?'seat_fee':other?'other':'unknown';return {id,kinds:id==='unknown'?[]:[id],label:labels[id],seat,calculable:false};
}
export function mergeTicketKinds(readings){
 const known=readings.map(r=>r.ticketKind).filter(r=>r&&r.id!=='unknown');
 if(!known.length)return classifyTicket('');
 const ids=new Set(known.map(r=>r.id));
 // Partial readings of one combined title may miss a component.
 const combined=known.find(r=>r.kinds.length>1);
 if(combined&&known.every(r=>r.kinds.every(k=>combined.kinds.includes(k))))return combined;
 if(ids.size>1)return {id:'conflict',kinds:[],label:labels.conflict,seat:'unknown',calculable:false};
 const seats=new Set(known.map(r=>r.seat).filter(s=>s!=='unknown'));
 return {...known[0],seat:seats.size===1?[...seats][0]:'unknown',calculable:known.every(r=>r.calculable)};
}
