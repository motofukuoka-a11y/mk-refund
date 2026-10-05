import {loadPhotoCanvas} from './photo-loader.js?v=5';
import {createLocalOcr} from './local-ocr.js?v=5';
import {assembleLines} from './ocr-lines.js?v=5';
import {createCalculator} from './calculator.js';
import {frameCrop,ticketBounds} from './image-processing.js?v=5';
import {parseTicket,mergeReadings} from './parser.js?v=5';
const $=id=>document.getElementById(id), yen=n=>`${n.toLocaleString('ja-JP')}円`;
let stream=null, canvas=null, worker=null, busy=false, generation=0, detectedKind=null;
const data=await Promise.all(['segments','stations','ordinary_fares_main','ordinary_fares_local','discount_rules'].map(async n=>{
  const response=await fetch(`./data/${n}.json`); if(!response.ok) throw new Error('計算用データを読み込めません。再読み込みしてください。');return response.json();
})).catch(error=>{$('scanStatus').textContent=error.message;$('form').querySelector('button[type=submit]').disabled=true;return null;});
if(data) initialize();
function initialize(){
 const [segments,stations,main,local,discounts]=data, calculator=createCalculator(segments,stations,main,local,discounts);
 stations.forEach(s=>{const option=document.createElement('option');option.value=s;$('stations').append(option);});
 discounts.discounts.forEach(r=>{const option=document.createElement('option');option.value=r.id;option.textContent=r.label;$('discount').append(option);});
 const clearResult=()=>{$('result').hidden=true;$('error').hidden=true;};
 function updateDiscount(){const r=discounts.discounts.find(r=>r.id===$('discount').value);$('companionBox').hidden=!r?.requiresCompanion;$('discountNote').textContent=r?`${r.label}${r.rate?`：${r.rate*100}％引` : ''}${r.minimumBusinessKmExclusive!==null?'／営業キロ100km超が条件':''}`:'';}
 $('form').addEventListener('input',()=>{clearResult();$('confirmed').checked=false;});
 // 確認チェック自体の操作では解除しない。
 $('confirmed').addEventListener('input',event=>event.stopPropagation());
 $('discount').addEventListener('change',()=>{$('companion').checked=false;updateDiscount();});
 $('choose').addEventListener('click',()=>{$('file').click();});
 $('file').addEventListener('change',async()=>{const file=$('file').files[0];if(!file||busy)return;const run=++generation;busy=true;resetTicket();removePhoto();toggleBusy(true);$('scanStatus').textContent='写真を端末内で開いています…';try{const image=await loadPhotoCanvas(file,message=>{if(run===generation)$('scanStatus').textContent=message;});if(run===generation)setPhoto(image);}catch(error){if(run===generation)$('scanStatus').textContent=error.message;}finally{$('file').value='';if(run===generation){busy=false;toggleBusy(false);}}});
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
 $('resetAll').addEventListener('click',()=>{cancelReading();removePhoto();$('form').reset();$('warnings').hidden=true;updateDiscount();clearResult();});
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
   $('rawText').textContent=texts.join('\n\n');const parsed=mergeReadings(readings);const kind=parsed.ticketKind;detectedKind=kind;$('formCard').hidden=parsed.unsupported;$('ticketKind').hidden=false;$('ticketKindLabel').textContent=kind.label;$('seatKind').textContent=({green:'グリーン車',reserved:'指定席',unreserved:'自由席',unknown:'座席区分は未判別'})[kind.seat];$('kindNote').textContent=kind.calculable?'普通乗車券の入力内容を券面と照合してください。':kind.id==='unknown'?'券種が読めませんでした。写真を切り出すか、券面で普通片道乗車券であることを確認してください。':'券種を読み取りました。この券の料金は普通乗車券の旅行中止計算には使いません。払戻計算は既存のMK払戻サイトで券種を選んで行ってください。';$('ticketRoute').textContent=parsed.from&&parsed.to?`${parsed.from} → ${parsed.to}`:'区間：未判別';$('ticketBreakdown').textContent=parsed.fees?Object.entries(parsed.fees).map(([key,value])=>`${({ordinary:'乗車券運賃',limited_express:'特急料金',green:'グリーン料金'})[key]}：${yen(value)}`).join(' ／ '):'';$('ticketBreakdown').hidden=!parsed.fees; $('ticketAmount').textContent=parsed.price?`券面金額候補：${yen(parsed.price)}（運賃・料金の内訳は券面確認）`:'金額：未判別';
   $('from').value='';$('to').value='';$('price').value='';$('discount').value='';
   if(!parsed.unsupported){$('from').value=parsed.from;$('to').value=parsed.to;$('price').value=parsed.price??'';$('passenger').value=parsed.passenger??'';$('discount').value=parsed.discount??'';}
   $('warnings').textContent=parsed.warnings.join('\n');$('warnings').hidden=false;updateDiscount();
   $('scanStatus').textContent=parsed.unsupported?`読み取り完了：${kind.label}。区間・合計額・内訳を下の読取結果で確認してください。払戻計算はMK払戻サイトをご利用ください。`:parsed.from&&parsed.to&&parsed.price?'読み取り完了。発着駅・金額を券面と照合してください。':'一部の項目を読み取れませんでした。切符だけを切り出して再試行するか、空欄を入力してください。';$('progress').value=100;
  }catch(error){if(run===generation){jobWorker?.terminate();worker=null;$('scanStatus').textContent='読み取りできませんでした。写真を撮り直すか手入力してください。';$('rawText').textContent=`読取エラー：${error.message||error.name}\n読み込みが止まる場合は写真のサイズを小さくして再試行してください。`;}}
  finally{if(run===generation){busy=false;toggleBusy(false);}}
 });
 $('form').addEventListener('submit',event=>{event.preventDefault();clearResult();try{
  if(detectedKind&&detectedKind.id!=='unknown'&&!detectedKind.calculable)throw new Error('読み取った券は普通片道乗車券の旅行中止計算に使えません。MK払戻サイトで券種を選んでください。');
  if(!$('confirmed').checked)throw new Error('券面と入力内容が一致することを確認してください。');
  const result=calculator.calculate({from:$('from').value.trim(),to:$('to').value.trim(),stop:$('stop').value.trim(),price:Number($('price').value),vias:$('via').value.split(/[,、]/).map(s=>s.trim()).filter(Boolean),discount:$('discount').value,passenger:$('passenger').value,companion:$('companion').checked,valid:$('valid').checked});
  renderResult(result);
 }catch(error){$('error').textContent=error.message;$('error').hidden=false;}});
 function renderResult(r){
  $('refundTotal').textContent=yen(r.refund);$('resultTitle').textContent=r.eligible?'旅行中止の払戻額':'自動計算対象外';$('resultReason').textContent=r.reason;
  $('formula').textContent=r.eligible?`${yen(r.price)} − ${yen(r.deduction)} − 220円 ＝ ${yen(r.refund)}${r.price-r.deduction-220<0?'（残額なし）':''}`:'未使用区間が101km未満のため、手数料を控除しません。';
  const metrics=[['元券区間',`${r.from} → ${r.to}`],['旅行中止駅',r.stop],['元券発売額',yen(r.price)],['元券の割引種別',r.rule.label],['既乗区間',`${r.from} → ${r.stop}`],['既乗区間営業キロ',`${r.usedInfo.business.toFixed(1)}km`],['割引前既乗区間運賃',yen(r.usedFare)],['既乗区間の割引',r.usedDiscount?r.rule.label:'割引なし'],['控除する既乗区間運賃',yen(r.deduction)],['手数料控除前残額',yen(Math.max(0,r.price-r.deduction))],['未使用区間',`${r.stop} → ${r.to}`],['未使用区間営業キロ',`${r.unusedInfo.business.toFixed(1)}km`],['未使用区間・地方交通線換算キロ',`${(r.unusedInfo.localBusiness?r.unusedInfo.conversion:0).toFixed(1)}km`],['未使用区間・運賃計算キロ',`${r.unusedInfo.fareCalculationKm.toFixed(1)}km`],['既乗区間参照運賃表',r.usedInfo.business?r.usedInfo.label:'既乗区間なし'],['払戻手数料',yen(r.fee)]];
  $('metrics').replaceChildren(...metrics.map(([label,value])=>{const div=document.createElement('div'),dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=value;div.append(dt,dd);return div;}));
  $('routeDetail').replaceChildren(...r.path.map(s=>{const p=document.createElement('p');p.textContent=`${s.from} → ${s.to}：${s.line} ${s.business_km}km`;return p;}));$('result').hidden=false;$('result').focus();$('result').scrollIntoView({behavior:'smooth',block:'start'});
 }
 function resetTicket(){ detectedKind=null;$('ticketKind').hidden=true; $('form').reset();$('formCard').hidden=false;$('warnings').hidden=true;$('rawText').textContent='まだ読み取っていません。';updateDiscount();clearResult(); }
 function setPhoto(image){canvas=image;resetTicket();$('photo').src=image.toDataURL('image/jpeg',.92);$('photo').hidden=false;$('emptyPreview').hidden=true;$('photoTools').hidden=false;$('recognize').disabled=false;$('scanStatus').textContent='切符が横向きで大きく写っているか確認してください。背景が多い場合は「切符だけを切り出す」を使ってから読み取ります。';}
 function removePhoto(){ resetTicket();detectedKind=null;$('ticketKind').hidden=true;canvas=null;$('photo').removeAttribute('src');$('photo').hidden=true;$('emptyPreview').hidden=false;$('photoTools').hidden=true;$('recognize').disabled=true;$('rawText').textContent='写真と読み取り文字を消去しました。';$('warnings').hidden=true;}
 function toggleBusy(on){for(const id of ['camera','choose','rotate','crop','remove','resetAll'])$(id).disabled=on;$('recognize').disabled=on||!canvas;$('cancel').hidden=!on;$('progress').hidden=!on;}
 function cancelReading(){generation++;busy=false;if(worker){worker.terminate();worker=null;}toggleBusy(false);$('scanStatus').textContent='読み取りを中止しました。';}
}
function stopCamera(){if(stream){stream.getTracks().forEach(t=>t.stop());stream=null;}$('video').srcObject=null;}
window.addEventListener('pagehide',()=>{stopCamera();worker?.terminate();});
