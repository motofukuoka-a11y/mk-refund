export const tokudaneSource='https://www.eki-net.com/top/jrticket/guide/reserve/tokudane.html';
export const tokudaneName=/トク[だダ][値值]|(?:とく|トク)[だダ][ねネ]/;

// 1 / 14 / 21 / 28 are booking deadlines, not percentage rates.
export function readTokudane(raw){
 const text=raw.normalize('NFKC').replace(/[ \t]/g,'');
 if(!tokudaneName.test(text))return null;
 const rates=[];
 for(const line of text.split('\n')){
  for(const m of line.matchAll(/(?:トク[だダ][値值]|(?:とく|トク)[だダ][ねネ])(\d{1,2})(?!\d)/g)){
   const rate=Number(m[1]);if(rate>=5&&rate<=95&&rate%5===0)rates.push(rate);
  }
  if(tokudaneName.test(line)||/割引率|割引|割引き/.test(line)||/^\d{1,2}(?:%|パーセント)(?:引|割引)?$/.test(line)){
   for(const m of line.matchAll(/(?:割引率[:：]?(\d{1,2})(?:%|パーセント)?|(\d{1,2})(?:%|パーセント)(?:引|割引)?)/g))rates.push(Number(m[1]||m[2]));
  }
 }
 const unique=[...new Set(rates.filter(n=>n>0&&n<100))];
 return {product:'tokudane',rate:unique.length===1?unique[0]:null,rateConflict:unique.length>1};
}

export function calculateTokudane(input,calculator,stations){
 const {kind,mode,usage,price,from,to,vias=[]}=input;
 if(kind.restricted)throw new Error('このトクだ値は個別条件の確認が必要です。券種・商品を券面で修正してください。');
 if(usage!=='before')throw new Error('トクだ値の使用開始後・乗り遅れは個別取扱いです。通常乗車券の途中中止計算は適用できません。駅窓口で確認してください。');
 if(!['normal','accident'].includes(mode))throw new Error('払戻の理由を選択してください。');
 if(!input.tokudanePaper)throw new Error('受取済みの紙のトクだ値（乗車券＋特急券セット、1席分）であることを確認してください。');
 if(!input.unused||!input.valid)throw new Error('未使用・有効期間内であることを確認してください。');
 if(!Number.isSafeInteger(price)||price<=0)throw new Error('実際に支払った1席分の発売額を円単位で確認してください。');
 if(from===to||![from,to,...vias].every(s=>stations.includes(s)))throw new Error('元券の発着駅・経由駅を登録駅から確認してください。');
 if(kind.kinds.join('+')!=='ordinary+limited_express')throw new Error('この計算は乗車券＋特急券セットのトクだ値のみ対象です。');
 if(mode==='accident')throw new Error('トクだ値の運休払戻は運休区間・使用状況による個別取扱いです。駅窓口で無手数料の払戻条件を確認してください。');
 if(input.tokudaneDeparture!=='before')throw new Error(input.tokudaneDeparture==='departed'?'指定列車の出発時刻を過ぎたトクだ値は、この未使用払戻計算の対象外です。':'指定列車の出発時刻前であることを選択してください。');
 const rate=Number(input.tokudaneRate);
 if(!Number.isInteger(rate)||rate<=0||rate>=100)throw new Error('券面・申込内容の割引率を1〜99％で入力してください。商品名の1・14・28は割引率ではありません。');
 const parts=input.components;
 if(!parts||Object.keys(parts).length!==2||!kind.kinds.every(type=>Number.isSafeInteger(parts[type])&&parts[type]>0))throw new Error('トクだ値は乗車券運賃と特急料金の実発売額を、それぞれ円単位で入力してください。');
 if(parts.ordinary+parts.limited_express!==price)throw new Error('乗車券運賃と特急料金の内訳合計を、券面の発売額に合わせてください。');
 const format=n=>`${n.toLocaleString('ja-JP')}円`;
 const rows=[['ordinary','乗車券',220],['limited_express','特急券',340]].map(([type,label,minimum])=>{
  const paid=parts[type];
  // Round each component before adding. Integer arithmetic avoids losing
  // another 10 yen when a floating-point product lies below an exact boundary.
  const roundedFee=Number(BigInt(paid)*BigInt(rate)/1000n)*10;
  const fee=Math.min(paid,Math.max(minimum,roundedFee)),refund=paid-fee;
  const reason=`実発売額×割引率${rate}％。10円未満切捨て、最低${minimum}円。${paid<minimum?'手数料の控除はこの内訳の発売額が上限です。':''}`;
  const formula=`${format(paid)} × ${rate}％ → ${format(roundedFee)}（10円未満切捨て）／最低${minimum}円\n${format(paid)} − ${format(fee)} ＝ ${format(refund)}`;
  return {type,label,paid,roundedFee,fee,refund,eligible:true,reason,source:'トクだ値（受取後の紙券）',formula};
 });
 const fee=rows.reduce((sum,row)=>sum+row.fee,0),refund=rows.reduce((sum,row)=>sum+row.refund,0);
 const reason=`受取後の紙のトクだ値：乗車券・特急券それぞれの実発売額に割引率${rate}％を掛け、10円未満を切り捨ててから合計。最低手数料は乗車券220円・特急券340円。`;
 const formula=rows.map(row=>`${row.label}：${row.formula}`).join('\n')+`\n手数料合計：${rows.map(row=>format(row.fee)).join(' ＋ ')} ＝ ${format(fee)}\n合計払戻額：${format(price)} − ${format(fee)} ＝ ${format(refund)}`;
 return {usage:'before',product:'tokudane',from,to,price,mode,path:calculator.route(from,to,vias),rows,refund,fee,eligible:true,tokudaneRate:rate,city:input.city,reason,formula,sourceUrl:tokudaneSource};
}
