export function createLocalOcr(){
 const native=new Worker(new URL('./vendor/paddle-v4/worker.js',import.meta.url),{type:'module'});
 let pending=null,readyResolve,readyReject,closed=false;
 const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
 native.onmessage=({data})=>{if(data.type==='ready')readyResolve();if(data.type==='result'&&pending){pending.resolve(data.result);pending=null;}if(data.type==='error'){const error=new Error(data.message);readyReject(error);pending?.reject(error);pending=null;}};
 native.onerror=event=>{const error=new Error(event.message||'読取エンジンを開始できません。');readyReject(error);pending?.reject(error);pending=null;};
 native.postMessage({type:'initialize',base:new URL('./vendor/paddle-v4/',import.meta.url).href});
 return {ready,async recognize(image){await ready;if(closed)throw new Error('読み取りを中止しました。');if(pending)throw new Error('読み取り中です。');const pixels=image.getContext('2d').getImageData(0,0,image.width,image.height).data;return new Promise((resolve,reject)=>{pending={resolve,reject};native.postMessage({type:'recognize',width:image.width,height:image.height,pixels:pixels.buffer},[pixels.buffer]);});},terminate(){closed=true;native.terminate();const error=new Error('読み取りを中止しました。');readyReject(error);pending?.reject(error);pending=null;}};
}
