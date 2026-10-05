import {PaddleOCR} from '@paddleocr/paddleocr-js';
import {recognize} from './recognize.js';
import cvModule from '@techstark/opencv-js';
const localFetch=self.fetch.bind(self);self.fetch=(input,init)=>{const url=new URL(typeof input==='string'?input:(input.url||String(input)),self.location.href);if(url.origin!==self.location.origin)return Promise.reject(new Error('外部への通信は行いません。'));return localFetch(input,init);};
let engine=null;
self.onmessage=async({data})=>{
 try{
  if(data.type==='initialize'){
   engine=await PaddleOCR.create({textDetectionModelName:'PP-OCRv6_tiny_det',textRecognitionModelName:'PP-OCRv6_small_rec',textDetectionModelAsset:{url:data.base+'det.tar'},textRecognitionModelAsset:{url:data.base+'rec.tar'},textRecognitionBatchSize:1,ortOptions:{backend:'wasm',wasmPaths:data.base,numThreads:1,proxy:false}});
   self.postMessage({type:'ready'});return;
  }
  if(data.type==='recognize'){
   const mat=cvModule.matFromImageData({data:new Uint8ClampedArray(data.pixels),width:data.width,height:data.height});
   try{const result=await recognize(engine,mat,data.width,data.height);
    self.postMessage({type:'result',result});}finally{mat.delete();}
  }
 }catch(error){self.postMessage({type:'error',message:error.message||String(error)});}
};
