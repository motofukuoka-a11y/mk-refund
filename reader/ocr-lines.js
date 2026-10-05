// Assemble spatially separated words on the same printed line (MARS station spacing).
export function assembleLines(items,minScore=.72){
 const words=items.filter(i=>i.score>=minScore&&i.text?.trim()&&i.poly?.length===4).map(i=>{const xs=i.poly.map(p=>p[0]),ys=i.poly.map(p=>p[1]);return {...i,left:Math.min(...xs),top:Math.min(...ys),height:Math.max(...ys)-Math.min(...ys),cy:ys.reduce((a,b)=>a+b,0)/4};}).sort((a,b)=>a.cy-b.cy||a.left-b.left);
 const rows=[];
 for(const word of words){let row=rows.find(r=>Math.abs(word.cy-r.cy)<=Math.min(word.height,r.height)*.48);if(!row){row={words:[],cy:word.cy,height:word.height};rows.push(row);}row.words.push(word);row.cy=row.words.reduce((s,w)=>s+w.cy,0)/row.words.length;row.height=Math.min(...row.words.map(w=>w.height));}
 return rows.sort((a,b)=>a.cy-b.cy).map(r=>r.words.sort((a,b)=>a.left-b.left).map(w=>w.text).join(' ')).join('\n');
}
export function normalizeTicketText(raw){return raw.normalize('NFKC').replaceAll('乘','乗').replaceAll('经','経').replaceAll('团','団').replaceAll('歲','歳').replaceAll('惠','恵');}

// A price on a MARS ticket is often beside its validity line. A vertical serial
// stamp can cause the detector to merge it with the amount; inspect that band.
export function priceBand(items,width,height){
 const date=items.find(i=>i.score>.8&&/日.*有[効效]/.test(i.text));if(!date)return null;
 const xs=date.poly.map(p=>p[0]),ys=date.poly.map(p=>p[1]),h=Math.max(...ys)-Math.min(...ys),left=Math.round(Math.max(...xs)+width*.02),top=Math.max(0,Math.round(Math.min(...ys)-h*.5));
 if(left>width*.8||h<8)return null;
 const vertical=items.find(i=>{const x=i.poly.map(p=>p[0]),y=i.poly.map(p=>p[1]);return Math.max(...y)-Math.min(...y)>1.5*(Math.max(...x)-Math.min(...x))&&Math.min(...x)>left;});
 const right=vertical?Math.min(...vertical.poly.map(p=>p[0])):width;
 const w=Math.round(right-left),bandHeight=Math.min(height-top,Math.round(h*2.1));return w>40&&bandHeight>10?{x:left,y:top,w,h:bandHeight}:null;
}
export function recoveredMoney(items){return items.filter(i=>i.score>=.85).map(i=>i.text.normalize('NFKC')).filter(t=>{const m=t.match(/^[¥￥]([0-9,.]+)$/);if(!m)return false;const n=Number(m[1].replace(/[,.](?=\d{3}(?:\D|$))/g,''));return Number.isInteger(n)&&n>=100&&n%10===0;}).join('\n');}
