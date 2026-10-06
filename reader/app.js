import {createReaderRefundCalculator} from './before-refund.js?v=7.1';
import {sapporoCityStations} from './city-zone.js?v=6.3';
import {createCancellationCalculator,supportsCancellation,suggestedVias} from './cancellation.js?v=7';
import {loadPhotoCanvas} from './photo-loader.js?v=6';
import {createLocalOcr} from './local-ocr.js?v=6';
import {assembleLines} from './ocr-lines.js?v=6';
import {createCalculator} from './calculator.js?v=6.3';
import {frameCrop,ticketBounds} from './image-processing.js?v=6';
import {parseTicket,mergeReadings} from './parser.js?v=7.1';
const $=id=>document.getElementById(id), yen=n=>`${n.toLocaleString('ja-JP')}円`;
let currentKind=null,stream=null, canvas=null, worker=null, busy=false, generation=0, detectedKind=null;
const data=await Promise.all(['segments','stations','ordinary_fares_main','ordinary_fares_local','discount_rules'].map(async n=>{
  const response=await fetch(`./data/${n}.json`); if(!response.ok) throw new Error('計算用データを読み込めません。再読み込みしてください。');return response.json();
})).catch(error=>{$('scanStatus').textContent=error.message;$('form').querySelector('button[type=submit]').disabled=true;return null;});
if(data) initialize();
function initialize(){
 $('camera').disabled=false;$('choose').disabled=false;
 const [segments,stations,main,local,discounts]=data, calculator=createCalculator(segments,stations,main,local,discounts);
 const cancelCalculator=createReaderRefundCalculator(calculator,stations);
 for(const id of ['actualFrom','actualTo'])for(const s of sapporoCityStations){const o=document.createElement('option');o.value=s;o.textContent=s;$(id).append(o);}
 stations.forEach(s=>{const option=document.createElement('option');option.value=s;$('stations').append(option);});
 discounts.discounts.forEach(r=>{const option=document.createElement('option');option.value=r.id;option.textContent=r.label;$('discount').append(option);});
 const clearResult=()=>{$('result').hidden=true;$('error').hidden=true;};
 function updateDiscount(){const r=discounts.discounts.find(r=>r.id===$('discount').value);$('companionBox').hidden=!r?.requiresCompanion;$('discountNote').textContent=r?`${r.label}${r.rate?`：${r.rate*100}％引` : ''}${r.minimumBusinessKmExclusive!==null?'／営業キロ100km超が条件':''}`:'';}
 function updateCityFields(){for(const end of ['From','To']){const on=$('city'+end).checked&&$('usage').value!=='before';$('actual'+end+'Label').hidden=!on;$('actual'+end).required=on;$('actual'+end).disabled=!on;}}
 for(const id of ['cityFrom','cityTo'])$(id).addEventListener('change',updateCityFields);
 function updateCancellationFields(){
  updateCityFields();
  const kind=currentKind||{kinds:['ordinary']},ordinary=kind.kinds.includes('ordinary'),accident=$('refundMode').value==='accident',multiple=kind.kinds.length>1,before=$('usage').value==='before',charge=kind.kinds.some(k=>k!=='ordinary'),seat=$('chargeSeat').value,timed=before&&!accident&&charge&&['reserved','standing'].includes(seat);
  $('stopSection').hidden=before;$('stop').required=!before;$('stop').disabled=before;$('startedLabel').hidden=before;$('started').required=!before;$('started').disabled=before;$('unusedLabel').hidden=true;$('unused').required=false;$('unused').disabled=true;$('validLabel').hidden=before;$('valid').required=!before;$('valid').disabled=before;$('confirmText').textContent=before?'未使用・有効期間内（前売りは開始前を含む）で、読取内容と選択した条件が券面・実際の状況に一致しています':'券種・発売額・経路・割引・料金内訳などの入力内容が券面と一致しています';
  $('beforeFields').hidden=!before||!charge||accident;$('chargeSeat').required=before&&charge&&!accident;$('chargeSeat').disabled=!before||!charge||accident;$('timingFields').hidden=!timed;$('seatSummary').textContent=seat?'座席区分：'+({reserved:'指定席',unreserved:'自由席',unassigned:'座席未指定券',standing:'立席特急券'})[seat]+'（修正）':'座席区分を選択してください';$('seatDetails').open=!seat;
  $('timingBand').required=timed;$('timingBand').disabled=!timed;$('tripCancelledLabel').hidden=!before;$('tripCancelled').required=before&&accident;$('tripCancelled').disabled=!before||!accident;
  $('calculationTicket').textContent=currentKind?`計算する券種：${currentKind.label}`:'普通片道乗車券として計算します。券種を確認してください。';
  $('discountFields').hidden=!ordinary||before;$('discount').required=ordinary&&!before;$('discount').disabled=!ordinary||before;$('passengerBox').hidden=!ordinary||before;$('passenger').required=ordinary&&!before;$('passenger').disabled=!ordinary||before;
  $('componentBox').hidden=!multiple;
  for(const [type,id] of [['ordinary','ordinary'],['limited_express','express'],['green','green']]){const present=kind.kinds.includes(type);$(id+'ComponentLabel').hidden=!present;$(id+'Component').required=multiple&&present;$(id+'Component').disabled=!multiple||!present;}
  $('accidentFields').hidden=!accident;$('purchasedBefore').required=accident;$('purchasedBefore').disabled=!accident;
  for(const [type,id] of [['limited_express','express'],['green','green']]){const present=accident&&kind.kinds.includes(type);$(id+'UnavailableLabel').hidden=!present;$(id+'Unavailable').required=present;$(id+'Unavailable').disabled=!present;}
 }
 for(const id of ['refundMode','usage','chargeSeat'])$(id).addEventListener('change',updateCancellationFields);
 function calculateCancellation(){
  if(!$('confirmed').checked)throw new Error('券面と入力内容が一致することを確認してください。');
  const kind=currentKind||{kinds:['ordinary'],label:'普通乗車券'};
  const components={};for(const [type,id] of [['ordinary','ordinary'],['limited_express','express'],['green','green']])if(kind.kinds.includes(type))components[type]=Number($(id+'Component').value);
  return cancelCalculator({kind,usage:$('usage').value,unused:$('usage').value==='before'&&$('confirmed').checked,tripCancelled:$('tripCancelled').checked,chargeSeat:$('chargeSeat').value,timingBand:$('timingBand').value,city:{from:$('cityFrom').checked,to:$('cityTo').checked},actualFrom:$('actualFrom').value,actualTo:$('actualTo').value,mode:$('refundMode').value,from:$('from').value.trim(),to:$('to').value.trim(),stop:$('stop').value.trim(),price:Number($('price').value),components,vias:$('via').value.split(/[,、]/).map(s=>s.trim()).filter(Boolean),discount:$('discount').value,passenger:$('passenger').value,companion:$('companion').checked,valid:$('usage').value==='before'?$('confirmed').checked:$('valid').checked,started:$('started').checked,purchasedBefore:$('purchasedBefore').checked,unavailable:{limited_express:$('expressUnavailable').value,green:$('greenUnavailable').value}});
 }
 updateCancellationFields();
 function autoCalculate(){if(busy||!$('confirmed').checked||!$('form').checkValidity())return;try{renderResult(calculateCancellation());$('result').scrollIntoView({behavior:'smooth',block:'start'});}catch(error){clearResult();$('error').textContent=error.message;$('error').hidden=false;}}
 $('form').addEventListener('change',autoCalculate);
 $('form').addEventListener('input',()=>{clearResult();$('confirmed').checked=false;});
 // 確認チェック自体の操作では解除しない。
 $('confirmed').addEventListener('input',event=>{event.stopPropagation();clearResult();});
 $('discount').addEventListener('change',()=>{$('companion').checked=false;updateDiscount();});
 $('choose').addEventListener('click',()=>{$('file').click();});
 $('file').addEventListener('change',async()=>{const file=$('file').files[0];if(!file||busy)return;const run=++generation;busy=true;resetTicket();removePhoto();toggleBusy(true);$('scanStatus').textContent='写真を端末内で開いています…';try{const image=await loadPhotoCanvas(file,message=>{if(run===generation)$('scanStatus').textContent=message;});if(run===generation)setPhoto(image);}catch(error){if(run===generation)$('scanStatus').textContent=error.message;}finally{$('file').value='';if(run===generation){busy=false;toggleBusy(false);if(canvas)$('recognize').click();}}});
 $('camera').addEventListener('click',async()=>{
  try{stopCamera();if(!navigator.mediaDevices?.getUserMedia)throw new Error('このブラウザではカメラを開けません。写真選択をご利用ください。');
   stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080}},audio:false});
   $('video').srcObject=stream;$('cameraDialog').showModal();updateOrientation();
  }catch(error){$('scanStatus').textContent=error.name==='NotAllowedError'?'カメラの使用が許可されませんでした。写真選択も利用できます。':error.message;stopCamera();}
 });
 $('closeCamera').addEventListener('click',()=>{$('cameraDialog').close();stopCamera();});
 $('cameraDialog').addEventListener('close',stopCamera);
 $('cameraDialog').addEventListener('cancel',stopCamera);
 function updateOrientation(){const portrait=matchMedia('(pointer:coarse)').matches&&innerHeight>innerWidth;$('capture').disabled=portrait;$('orientationHint').textContent=portrait?'画面の回転ロックを解除して、スマホを横に持ってください。横向きになると撮影できます。':'切符1枚を枠いっぱいに合わせてください。枠の中だけを読み取ります。';}
 window.addEventListener('resize',updateOrientation);
 $('capture').addEventListener('click',()=>{const video=$('video');if(!video.videoWidth)return;
  const stage=$('cameraStage').getBoundingClientRect(),frame=$('ticketFrame').getBoundingClientRect(),r=frameCrop(video.videoWidth,video.videoHeight,stage.width,stage.height,{x:frame.x-stage.x,y:frame.y-stage.y,w:frame.width,h:frame.height});
  const image=document.createElement('canvas');image.width=Math.round(r.w);image.height=Math.round(r.h);image.getContext('2d').drawImage(video,r.x,r.y,r.w,r.h,0,0,image.width,image.height);$('cameraDialog').close();stopCamera();setPhoto(image);
 });
 let selection=null,anchor=null;
 function drawCrop(){const view=$('cropCanvas'),ctx=view.getContext('2d');ctx.drawImage(canvas,0,0,view.width,view.height);if(selection){ctx.strokeStyle='#f00';ctx.lineWidth=3;ctx.strokeRect(selection.x,selection.y,selection.w,selection.h);}}
 $('crop').addEventListener('click',()=>{if(!canvas)return;const view=$('cropCanvas');view.width=Math.min(900,canvas.width);view.height=Math.round(canvas.height*view.width/canvas.width);const thumb=document.createElement('canvas');thumb.width=180;thumb.height=Math.round(canvas.height*180/canvas.width);const tctx=thumb.getContext('2d');tctx.drawImage(canvas,0,0,thumb.width,thumb.height);const box=ticketBounds(tctx.getImageData(0,0,thumb.width,thumb.height).data,thumb.width,thumb.height);selection=box?{x:box.x*view.width,y:box.y*view.height,w:box.w*view.width,h:box.h*view.height}:null;anchor=null;$('applyCrop').disabled=!selection;$('cropHint').textContent=box?'赤枠が切符全体に合っているか確認してください。指で範囲を変更できます。':'切り出す範囲を指定してください。';drawCrop();$('cropDialog').showModal();});
 const point=event=>{const view=$('cropCanvas'),r=view.getBoundingClientRect();return {x:Math.max(0,Math.min(view.width,(event.clientX-r.x)*view.width/r.width)),y:Math.max(0,Math.min(view.height,(event.clientY-r.y)*view.height/r.height))};};
 $('cropCanvas').addEventListener('pointerdown',event=>{anchor=point(event);$('cropCanvas').setPointerCapture(event.pointerId);});
 $('cropCanvas').addEventListener('pointermove',event=>{if(!anchor)return;const p=point(event);selection={x:Math.min(anchor.x,p.x),y:Math.min(anchor.y,p.y),w:Math.abs(anchor.x-p.x),h:Math.abs(anchor.y-p.y)};drawCrop();$('applyCrop').disabled=selection.w<80||selection.h<40;});
 $('cropCanvas').addEventListener('pointerup',()=>{anchor=null;});
 $('cropCanvas').addEventListener('pointercancel',()=>{anchor=null;});
 $('closeCrop').addEventListener('click',()=>{$('cropDialog').close();});
 $('applyCrop').addEventListener('click',()=>{if(!selection)return;const scale=canvas.width/$('cropCanvas').width,r=selection,image=document.createElement('canvas');image.width=Math.round(r.w*scale);image.height=Math.round(r.h*scale);image.getContext('2d').drawImage(canvas,r.x*scale,r.y*scale,r.w*scale,r.h*scale,0,0,image.width,image.height);$('cropDialog').close();setPhoto(image);});
 $('rotate').addEventListener('click',()=>{if(!canvas)return;const image=document.createElement('canvas');image.width=canvas.height;image.height=canvas.width;const ctx=image.getContext('2d');ctx.translate(image.width,0);ctx.rotate(Math.PI/2);ctx.drawImage(canvas,0,0);setPhoto(image);});
 $('remove').addEventListener('click',removePhoto);
 $('resetAll').addEventListener('click',()=>{cancelReading();removePhoto();$('form').reset();$('warnings').hidden=true;updateDiscount();updateCancellationFields();clearResult();});
 $('cancel').addEventListener('click',cancelReading);
 $('recognize').addEventListener('click',async()=>{
  if(!canvas||busy)return;busy=true;const run=++generation;toggleBusy(true);$('rawText').textContent='読み取り中…';$('ticketKind').hidden=true;$('warnings').hidden=true;$('confirmed').checked=false;clearResult();
  let jobWorker=null;
  try{
   jobWorker=worker||createLocalOcr();worker=jobWorker;$('scanStatus').textContent='端末内の新しい読取エンジンを準備しています。初回は約46MBのデータを取得します…';await jobWorker.ready;
   if(run!==generation)return;
   const prepared=document.createElement('canvas'),scale=Math.min(1,1600/Math.max(canvas.width,canvas.height));prepared.width=Math.round(canvas.width*scale);prepared.height=Math.round(canvas.height*scale);prepared.getContext('2d').drawImage(canvas,0,0,prepared.width,prepared.height);
   const readings=[],texts=[];
   for(let pass=0;pass<2;pass++){
    if(run!==generation)return;let image=prepared;
    if(pass){image=document.createElement('canvas');image.width=prepared.width;image.height=prepared.height;const ctx=image.getContext('2d');ctx.drawImage(prepared,0,0);const pixels=ctx.getImageData(0,0,image.width,image.height);for(let i=0;i<pixels.data.length;i+=4){const gray=pixels.data[i+2];const v=Math.max(0,Math.min(255,(gray-110)*2));pixels.data[i]=pixels.data[i+1]=pixels.data[i+2]=v;}ctx.putImageData(pixels,0,0);}
    $('progress').value=pass?60:20;$('scanStatus').textContent=pass?'文字の濃さを調整して再確認しています…':'文字の位置と向きを検出して読み取っています…';
    const read=await jobWorker.recognize(image);if(run!==generation)return;
    const text=assembleLines(read.items)+(read.moneyText?`\n${read.moneyText}`:'');texts.push(`${pass?'濃さ調整':'元の写真'}：\n${text}\n\n確度の低い文字を含む読取記録：\n${read.items.map(i=>`${Math.round(i.score*100)}％ ${i.text}`).join('\n')}`);const parsedPass=parseTicket(text,stations);readings.push(parsedPass);
    if(parsedPass.from&&parsedPass.to&&parsedPass.price&&parsedPass.ticketKind.id!=='unknown')break;
   }
   $('rawText').textContent=texts.join('\n\n');const parsed=mergeReadings(readings);const kind=parsed.ticketKind;$('confirmed').checked=false;detectedKind=kind;currentKind=kind.id==='unknown'?null:kind;$('formCard').hidden=false;const blocked=kind.id!=='unknown'&&!supportsCancellation(kind);$('form').hidden=blocked;$('reviewNotice').hidden=!blocked;const reviewReason=kind.id==='conflict'?'券種の読取結果が一致していません。切符だけを切り出して再度読み取ってください。':kind.restricted?'企画券・往復券・市内制度など、個別条件の確認が必要な券として判定しました。普通乗車券と同じ方法では自動計算できません。':'この券種は読取サイトの自動計算対象外です。券面の商品名と個別の払戻条件を確認してください。';$('reviewNotice').textContent=blocked?`読み取った内容：${kind.label}\n区間：${parsed.from&&parsed.to?`${parsed.from} → ${parsed.to}`:'未判別'}\n券面金額候補：${parsed.price?yen(parsed.price):'未判別'}\n${reviewReason}\n判定が券面と違う場合は、写真を切り出して再度読み取ってください。`:'';$('ticketKind').hidden=false;$('ticketKindLabel').textContent=kind.label;$('seatKind').textContent=({green:'グリーン車',reserved:'指定席',unreserved:'自由席',unknown:'座席区分は未判別'})[kind.seat];$('kindNote').textContent=kind.calculable?'普通乗車券の入力内容を券面と照合してください。':kind.id==='unknown'?'券種が読めませんでした。写真を切り出すか、券面で普通片道乗車券であることを確認してください。':supportsCancellation(kind)?'使用状態と払戻の理由を選び、払戻条件を確認してください。':'この券は読取サイトの自動計算対象外です。個別取扱いを確認してください。';$('ticketRoute').textContent=parsed.from&&parsed.to?`${parsed.from} → ${parsed.to}`:'区間：未判別';$('ticketBreakdown').textContent=parsed.fees?Object.entries(parsed.fees).map(([key,value])=>`${({ordinary:'乗車券運賃',limited_express:'特急料金',green:'グリーン料金'})[key]}：${yen(value)}`).join(' ／ '):'';$('ticketBreakdown').hidden=!parsed.fees; $('ticketAmount').textContent=parsed.price?`券面金額候補：${yen(parsed.price)}（運賃・料金の内訳は券面確認）`:'金額：未判別';
   $('from').value='';$('to').value='';$('price').value='';$('discount').value='';
   $('chargeSeat').value=parsed.chargeSeat||'';
   $('cityFrom').checked=Boolean(kind.city?.from);$('cityTo').checked=Boolean(kind.city?.to);$('actualFrom').value='';$('actualTo').value='';
   if(kind.id==='unknown'||supportsCancellation(kind)){$('from').value=parsed.from;$('to').value=parsed.to;$('price').value=parsed.price??'';$('passenger').value=parsed.passenger??'';$('discount').value=parsed.discount??'';$('via').value=suggestedVias(parsed.train,parsed.from,parsed.to,calculator).join('、');for(const [type,id] of [['ordinary','ordinary'],['limited_express','express'],['green','green']])$(id+'Component').value=parsed.fees?.[type]??'';}updateCancellationFields();
   $('ticketDetails').open=!parsed.from||!parsed.to||!parsed.price||(kind.kinds.length>1&&!parsed.fees)||($('usage').value==='after'&&kind.kinds.includes('ordinary')&&(!parsed.passenger||!parsed.discount));
   $('warnings').textContent=parsed.warnings.filter(w=>!supportsCancellation(kind)||!w.startsWith('普通片道乗車券以外')).join('\n');$('warnings').hidden=false;updateDiscount();
   $('scanStatus').textContent=blocked?'読み取り完了。「02 内容を確認する」に読取内容と自動計算対象外の理由を表示しています。':parsed.unsupported?`読み取り完了：${kind.label}。区間・合計額・内訳を下の読取結果で確認してください。使用状態と払戻の理由を選んでください。`:parsed.from&&parsed.to&&parsed.price?'読み取り完了。発着駅・金額を券面と照合してください。':'一部の項目を読み取れませんでした。切符だけを切り出して再試行するか、空欄を入力してください。';$('progress').value=100;
  }catch(error){if(run===generation){jobWorker?.terminate();worker=null;$('scanStatus').textContent='読み取りできませんでした。写真を撮り直すか手入力してください。';$('rawText').textContent=`読取エラー：${error.message||error.name}\n読み込みが止まる場合は写真のサイズを小さくして再試行してください。`;}}
  finally{if(run===generation){busy=false;toggleBusy(false);}}
 });
 $('form').addEventListener('submit',event=>{event.preventDefault();clearResult();try{
  const result=calculateCancellation();
  renderResult(result);$('result').focus();$('result').scrollIntoView({behavior:'smooth',block:'start'});
 }catch(error){$('error').textContent=error.message;$('error').hidden=false;}});
 function renderResult(r){
  $('refundTotal').textContent=yen(r.refund);$('resultTitle').textContent=r.eligible?(r.usage==='before'?'使用開始前の払戻額':'旅行中止の払戻額'):'一部の券が自動計算対象外';$('resultReason').textContent=r.reason;$('formula').textContent=r.formula;
  const metrics=r.usage==='before'?[['使用状態','使用開始前（未使用）'],['払戻の理由',r.mode==='normal'?'お客様都合（通常払戻）':'列車の運休（事故払戻）'],['元券区間',`${r.city?.from?'札幌市内':r.from} → ${r.city?.to?'札幌市内':r.to}`],['券面発売額（合計）',yen(r.price)],['払戻手数料（合計）',yen(r.fee)],...(r.mode==='normal'&&r.timingBand?[['払戻時期',({early:'現在の出発日の2日前まで（下記の変更券を除く）',late:'現在の出発日の前日・当日（出発時刻前）',changed:'変更前の列車の前日・当日に変更した指定券'})[r.timingBand]]]:[])]:[['中止理由',r.mode==='normal'?'お客様都合（通常払戻）':'列車の運休（事故払戻）'],['元券区間',`${r.from} → ${r.to}`],['旅行中止駅',r.stop],['券面発売額（合計）',yen(r.price)],['既乗区間',`${r.cityContext?.actualFrom||r.from} → ${r.stop}`],[r.cityContext?'既乗区間運賃の計算用営業キロ':'既乗区間営業キロ',`${r.usedInfo.business.toFixed(1)}km`],['未使用区間（計算基準）',`${r.stop} → ${r.cityContext&&r.mode==='normal'?r.cityContext.actualTo:r.to}`],['未使用区間営業キロ',`${r.unusedInfo.business.toFixed(1)}km`],['地方交通線換算キロ',`${(r.unusedInfo.localBusiness?r.unusedInfo.conversion:0).toFixed(1)}km`],['運賃計算キロ',`${r.unusedInfo.fareCalculationKm.toFixed(1)}km`],['払戻手数料（合計）',yen(r.fee)]];
  if(r.cityContext){const c=r.cityContext;metrics.push(['券面区間',`${c.city.from?'札幌市内':r.from} → ${c.city.to?'札幌市内':r.to}`],['実際の乗車駅',c.actualFrom],['下車予定駅',c.actualTo],['市内制度の中心駅','札幌'],['既乗区間運賃の計算基準',c.basis],['市内制度の根拠','第86条・第274条／事故払戻の市内着は第282条の2第1号ロ']);}
  const ordinary=r.rows.find(row=>row.type==='ordinary');if(ordinary?.ordinary){const o=ordinary.ordinary;metrics.push(['元券の割引種別',o.rule.label],['割引前既乗区間運賃',yen(o.usedFare)],['控除する既乗区間運賃（通常）',yen(o.deduction)],['既乗区間参照運賃表',o.usedInfo.business?o.usedInfo.label:'既乗区間なし'],['未使用区間参照運賃表',r.unusedInfo.business?r.unusedInfo.label:'未使用区間なし']);if(r.mode==='accident')metrics.push(['割引前未使用区間運賃',yen(ordinary.before)]);}
  $('metrics').replaceChildren(...metrics.map(([label,value])=>{const div=document.createElement('div'),dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=value;div.append(dt,dd);return div;}));
  $('componentResults').replaceChildren(...r.rows.map(row=>{const section=document.createElement('section'),h=document.createElement('h3'),p=document.createElement('p'),source=document.createElement('p');h.textContent=`${row.label}：${yen(row.refund)}`;p.textContent=`発売額 ${yen(row.paid)}／手数料 ${yen(row.fee)}\n${row.reason}`;source.textContent=`根拠：${row.source}`;section.append(h,p,source);return section;}));
  $('resultScope').textContent=r.usage==='before'?'使用開始前は未使用・有効期間等の条件確認が必要です。企画券・トクだ値は個別確認対象です。':'普通乗車券の通常払戻は未使用101km以上が対象です。料金券は使用開始後のお客様都合では払戻0円、運休では指定列車・設備を一部利用できなかった場合に当該料金全額。遅延だけの払戻はここでは計算しません。';
  $('routeDetail').replaceChildren(...r.path.map(s=>{const p=document.createElement('p');p.textContent=`${s.from} → ${s.to}：${s.line} ${s.business_km}km`;return p;}));$('result').hidden=false;
 }
 function resetTicket(){ currentKind=null;detectedKind=null;$('ticketKind').hidden=true; const usage=$('usage').value,mode=$('refundMode').value;$('form').reset();$('usage').value=usage;$('refundMode').value=mode;$('formCard').hidden=false;$('ticketDetails').open=true;$('form').hidden=false;$('reviewNotice').hidden=true;$('reviewNotice').textContent='';$('warnings').hidden=true;$('rawText').textContent='まだ読み取っていません。';updateDiscount();updateCancellationFields();clearResult(); }
 function setPhoto(image){canvas=image;resetTicket();$('photo').src=image.toDataURL('image/jpeg',.92);$('photo').hidden=false;$('emptyPreview').hidden=true;$('photoTools').hidden=false;$('recognize').disabled=false;$('scanStatus').textContent='切符が横向きで大きく写っているか確認してください。背景が多い場合は「切符だけを切り出す」を使ってから読み取ります。';if(!busy)$('recognize').click();}
 function removePhoto(){ resetTicket();detectedKind=null;$('ticketKind').hidden=true;canvas=null;$('photo').removeAttribute('src');$('photo').hidden=true;$('emptyPreview').hidden=false;$('photoTools').hidden=true;$('recognize').disabled=true;$('rawText').textContent='写真と読み取り文字を消去しました。';$('warnings').hidden=true;}
 function toggleBusy(on){$('form').querySelector('button[type=submit]').disabled=on;for(const id of ['camera','choose','rotate','crop','remove','resetAll'])$(id).disabled=on;$('recognize').disabled=on||!canvas;$('cancel').hidden=!on;$('progress').hidden=!on;}
 function cancelReading(){generation++;busy=false;if(worker){worker.terminate();worker=null;}toggleBusy(false);$('scanStatus').textContent='読み取りを中止しました。';}
}
function stopCamera(){if(stream){stream.getTracks().forEach(t=>t.stop());stream=null;}$('video').srcObject=null;}
window.addEventListener('pagehide',()=>{stopCamera();worker?.terminate();});
