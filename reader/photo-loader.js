// Native decoding first; the HEIC fallback is imported only when required.
export async function isHeicPhoto(file){
 const bytes=new Uint8Array(await file.slice(0,32).arrayBuffer());
 const text=String.fromCharCode(...bytes);
 return text.slice(4,8)==='ftyp'&&/heic|heix|hevc|hevx|mif1|msf1/.test(text.slice(8));
}
export async function loadPhotoCanvas(file,notify=()=>{}){
 if(file.size>25*1024*1024)throw new Error('写真が大きすぎます。25MB以下の画像を選択してください。');
 let bitmap=null,url=null;
 try{
  url=URL.createObjectURL(file);const img=new Image();img.src=url;
  try{await img.decode();bitmap=img;}catch(error){
   if(!await isHeicPhoto(file))throw new Error('この写真を開けません。JPEG・PNGの写真かカメラ撮影をお試しください。');
   notify('iPhoneのHEIC写真を端末内で開いています。外部へ送信しません…');
   const {heicTo}=await import('./vendor/heic-v1/heic-to.js');
   try{bitmap=await heicTo({blob:file,type:'bitmap'});}catch(error){throw new Error('HEIC写真を開けませんでした。JPEGの写真かカメラ撮影をお試しください。');}
  }
  const width=bitmap.naturalWidth||bitmap.width,height=bitmap.naturalHeight||bitmap.height;
  if(!width||!height)throw new Error('写真のサイズを確認できません。');
  const canvas=document.createElement('canvas'),scale=Math.min(1,2200/Math.max(width,height));canvas.width=Math.round(width*scale);canvas.height=Math.round(height*scale);canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);return canvas;
 }finally{if(url)URL.revokeObjectURL(url);bitmap?.close?.();}
}
