import {createReaderRefundCalculator} from './before-refund.js?v=7.4.1';
import {sapporoCityStations} from './city-zone.js?v=6.3';
import {attachStationSuggestions} from './station-suggestions.js?v=7.4.1';
import {componentFields,componentTotal} from './review-amounts.js?v=7.4.1';
import {supportsCancellation,suggestedVias} from './cancellation.js?v=7.4.1';
import {loadPhotoCanvas} from './photo-loader.js?v=6';
import {createLocalOcr} from './local-ocr.js?v=6';
import {editableTicketKind} from './ticket-kind.js?v=7.4.1';
import {assembleLines} from './ocr-lines.js?v=7.4.1';
import {createCalculator} from './calculator.js?v=6.3';
import {frameCrop,ticketBounds,enhanceOcrPixels,stationBand,cleanPixels} from './image-processing.js?v=7.4.1';
import {parseTicket,mergeReadings,stationOnlyReading} from './parser.js?v=7.4.1';
const $=id=>document.getElementById(id), yen=n=>`${n.toLocaleString('ja-JP',{maximumFractionDigits:2})}円`;
let currentKind=null,stream=null,canvas=null,worker=null,busy=false,generation=0;
const data=await Promise.all(['segments','stations','ordinary_fares_main','ordinary_fares_local','discount_rules'].map(async n=>{
  const response=await fetch(`./data/${n}.json`); if(!response.ok) throw new Error('計算用データを読み込めません。再読み込みしてください。');return response.json();
})).catch(error=>{$('scanStatus').textContent=error.message;$('form').querySelector('button[type=submit]').disabled=true;return null;});
if(data) initialize();
function initialize(){
 currentKind=editableTicketKind($('ticketType').value);
 $('camera').disabled=false;$('choose').disabled=false;
 const [segments,stations,main,local,discounts]=data, calculator=createCalculator(segments,stations,main,local,discounts);
 const cancelCalculator=createReaderRefundCalculator(calculator,stations);
 for(const id of ['from','to','stop','via','actualFrom','actualTo'])attachStationSuggestions($(id),id.startsWith('actual')?sapporoCityStations:stations,{multiple:id==='via'});
 stations.forEach(s=>{const option=document.createElement('option');option.value=s;$('stations').append(option);});
 discounts.discounts.forEach(r=>{const option=document.createElement('option');option.value=r.id;option.textContent=r.label;option.defaultSelected=r.id==='none';option.selected=r.id==='none';$('discount').append(option);});
 const tokudaneOption=document.createElement('option');tokudaneOption.value='tokudane';tokudaneOption.textContent='トクだ値（割引率を入力）';$('discount').append(tokudaneOption);
 const clearResult=()=>{$('result').hidden=true;$('error').hidden=true;};
 function updateDiscount(){const r=discounts.discounts.find(r=>r.id===$('discount').value);$('companionBox').hidden=!r?.requiresCompanion;const note=currentKind?.product==='tokudane'?'トクだ値は下の専用の割引率を使います。':$('usage').value==='before'?'使用開始前の払戻は入力済みの実発売額を使います。割引の選択で発売額を再割引しません。':!currentKind?.kinds.includes('ordinary')?'この割引は乗車券運賃に適用します。':'乗車券の既乗区間・未使用区間の運賃計算に使います。';$('discountNote').textContent=$('discount').value==='tokudane'?note:(r?`${r.label}${r.rate?`：${r.rate*100}％引` : ''}${r.minimumBusinessKmExclusive!==null?'／営業キロ100km超が条件':''}。`:'券面を確認して選択してください。')+note;}
 function updateCityFields(){for(const end of ['From','To']){const on=$('city'+end).checked&&$('usage').value!=='before';$('actual'+end+'Label').hidden=false;$('actual'+end).required=on;$('actual'+end).disabled=false;}}
 for(const id of ['cityFrom','cityTo'])$(id).addEventListener('change',updateCityFields);
 function updateCancellationFields(){
  updateCityFields();
  const kind=currentKind||{kinds:['ordinary']},ordinary=kind.kinds.includes('ordinary'),accident=$('refundMode').value==='accident',tokudane=kind.product==='tokudane',multiple=kind.kinds.length>1&&!tokudane,before=$('usage').value==='before',charge=kind.kinds.some(k=>k!=='ordinary'),seat=$('chargeSeat').value,timed=before&&!accident&&charge&&!tokudane&&['reserved','standing'].includes(seat);
  $('stopSection').hidden=false;$('stop').required=!before&&!tokudane;$('stop').disabled=false;$('stopNote').textContent=before||tokudane?'使用開始後の旅行中止で使う駅です。今の計算条件では入力は任意です。':'元券の経路上から候補駅を選んでください。';$('startedLabel').hidden=before||tokudane;$('started').required=!before&&!tokudane;$('started').disabled=before||tokudane;$('unusedLabel').hidden=true;$('unused').required=false;$('unused').disabled=true;$('validLabel').hidden=before||tokudane;$('valid').required=!before&&!tokudane;$('valid').disabled=before||tokudane;$('confirmText').textContent=before?'未使用・有効期間内（前売りは開始前を含む）で、読取内容と選択した条件が券面・実際の状況に一致しています':'券種・発売額・経路・割引・料金内訳などの入力内容が券面と一致しています';
  $('beforeFields').hidden=!before||!charge||accident||tokudane;$('chargeSeat').required=before&&charge&&!accident&&!tokudane;$('chargeSeat').disabled=!before||!charge||accident||tokudane;$('timingFields').hidden=!timed;$('seatSummary').textContent=seat?'座席区分：'+({reserved:'指定席',unreserved:'自由席',unassigned:'座席未指定券',standing:'立席特急券'})[seat]+'（修正）':'座席区分を選択してください';$('seatDetails').open=!seat;
  $('timingBand').required=timed;$('timingBand').disabled=!timed;$('tripCancelledLabel').hidden=!before;$('tripCancelled').required=before&&accident;$('tripCancelled').disabled=!before||!accident;
  $('calculationTicket').textContent=currentKind?`計算する券種：${currentKind.label}`:'計算する券種・商品を券面で確認して選択してください。';
  $('discountFields').hidden=false;$('discount').required=true;$('discount').disabled=false;$('passengerBox').hidden=!ordinary||before||tokudane;$('passenger').required=ordinary&&!before&&!tokudane;$('passenger').disabled=!ordinary||before||tokudane;
  $('componentBox').hidden=false;const labels={ordinary:'乗車券運賃',limited_express:'特急料金',green:'グリーン料金'},applicable=currentKind?.kinds.map(k=>labels[k]).filter(Boolean)||[];$('componentNote').textContent=applicable.length?'計算する券種の内訳：'+applicable.join('・')+'。':'券種を選び、対応する料金を確認してください。';
  $('tokudaneFields').hidden=!tokudane;$('tokudaneScope').textContent=!before?'この商品の計算は使用開始前が対象です。未使用なら「使用状態」を使用開始前に変更してください。':accident?'トクだ値の運休払戻は個別条件を駅窓口で確認してください。通常手数料は適用しません。':'受取後の紙券・未使用・出発前の通常払戻を計算します。';for(const id of ['tokudanePaper','tokudaneRate']){$(id).disabled=!tokudane;$(id).required=tokudane&&before&&!accident;}const departure=tokudane&&before&&!accident;$('tokudaneDepartureLabel').hidden=!departure;$('tokudaneDeparture').disabled=!departure;$('tokudaneDeparture').required=departure;
  const blocked=currentKind&&!supportsCancellation(currentKind);$('reviewNotice').hidden=!blocked;$('reviewNotice').textContent=blocked?'この商品には個別条件の確認が必要です。読取内容は修正できます。判定が誤っている場合は「計算する券種・商品」を券面に合わせて修正してください。':'';
  for(const [type,id] of [['ordinary','ordinary'],['limited_express','express'],['green','green']]){const present=kind.kinds.includes(type);$(id+'ComponentLabel').hidden=false;$(id+'Component').required=multiple&&present;$(id+'Component').disabled=false;}
  updateDiscount();
  $('accidentFields').hidden=!accident;$('purchasedBefore').required=accident;$('purchasedBefore').disabled=!accident;
  for(const [type,id] of [['limited_express','express'],['green','green']]){const present=accident&&kind.kinds.includes(type);$(id+'UnavailableLabel').hidden=!present;$(id+'Unavailable').required=present;$(id+'Unavailable').disabled=!present;}
 }
 for(const id of ['refundMode','usage','chargeSeat'])$(id).addEventListener('change',updateCancellationFields);
 function syncComponentTotal(){const values=Object.fromEntries(componentFields.map(([type,id])=>[type,$(id+'Component').value]));const total=componentTotal(currentKind,values);if(total!==null)$('price').value=total;}
 for(const [type,id] of componentFields)$(id+'Component').addEventListener('input',()=>{if(currentKind?.kinds.includes(type))syncComponentTotal();});
 $('price').addEventListener('input',()=>{if(currentKind?.kinds.length===1){const field=componentFields.find(([type])=>type===currentKind.kinds[0]);if(field)$(field[1]+'Component').value=$('price').value;}});
 $('ticketType').addEventListener('change',()=>{currentKind=editableTicketKind($('ticketType').value);if(currentKind?.product==='tokudane')$('discount').value='tokudane';else if($('discount').value==='tokudane')$('discount').value='none';if(currentKind?.kinds.length===1){const field=componentFields.find(([type])=>type===currentKind.kinds[0]);if(field&&!$(field[1]+'Component').value)$(field[1]+'Component').value=$('price').value;}syncComponentTotal();$('confirmed').checked=false;clearResult();updateCancellationFields();});
 function calculateCancellation(){
  if(!$('ticketType').value||!currentKind)throw new Error('計算する券種・商品を券面で確認して選択してください。');
  if(!$('confirmed').checked)throw new Error('券面と入力内容が一致することを確認してください。');
  const kind=currentKind;
  if(kind.kinds.length===1){const field=componentFields.find(([type])=>type===kind.kinds[0]);if(field){const value=$(field[1]+'Component').value;if(value!==''&&Number(value)!==Number($('price').value))throw new Error('選択した券種の内訳と発売額を一致させてください。');}}
  const components={};for(const [type,id] of [['ordinary','ordinary'],['limited_express','express'],['green','green']])if(kind.kinds.includes(type))components[type]=Number($(id+'Component').value);
  return cancelCalculator({kind,tokudaneRate:$('tokudaneRate').value,tokudanePaper:$('tokudanePaper').checked,tokudaneDeparture:$('tokudaneDeparture').value,usage:$('usage').value,unused:$('usage').value==='before'&&$('confirmed').checked,tripCancelled:$('tripCancelled').checked,chargeSeat:$('chargeSeat').value,timingBand:$('timingBand').value,city:{from:$('cityFrom').checked,to:$('cityTo').checked},actualFrom:$('actualFrom').value,actualTo:$('actualTo').value,mode:$('refundMode').value,from:$('from').value.trim(),to:$('to').value.trim(),stop:$('stop').value.trim(),price:Number($('price').value),components,vias:$('via').value.split(/[,、]/).map(s=>s.trim()).filter(Boolean),discount:$('discount').value,passenger:$('passenger').value,companion:$('companion').checked,valid:$('usage').value==='before'?$('confirmed').checked:$('valid').checked,started:$('started').checked,purchasedBefore:$('purchasedBefore').checked,unavailable:{limited_express:$('expressUnavailable').value,green:$('greenUnavailable').value}});
 }
 updateCancellationFields();
 function autoCalculate(){if(busy||!$('confirmed').checked||!$('form').checkValidity())return;try{renderResult(calculateCancellation());$('result').scrollIntoView({behavior:'smooth',block:'start'});}catch(error){clearResult();$('error').textContent=error.message;$('error').hidden=false;}}
 $('form').addEventListener('change',autoCalculate);
 $('form').addEventListener('input',()=>{clearResult();$('confirmed').checked=false;});
 // 確認チェック自体の操作では解除しない。
 $('confirmed').addEventListener('input',event=>{event.stopPropagation();clearResult();});
 $('discount').addEventListener('change',()=>{$('companion').checked=false;if($('discount').value==='tokudane'){currentKind=editableTicketKind('tokudane');$('ticketType').value='tokudane';}else if(currentKind?.product==='tokudane'){currentKind=editableTicketKind('ordinary+limited_express');$('ticketType').value='ordinary+limited_express';}$('confirmed').checked=false;clearResult();updateCancellationFields();});
 $('choose').addEventListener('click',()=>{$('file').click();});
 $('file').addEventListener('change',async()=>{const file=$('file').files[0];if(!file||busy)return;const run=++generation;busy=true;resetTicket();removePhoto();toggleBusy(true);$('scanStatus').textContent='写真を端末内で開いています…';try{const image=await loadPhotoCanvas(file,message=>{if(run===generation)$('scanStatus').textContent=message;});if(run===generation)setPhoto(image);}catch(error){if(run===generation)$('scanStatus').textContent=error.message;}finally{$('file').value='';if(run===generation){busy=false;toggleBusy(false);if(canvas)$('recognize').click();}}});
 $('camera').addEventListener('click',async()=>{
  try{stopCamera();if(!navigator.mediaDevices?.getUserMedia)throw new Error('このブラウザではカメラを開けません。写真選択をご利用ください。');
   stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:2560},height:{ideal:1440}},audio:false});
   $('video').srcObject=stream;$('cameraDialog').showModal();updateOrientation();
  }catch(error){$('scanStatus').textContent=error.name==='NotAllowedError'?'カメラの使用が許可されませんでした。写真選択も利用できます。':error.message;stopCamera();}
 });
 $('closeCamera').addEventListener('click',()=>{$('cameraDialog').close();stopCamera();});
 $('cameraDialog').addEventListener('close',stopCamera);
 $('cameraDialog').addEventListener('cancel',stopCamera);
 function updateOrientation(){const portrait=matchMedia('(pointer:coarse)').matches&&innerHeight>innerWidth;$('capture').disabled=false;$('orientationHint').textContent=portrait?'画面の回転ロックを解除して、スマホを横に持ってください。縦向きでも撮影できます。きっぷ全体を枠に合わせてください。':'きっぷ1枚を枠いっぱいに合わせてください。枠の中だけを読み取ります。';}
 window.addEventListener('resize',updateOrientation);
 $('capture').addEventListener('click',()=>{const video=$('video');if(!video.videoWidth)return;
  const stage=$('cameraStage').getBoundingClientRect(),frame=$('ticketFrame').getBoundingClientRect(),r=frameCrop(video.videoWidth,video.videoHeight,stage.width,stage.height,{x:frame.x-stage.x,y:frame.y-stage.y,w:frame.width,h:frame.height});
  const image=document.createElement('canvas');image.width=Math.round(r.w);image.height=Math.round(r.h);image.getContext('2d').drawImage(video,r.x,r.y,r.w,r.h,0,0,image.width,image.height);$('cameraDialog').close();stopCamera();setPhoto(image);
 });
 let selection=null,anchor=null;
 function drawCrop(){const view=$('cropCanvas'),ctx=view.getContext('2d');ctx.drawImage(canvas,0,0,view.width,view.height);if(selection){ctx.strokeStyle='#f00';ctx.lineWidth=3;ctx.strokeRect(selection.x,selection.y,selection.w,selection.h);}}
 $('crop').addEventListener('click',()=>{if(!canvas)return;const view=$('cropCanvas');view.width=Math.min(900,canvas.width);view.height=Math.round(canvas.height*view.width/canvas.width);const thumb=document.createElement('canvas');thumb.width=180;thumb.height=Math.round(canvas.height*180/canvas.width);const tctx=thumb.getContext('2d');tctx.drawImage(canvas,0,0,thumb.width,thumb.height);const box=ticketBounds(tctx.getImageData(0,0,thumb.width,thumb.height).data,thumb.width,thumb.height);selection=box?{x:box.x*view.width,y:box.y*view.height,w:box.w*view.width,h:box.h*view.height}:null;anchor=null;$('applyCrop').disabled=!selection;$('cropHint').textContent=box?'赤枠がきっぷ全体に合っているか確認してください。指で範囲を変更できます。':'切り出す範囲を指定してください。';drawCrop();$('cropDialog').showModal();});
 const point=event=>{const view=$('cropCanvas'),r=view.getBoundingClientRect();return {x:Math.max(0,Math.min(view.width,(event.clientX-r.x)*view.width/r.width)),y:Math.max(0,Math.min(view.height,(event.clientY-r.y)*view.height/r.height))};};
 $('cropCanvas').addEventListener('pointerdown',event=>{anchor=point(event);$('cropCanvas').setPointerCapture(event.pointerId);});
 $('cropCanvas').addEventListener('pointermove',event=>{if(!anchor)return;const p=point(event);selection={x:Math.min(anchor.x,p.x),y:Math.min(anchor.y,p.y),w:Math.abs(anchor.x-p.x),h:Math.abs(anchor.y-p.y)};drawCrop();$('applyCrop').disabled=selection.w<80||selection.h<40;});
 $('cropCanvas').addEventListener('pointerup',()=>{anchor=null;});
 $('cropCanvas').addEventListener('pointercancel',()=>{anchor=null;});
 $('closeCrop').addEventListener('click',()=>{$('cropDialog').close();});
 $('applyCrop').addEventListener('click',()=>{if(!selection)return;const scale=canvas.width/$('cropCanvas').width,r=selection,image=document.createElement('canvas');image.width=Math.round(r.w*scale);image.height=Math.round(r.h*scale);image.getContext('2d').drawImage(canvas,r.x*scale,r.y*scale,r.w*scale,r.h*scale,0,0,image.width,image.height);$('cropDialog').close();setPhoto(image);});
 $('rotate').addEventListener('click',()=>{if(!canvas)return;const image=document.createElement('canvas');image.width=canvas.height;image.height=canvas.width;const ctx=image.getContext('2d');ctx.translate(image.width,0);ctx.rotate(Math.PI/2);ctx.drawImage(canvas,0,0);setPhoto(image);});
 $('remove').addEventListener('click',removePhoto);
 $('resetAll').addEventListener('click',()=>{cancelReading();removePhoto();$('form').reset();currentKind=editableTicketKind($('ticketType').value);$('warnings').hidden=true;updateDiscount();updateCancellationFields();clearResult();});
 $('cancel').addEventListener('click',cancelReading);
 $('recognize').addEventListener('click',async()=>{
  if(!canvas||busy)return;busy=true;const run=++generation;toggleBusy(true);$('rawText').textContent='読み取り中…';$('ticketKind').hidden=true;$('warnings').hidden=true;$('confirmed').checked=false;clearResult();
  let jobWorker=null;
  try{
   jobWorker=worker||createLocalOcr();worker=jobWorker;$('scanStatus').textContent='端末内の新しい読取エンジンを準備しています。初回は約46MBのデータを取得します…';await jobWorker.ready;
   if(run!==generation)return;
   const prepared=document.createElement('canvas'),scale=Math.min(2,2000/Math.max(canvas.width,canvas.height),Math.max(1,1400/Math.max(canvas.width,canvas.height)));prepared.width=Math.round(canvas.width*scale);prepared.height=Math.round(canvas.height*scale);prepared.getContext('2d').drawImage(canvas,0,0,prepared.width,prepared.height);
   const readings=[],texts=[],plainTexts=[];let routeItems=[];
   for(let pass=0;pass<3;pass++){
    if(run!==generation)return;if(pass===2){const merged=mergeReadings(readings);if(merged.from&&merged.to&&merged.price&&merged.ticketKind.id!=='unknown'&&(merged.ticketKind.product==='tokudane'?merged.ticketKind.rate!==null:merged.ticketKind.kinds.length===1||merged.fees))break;}let image=prepared;
    if(pass){image=document.createElement('canvas');image.width=prepared.width;image.height=prepared.height;const ctx=image.getContext('2d');ctx.drawImage(prepared,0,0);const pixels=ctx.getImageData(0,0,image.width,image.height);pixels.data.set(enhanceOcrPixels(pixels.data,pass===1?'blue':'gray'));ctx.putImageData(pixels,0,0);}
    $('progress').value=pass===2?85:pass?55:20;$('scanStatus').textContent=pass===2?'薄い文字を補正して追加確認しています…':pass?'文字の濃さを調整して再確認しています…':'文字の位置と向きを検出して読み取っています…';
    const read=await jobWorker.recognize(image);if(run!==generation)return;if(pass===0)routeItems=read.items;
    const text=assembleLines(read.items)+(read.moneyText?`\n${read.moneyText}`:'');plainTexts.push(text);texts.push(`${pass===2?'薄い文字の補正':pass?'濃さ調整':'元の写真'}：\n${text}\n\n確度の低い文字を含む読取記録：\n${read.items.map(i=>`${Math.round(i.score*100)}％ ${i.text}`).join('\n')}`);const parsedPass=parseTicket(text,stations);readings.push(parsedPass);
    // Always compare the original and contrast-adjusted readings.
   }
   const initial=mergeReadings(readings),band=(!initial.from||!initial.to)&&stationBand(routeItems,prepared.width,prepared.height);
   if(band)for(let pass=0;pass<2;pass++){
    if(run!==generation)return;$('scanStatus').textContent='大きく離れた駅名を部分読取で確認しています…';$('progress').value=92;
    const image=document.createElement('canvas'),compressed=pass===1?.65:1;image.width=Math.round(band.w*compressed)+80;image.height=band.h+80;const ctx=image.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,image.width,image.height);ctx.drawImage(prepared,band.x,band.y,band.w,band.h,40,40,image.width-80,band.h);
    if(pass){const pixels=ctx.getImageData(0,0,image.width,image.height);pixels.data.set(cleanPixels(pixels.data,image.width,image.height));ctx.putImageData(pixels,0,0);}
    const read=await jobWorker.recognize(image);if(run!==generation)return;const text=assembleLines(read.items);plainTexts.push(text);texts.push(`駅名の部分読取${pass?'（間隔・背景補正）':''}：\n${text}\n\n確度の低い文字を含む読取記録：\n${read.items.map(i=>`${Math.round(i.score*100)}％ ${i.text}`).join('\n')}`);readings.push(stationOnlyReading(parseTicket(text,stations)));const merged=mergeReadings(readings);if(merged.from&&merged.to)break;
   }
   $('rawText').textContent=texts.join('\n\n');const parsed=mergeReadings(readings);const ranked=readings.map((r,i)=>({i,score:Number(Boolean(r.from&&r.to))*2+Number(Boolean(r.price))*2+Number(Boolean(r.fees))*3+Number(r.ticketKind.id!=='unknown')+Number(r.ticketKind.product==='tokudane')*2})).sort((a,b)=>b.score-a.score);$('recognizedText').value=(plainTexts[ranked[0].i]||'')+(parsed.from&&parsed.to?`\n${parsed.from}${parsed.ticketKind.city.from?'（市内）':''} → ${parsed.to}${parsed.ticketKind.city.to?'（市内）':''}`:'');applyParsedTicket(parsed);$('progress').value=100;
  }catch(error){if(run===generation){jobWorker?.terminate();worker=null;$('scanStatus').textContent='読み取りできませんでした。写真を撮り直すか手入力してください。';$('rawText').textContent=`読取エラー：${error.message||error.name}\n読み込みが止まる場合は写真のサイズを小さくして再試行してください。`;}}
  finally{if(run===generation){busy=false;toggleBusy(false);}}
 });
 function applyParsedTicket(parsed){
  const kind=parsed.ticketKind;currentKind=kind.id==='unknown'?null:kind;
  const selectable=[...$('ticketType').options].some(o=>o.value===kind.id);
  $('ticketType').value=kind.restricted?'other':selectable?kind.id:'';
  $('formCard').hidden=false;$('form').hidden=false;$('confirmed').checked=false;clearResult();
  $('ticketKind').hidden=false;$('ticketKindLabel').textContent=kind.label;
  const seatLabel={green:'グリーン車',reserved:'指定席',unreserved:'自由席',unassigned:'座席未指定券',standing:'立席特急券',unknown:'座席区分は未判別'};
  $('seatKind').textContent=seatLabel[parsed.chargeSeat||kind.seat]||seatLabel.unknown;
  $('ticketRoute').textContent=parsed.from&&parsed.to?`${parsed.from} → ${parsed.to}`:'区間：未判別';
  $('ticketAmount').textContent=parsed.price?`券面金額候補：${yen(parsed.price)}${parsed.fees?'（内訳合計と一致）':''}`:'金額：未判別';
  const feeLabels={ordinary:'乗車券運賃',limited_express:'特急料金',green:'グリーン料金'};
  $('ticketBreakdown').textContent=parsed.fees?[...Object.entries(parsed.fees).map(([key,value])=>`${feeLabels[key]} ${yen(value)}`),`合計 ${yen(parsed.price)}`].join('／'):'';$('ticketBreakdown').hidden=!parsed.fees;
  $('ticketProduct').hidden=kind.product!=='tokudane';$('ticketProduct').textContent=kind.product==='tokudane'?`商品：トクだ値／割引率：${kind.rate!==null?kind.rate+'％':'確認して入力'}`:'';
  $('kindNote').textContent=kind.restricted?'商品固有の条件確認が必要です。読み取った内容は下の入力欄で修正できます。':kind.id==='unknown'?'券種が読めませんでした。下の「計算する券種・商品」を券面に合わせて選択してください。':'読み取った内容を下の入力欄に反映しました。券面と照合し、使用状態と払戻の理由を選んでください。';
  for(const id of ['from','to'])$(id).value=parsed[id];$('price').value=parsed.price??'';
  $('chargeSeat').value=parsed.chargeSeat||(['reserved','unreserved','standing','unassigned'].includes(kind.seat)?kind.seat:'');
  $('cityFrom').checked=Boolean(kind.city?.from);$('cityTo').checked=Boolean(kind.city?.to);$('actualFrom').value='';$('actualTo').value='';
  $('passenger').value=parsed.passenger??'adult';$('discount').value=kind.product==='tokudane'?'tokudane':parsed.discountNeedsReview?'':parsed.discount??'none';$('companion').checked=false;
  $('via').value=suggestedVias(parsed.train,parsed.from,parsed.to,calculator).join('、');
  for(const [type,id] of [['ordinary','ordinary'],['limited_express','express'],['green','green']])$(id+'Component').value=parsed.fees?.[type]??'';
  if(kind.kinds.length===1&&parsed.price&&!parsed.fees){const field=componentFields.find(([type])=>type===kind.kinds[0]);if(field)$(field[1]+'Component').value=parsed.price;}
  $('tokudaneRate').value=kind.product==='tokudane'?kind.rate??'':'';
  // Reading a ticket never proves its receipt, use state or departure deadline.
  for(const id of ['tokudanePaper','started','valid','purchasedBefore','tripCancelled'])$(id).checked=false;
  for(const id of ['tokudaneDeparture','timingBand','expressUnavailable','greenUnavailable'])$(id).value='';
  updateCancellationFields();updateDiscount();
  $('warnings').textContent=parsed.warnings.filter(w=>!supportsCancellation(kind)||!w.startsWith('普通片道乗車券以外')).join('\n');$('warnings').hidden=!$('warnings').textContent;
  $('scanStatus').textContent='読み取り完了。下の入力欄へ反映しました。券種・商品、金額、割引率を確認・修正してください。';
 }
 $('applyText').addEventListener('click',()=>{if(busy)return;const text=$('recognizedText').value.trim();if(!text){$('scanStatus').textContent='券面の文字を入力してください。';return;}applyParsedTicket(parseTicket(text,stations));});
 $('form').addEventListener('submit',event=>{event.preventDefault();clearResult();try{
  const result=calculateCancellation();
  renderResult(result);$('result').focus();$('result').scrollIntoView({behavior:'smooth',block:'start'});
 }catch(error){$('error').textContent=error.message;$('error').hidden=false;}});
 function renderResult(r){
  $('refundTotal').textContent=yen(r.refund);$('resultTitle').textContent=r.estimate?'トクだ値の払戻参考額（端数処理前）':r.eligible?(r.usage==='before'?'使用開始前の払戻額':'旅行中止の払戻額'):'一部の券が自動計算対象外';$('resultReason').textContent=r.reason;$('formula').textContent=r.formula;
  const metrics=r.usage==='before'?[['使用状態','使用開始前（未使用）'],['払戻の理由',r.mode==='normal'?'お客様都合（通常払戻）':'列車の運休（事故払戻）'],['元券区間',`${r.city?.from?'札幌市内':r.from} → ${r.city?.to?'札幌市内':r.to}`],['券面発売額（合計）',yen(r.price)],['払戻手数料（合計）',yen(r.fee)],...(r.mode==='normal'&&r.timingBand?[['払戻時期',({early:'出発日の2日前まで（出発日・前日の変更なし）',late:'出発日の前日・当日（出発時刻前）',changed:'変更済みきっぷ（出発時刻前）'})[r.timingBand]]]:[])]:[['中止理由',r.mode==='normal'?'お客様都合（通常払戻）':'列車の運休（事故払戻）'],['元券区間',`${r.from} → ${r.to}`],['旅行中止駅',r.stop],['券面発売額（合計）',yen(r.price)],['既乗区間',`${r.cityContext?.actualFrom||r.from} → ${r.stop}`],[r.cityContext?'既乗区間運賃の計算用営業キロ':'既乗区間営業キロ',`${r.usedInfo.business.toFixed(1)}km`],['未使用区間（計算基準）',`${r.stop} → ${r.cityContext&&r.mode==='normal'?r.cityContext.actualTo:r.to}`],['未使用区間営業キロ',`${r.unusedInfo.business.toFixed(1)}km`],['地方交通線換算キロ',`${(r.unusedInfo.localBusiness?r.unusedInfo.conversion:0).toFixed(1)}km`],['運賃計算キロ',`${r.unusedInfo.fareCalculationKm.toFixed(1)}km`],['払戻手数料（合計）',yen(r.fee)]];
  if(r.product==='tokudane')metrics.push(['商品','トクだ値（受取後の紙券・1席分）'],['割引率',r.tokudaneRate+'％'],['払戻の申出','指定列車の出発時刻前・窓口営業時間内']);
  if(r.cityContext){const c=r.cityContext;metrics.push(['券面区間',`${c.city.from?'札幌市内':r.from} → ${c.city.to?'札幌市内':r.to}`],['実際の乗車駅',c.actualFrom],['下車予定駅',c.actualTo],['市内制度の中心駅','札幌'],['既乗区間運賃の計算基準',c.basis],['市内制度の根拠','第86条・第274条／事故払戻の市内着は第282条の2第1号ロ']);}
  const ordinary=r.rows.find(row=>row.type==='ordinary');if(ordinary?.ordinary){const o=ordinary.ordinary;metrics.push(['元券の割引種別',o.rule.label],['割引前既乗区間運賃',yen(o.usedFare)],['控除する既乗区間運賃（通常）',yen(o.deduction)],['既乗区間参照運賃表',o.usedInfo.business?o.usedInfo.label:'既乗区間なし'],['未使用区間参照運賃表',r.unusedInfo.business?r.unusedInfo.label:'未使用区間なし']);if(r.mode==='accident')metrics.push(['割引前未使用区間運賃',yen(ordinary.before)]);}
  $('metrics').replaceChildren(...metrics.map(([label,value])=>{const div=document.createElement('div'),dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=value;div.append(dt,dd);return div;}));
  $('componentResults').replaceChildren(...r.rows.map(row=>{const section=document.createElement('section'),h=document.createElement('h3'),p=document.createElement('p'),source=document.createElement('p');h.textContent=`${row.label}：${yen(row.refund)}`;p.textContent=`発売額 ${yen(row.paid)}／手数料 ${yen(row.fee)}\n${row.reason}`;source.textContent=`根拠：${row.source}`;section.append(h,p,source);return section;}));
  const source=$('resultSource');source.href=r.sourceUrl||'https://www.jrhokkaido.co.jp/network/guide/pdf/yakkan_02_07.pdf';source.textContent=r.product==='tokudane'?'えきねっと公式（トクだ値の払戻条件）':'JR北海道 旅客営業規則（払戻条件）';
  $('resultScope').textContent=r.product==='tokudane'?'紙のトクだ値の受取後・未使用・出発前の通常払戻。駅窓口での取扱いです。端数がある場合は窓口で手数料を確認してください。':r.usage==='before'?'使用開始前は未使用・有効期間等の条件確認が必要です。他の企画商品は個別確認対象です。':'普通乗車券の通常払戻は未使用101km以上が対象です。料金券は使用開始後のお客様都合では払戻0円、運休では指定列車・設備を一部利用できなかった場合に当該料金全額。遅延だけの払戻はここでは計算しません。';
  $('routeDetail').replaceChildren(...r.path.map(s=>{const p=document.createElement('p');p.textContent=`${s.from} → ${s.to}：${s.line} ${s.business_km}km`;return p;}));$('result').hidden=false;
 }
 function resetTicket(){ currentKind=null;$('ticketKind').hidden=true; const usage=$('usage').value,mode=$('refundMode').value;$('form').reset();currentKind=editableTicketKind($('ticketType').value);$('recognizedText').value='';$('usage').value=usage;$('refundMode').value=mode;$('formCard').hidden=false;$('form').hidden=false;$('reviewNotice').hidden=true;$('reviewNotice').textContent='';$('warnings').hidden=true;$('rawText').textContent='まだ読み取っていません。';updateDiscount();updateCancellationFields();clearResult(); }
 function setPhoto(image){canvas=image;resetTicket();$('photo').src=image.toDataURL('image/jpeg',.92);$('photo').hidden=false;$('emptyPreview').hidden=true;$('photoTools').hidden=false;$('recognize').disabled=false;$('scanStatus').textContent='きっぷが横向きで大きく写っているか確認してください。背景が多い場合は「きっぷだけを切り出す」を使ってから読み取ります。';if(!busy)$('recognize').click();}
 function removePhoto(){ resetTicket();$('ticketKind').hidden=true;canvas=null;$('photo').removeAttribute('src');$('photo').hidden=true;$('emptyPreview').hidden=false;$('photoTools').hidden=true;$('recognize').disabled=true;$('rawText').textContent='写真と読み取り文字を消去しました。';$('warnings').hidden=true;}
 function toggleBusy(on){$('form').querySelector('button[type=submit]').disabled=on;for(const id of ['camera','choose','rotate','crop','remove','resetAll','applyText'])$(id).disabled=on;$('recognize').disabled=on||!canvas;$('cancel').hidden=!on;$('progress').hidden=!on;}
 function cancelReading(){generation++;busy=false;if(worker){worker.terminate();worker=null;}toggleBusy(false);$('scanStatus').textContent='読み取りを中止しました。';}
}
function stopCamera(){if(stream){stream.getTracks().forEach(t=>t.stop());stream=null;}$('video').srcObject=null;}
window.addEventListener('pagehide',()=>{stopCamera();worker?.terminate();});
