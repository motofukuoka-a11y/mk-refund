import {cityContext} from './city-zone.js?v=6.3';
export const cancellationLabels={ordinary:'普通乗車券',limited_express:'特急券',green:'グリーン券'};
export function supportsCancellation(kind){return Boolean(kind&&!kind.restricted&&kind.kinds?.length&&kind.kinds.every(k=>Object.hasOwn(cancellationLabels,k)));}
export function suggestedVias(train,from,to,calculator){
 if(train!=='北斗')return [];
 const corridor=['札幌',...calculator.route('札幌','函館',['南千歳','東室蘭']).map(s=>s.to)],a=corridor.indexOf(from),b=corridor.indexOf(to);
 if(a<0||b<0||a===b)return [];
 const points=a<b?corridor.slice(a+1,b):corridor.slice(b+1,a).reverse();return points.filter(s=>['南千歳','東室蘭'].includes(s));
}
export function createCancellationCalculator(calculator,stations){
 return function(input){
  const {kind,mode,from,to,stop,vias=[],price,components,started,valid,purchasedBefore,unavailable={}}=input;
  if(kind?.product==='tokudane')throw new Error('トクだ値には通常乗車券の使用開始後計算を適用できません。駅窓口で確認してください。');
  if(!supportsCancellation(kind))throw new Error('この券種は自動計算対象外です。普通片道乗車券・特急券・グリーン券を確認してください。');
  if(!['normal','accident'].includes(mode))throw new Error('旅行中止の理由を選択してください。');
  if(!started)throw new Error('この券の使用を開始した後の旅行中止であることを確認してください。使用開始前はMK払戻サイトをご利用ください。');
  if(!valid)throw new Error('券面の有効期間・乗車日を確認してください。');
  if(![from,to,stop,...vias].every(s=>stations.includes(s))||from===to)throw new Error('発駅・着駅・旅行中止駅・経由駅を登録駅から確認してください。');
  if(!Number.isInteger(price)||price<=0)throw new Error('券面の実際の発売額を円単位で確認してください。');
  const parts=kind.kinds.length===1?{[kind.kinds[0]]:price}:components;
  if(!parts||Object.keys(parts).length!==kind.kinds.length||!kind.kinds.every(k=>Number.isInteger(parts[k])&&parts[k]>0)||Object.values(parts).reduce((a,b)=>a+b,0)!==price)throw new Error('一体券は各券種の発売額を確認し、内訳の合計を券面発売額に合わせてください。');
  const context=cityContext(input,calculator);
  const path=context?.path||calculator.route(from,to,vias),points=[context?.actualFrom||from,...path.map(s=>s.to)],positions=points.flatMap((s,i)=>s===stop?[i]:[]);
  if(!positions.length)throw new Error('旅行中止駅が元券の経路上にありません。経由駅を確認してください。');
  if(positions.length!==1)throw new Error('旅行中止駅を複数回通るため中止位置を特定できません。');
  const used=path.slice(0,positions[0]),unused=path.slice(positions[0]),usedInfo=calculator.totals(context?.usedFarePath||used),unusedInfo=calculator.totals(context?.unusedFarePath||unused),rows=[];
  if(mode==='accident'&&!purchasedBefore)throw new Error('運休の事由が発生する前に購入した券であることを確認してください。');
  for(const type of kind.kinds){
   const paid=parts[type];
   if(type==='ordinary'){
    const ordinary=calculator.calculate({...input,price:paid,cityContext:context});
    if(mode==='normal')rows.push({type,label:cancellationLabels[type],paid,refund:ordinary.refund,fee:ordinary.fee,eligible:ordinary.eligible,reason:ordinary.reason,ordinary,formula:ordinary.eligible?`${paid.toLocaleString('ja-JP')}円 − ${ordinary.deduction.toLocaleString('ja-JP')}円 − 220円 ＝ ${ordinary.refund.toLocaleString('ja-JP')}円`:'未使用区間101km未満：自動計算対象外',source:'第274条'});
    else{const before=unused.length?calculator.fare(unusedInfo.table,unusedInfo.km,input.passenger):0,amount=Math.ceil(before*(1-Number(ordinary.rule.rate))/10)*10,refund=Math.min(paid,amount);rows.push({type,label:cancellationLabels[type],paid,refund,fee:0,eligible:true,reason:'運休：未使用区間運賃に元券の割引率を適用。未使用区間だけの距離条件は問いません。発売額が上限です。',before,ordinary,formula:`未使用区間運賃 ${before.toLocaleString('ja-JP')}円 × ${Math.round((1-Number(ordinary.rule.rate))*100)}％ → ${amount.toLocaleString('ja-JP')}円（10円単位切上げ）／発売額上限 ${paid.toLocaleString('ja-JP')}円 − 手数料0円 ＝ ${refund.toLocaleString('ja-JP')}円`,source:'第239条・第282条の2第1号'});}
   }else{
    if(mode==='accident'&&unused.length&&!['yes','no'].includes(unavailable[type]))throw new Error(`${cancellationLabels[type]}の指定列車・設備を運休で一部利用できなかったか確認してください。`);
    const refund=mode==='accident'&&unused.length&&unavailable[type]==='yes'?paid:0;
    rows.push({type,label:cancellationLabels[type],paid,refund,fee:0,eligible:true,reason:mode==='normal'?'お客様都合の使用開始後の途中中止では、区間短縮による料金の払戻はありません。':!unused.length?'旅行中止駅が着駅のため、運休で利用できなかった区間はありません。':unavailable[type]==='yes'?'指定列車・設備の一部を運休により利用できなかったものとして、当該料金全額を無手数料で払戻。':'指定列車・設備を利用できたため、当該料金は払戻対象ではありません。',formula:refund?`${paid.toLocaleString('ja-JP')}円 − 手数料0円 ＝ ${refund.toLocaleString('ja-JP')}円`:'使用開始後の当該料金：払戻額0円・手数料0円',source:mode==='normal'?'第249条第2項・第252条第8項／使用開始後の料金券':type==='limited_express'?'第282条の2第2号':'第282条の2第3号'});
   }
  }
  return {from,to,stop,price,mode,path,cityContext:context,usedInfo,unusedInfo,rows,refund:rows.reduce((n,r)=>n+r.refund,0),fee:rows.reduce((n,r)=>n+r.fee,0),eligible:rows.every(r=>r.eligible),reason:mode==='normal'?'お客様都合の旅行中止（使用開始後）。券種ごとの払戻額を合計しています。':'列車の運休による旅行中止（使用開始後）。確認した条件を基に券種ごとの払戻額を合計しています。',formula:rows.map(r=>`${r.label}：${r.formula}`).join('\n')+(rows.length>1?'\n合計：'+rows.map(r=>r.refund.toLocaleString('ja-JP')+'円').join(' ＋ ')+' ＝ '+rows.reduce((n,r)=>n+r.refund,0).toLocaleString('ja-JP')+'円':'')};
 };
}
