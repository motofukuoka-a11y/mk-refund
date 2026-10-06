import {supportsCancellation,cancellationLabels,createCancellationCalculator} from './cancellation.js?v=7';
const yen=n=>`${n.toLocaleString('ja-JP')}円`;
function jstDate(value){
 if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value||''))throw new Error('申出日時・列車出発日時を入力してください。');
 const date=new Date(value+':00+09:00');
 if(!Number.isFinite(date.getTime())||new Date(date.getTime()+9*3600000).toISOString().slice(0,16)!==value)throw new Error('申出日時・列車出発日時が正しくありません。');
 return date;
}
export function createReaderRefundCalculator(calculator,stations){
 const after=createCancellationCalculator(calculator,stations);
 return input=>{
  if(input.usage==='after')return {...after(input),usage:'after'};
  if(input.usage!=='before')throw new Error('使用開始前・使用開始後を選択してください。');
  const {kind,mode,price,components,from,to,vias=[],chargeSeat,unavailable={}}=input;
  if(!supportsCancellation(kind))throw new Error('この券種・企画商品は自動計算対象外です。');
  if(!['normal','accident'].includes(mode))throw new Error('払戻の理由を選択してください。');
  if(!input.unused)throw new Error('この券が未使用であることを確認してください。');
  if(!input.valid)throw new Error('有効期間内（前売りは有効期間開始前を含む）であることを確認してください。');
  if(!Number.isInteger(price)||price<=0)throw new Error('実際の発売額を円単位で確認してください。');
  if(from===to||![from,to,...vias].every(s=>stations.includes(s)))throw new Error('元券の発着駅・経由駅を確認してください。');
  if(input.city?.from&&from!=='札幌'||input.city?.to&&to!=='札幌')throw new Error('札幌市内の中心駅は札幌です。元券の発着駅を確認してください。');
  const parts=kind.kinds.length===1?{[kind.kinds[0]]:price}:components;
  if(!parts||Object.keys(parts).length!==kind.kinds.length||!kind.kinds.every(k=>Number.isInteger(parts[k])&&parts[k]>0)||Object.values(parts).reduce((n,v)=>n+v,0)!==price)throw new Error('料金内訳の合計を券面の発売額に合わせてください。');
  const feeTypes=kind.kinds.filter(k=>k!=='ordinary'),joint=feeTypes.includes('limited_express')&&feeTypes.includes('green');
  if(mode==='accident'&&(!input.purchasedBefore||!input.tripCancelled))throw new Error('運休の事由発生前に購入し、運休により旅行を取りやめることを確認してください。');
  if(mode==='normal'&&feeTypes.length){
   if(!['reserved','unreserved','unassigned','standing'].includes(chargeSeat))throw new Error('料金券の座席区分を券面で確認してください。');
   if(kind.kinds.includes('green')&&!['reserved','unreserved'].includes(chargeSeat))throw new Error('グリーン券の指定席・自由席を確認してください。');
   if(joint&&chargeSeat!=='reserved')throw new Error('特急券・グリーン券の一体券は指定席の同時払戻のみ自動計算します。');
  }
  let late=false;
  if(mode==='normal'&&feeTypes.length&&['reserved','standing'].includes(chargeSeat)){
   if(Object.hasOwn(input,'timingBand')){
    if(!['early','late','changed','departed'].includes(input.timingBand))throw new Error('出発日の2日前まで・前日当日など、払戻時期を選択してください。');
    if(input.timingBand==='departed')throw new Error('出発時刻を過ぎた指定券は通常の使用開始前払戻の対象外です。');
    if(chargeSeat==='standing'&&input.timingBand==='changed')throw new Error('立席特急券は出発前の時期を確認してください。');
    late=input.timingBand==='late'||input.timingBand==='changed';
   }else{
   const request=jstDate(input.requestDate),departure=jstDate(input.departureDate);
   if(request>=departure)throw new Error('指定列車の出発時刻以降は通常の使用開始前払戻の対象外です。');
   if(chargeSeat==='reserved'){
    if(!['yes','no'].includes(input.changedLate))throw new Error('出発日・前日に変更した指定券か確認してください。');
    const day=v=>Date.UTC(...v.slice(0,10).split('-').map((n,i)=>Number(n)-(i===1?1:0)));
    late=(day(input.departureDate)-day(input.requestDate))/86400000<2||input.changedLate==='yes';
   }
   }
  }
  const rows=kind.kinds.map(type=>{
   const paid=parts[type];let fee=0,eligible=true,reason='',source='';
   if(mode==='accident'){
    if(type!=='ordinary'&&unavailable[type]!=='yes')throw new Error(`${cancellationLabels[type]}の指定列車・設備を運休で利用できなかったことを確認してください。`);
    reason='運休により使用開始前に旅行を取りやめるため、発売額全額を無手数料で払戻。';source='第282条第1項第1号';
   }else if(type==='ordinary'){fee=220;reason='未使用・有効期間内（前売りは開始前を含む）の普通乗車券。支払済み運賃から220円を控除。';source='第271条';}
   else if(joint&&type==='limited_express'){reason='指定席の特急券・グリーン券を一体で同時払戻するため、特急券分の手数料は収受しません。';source='第273条第4項';}
   else if(chargeSeat==='unreserved'||chargeSeat==='standing'){fee=220;reason=chargeSeat==='standing'?'出発時刻前の立席特急券。手数料220円。':'未使用・有効期間内の自由席料金券。手数料220円。';source='第271条・第273条';}
   else if(chargeSeat==='unassigned'){fee=340;reason='未使用・券面表示の乗車日までの座席未指定券。手数料340円。';source='JR北海道 きっぷの払いもどし（座席未指定券）';}
   else{fee=late?Math.max(340,Math.floor(paid*.3/10)*10):340;reason=late?'出発日前日・当日、または出発日・前日に変更した指定券。30％（10円未満切捨て、最低340円）。':'列車出発日の2日前まで。手数料340円。';source=joint?'第273条第1項・第4項':'第273条第1項';}
   const refund=Math.max(0,paid-fee);return {type,label:cancellationLabels[type],paid,fee,refund,eligible,reason,source,formula:`${yen(paid)} − ${yen(fee)} ＝ ${yen(refund)}${paid<fee?'（払戻額は0円を下限）':''}`};
  });
  const path=calculator.route(from,to,vias),refund=rows.reduce((n,r)=>n+r.refund,0),fee=rows.reduce((n,r)=>n+r.fee,0);
  return {usage:'before',from,to,price,mode,path,rows,refund,fee,eligible:true,city:input.city,chargeSeat,timingBand:input.timingBand,requestDate:input.requestDate,departureDate:input.departureDate,reason:mode==='normal'?'使用開始前の通常払戻。券種別の手数料を控除しています。':'使用開始前の運休による事故払戻。確認した条件により全額・無手数料。',formula:rows.map(r=>`${r.label}：${r.formula}`).join('\n')+(rows.length>1?`\n合計払戻額：${yen(refund)}`:'')};
 };
}
