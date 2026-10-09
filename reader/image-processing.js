// Pure pixel helpers shared by browser capture and the sample benchmark.
import {assembleRows} from './ocr-lines.js?v=7.5.0';
// Large, widely spaced station characters can be missed by a whole-ticket
// detector. Locate their band above an actual travel date, never an issue date.
export function stationBand(items,width,height){
 const date=assembleRows(items).find(item=>item.score>=.85&&/\d+月\d+日|\d{1,2}:\d{2}発/.test(item.text.normalize('NFKC').replace(/\s/g,''))&&!/発券|発行/.test(item.text));
 if(!date)return null;
 const ys=date.poly.map(p=>p[1]),top=Math.min(...ys),h=Math.max(...ys)-top;
 if(h<10||top<height*.15||top>height*.7)return null;
 const y=Math.max(0,Math.floor(top-h*2.8)),bottom=Math.min(height,Math.ceil(top+h*.08));
 return {x:0,y,w:width,h:bottom-y};
}
// Inspect a damaged title at its native scale instead of inferring the ticket
// type from the train, fare or seat number. Do not crop instruction text.
export function titleBand(items,width,height){
 const title=items.find(item=>item.score>=.72&&/^(?:[CＣ]制)?(?:特|乗車券|グリーン券)/.test(item.text.normalize('NFKC').replace(/\s/g,''))&&!/有効|変更|必要|別途|ください|\d/.test(item.text)&&item.poly?.length===4&&Math.min(...item.poly.map(p=>p[1]))<height*.5);
 if(!title)return null;
 const xs=title.poly.map(p=>p[0]),ys=title.poly.map(p=>p[1]),h=Math.max(...ys)-Math.min(...ys);
 const x=Math.max(0,Math.floor(Math.min(...xs)-h)),y=Math.max(0,Math.floor(Math.min(...ys)-h*.45));
 const right=Math.min(width,Math.ceil(Math.max(...xs)+h*2)),bottom=Math.min(height,Math.ceil(Math.max(...ys)+h*.55));
 return h>=8?{x,y,w:right-x,h:bottom-y}:null;
}
export function enhanceOcrPixels(rgba,channel='blue'){
 const values=new Uint8Array(rgba.length/4),hist=new Uint32Array(256);
 for(let j=0;j<values.length;j++){const i=j*4,v=channel==='blue'?rgba[i+2]:Math.round(.299*rgba[i]+.587*rgba[i+1]+.114*rgba[i+2]);values[j]=v;hist[v]++;}
 const percentile=ratio=>{let sum=0;for(let v=0;v<256;v++){sum+=hist[v];if(sum>=values.length*ratio)return v;}return 255;};
 const low=percentile(.03),high=percentile(.90),range=Math.max(32,high-low),output=new Uint8ClampedArray(rgba.length);
 for(let j=0;j<values.length;j++){const i=j*4,v=Math.round(Math.max(0,Math.min(255,(values[j]-low)*255/range)));output[i]=output[i+1]=output[i+2]=v;output[i+3]=255;}
 return output;
}
export function removeLongRules(rgba,width,height){
 const output=new Uint8ClampedArray(rgba),mask=new Uint8Array(width*height);
 const dark=index=>rgba[index*4]<95&&rgba[index*4+1]<95&&rgba[index*4+2]<95;
 const mark=(indices)=>{for(const i of indices)mask[i]=1;};
 for(let y=0;y<height;y++){
  let start=-1;
  for(let x=0;x<=width;x++){
   if(x<width&&dark(y*width+x)){if(start<0)start=x;}
   else if(start>=0){if(x-start>=Math.max(80,width*.45))mark(Array.from({length:x-start},(_,j)=>y*width+start+j));start=-1;}
  }
 }
 for(let x=0;x<width;x++){
  let start=-1;
  for(let y=0;y<=height;y++){
   if(y<height&&dark(y*width+x)){if(start<0)start=y;}
   else if(start>=0){if(y-start>=Math.max(80,height*.7))mark(Array.from({length:y-start},(_,j)=>(start+j)*width+x));start=-1;}
  }
 }
 for(let i=0;i<mask.length;i++)if(mask[i])output[i*4]=output[i*4+1]=output[i*4+2]=255;
 return output;
}
export function ticketBounds(rgba,width,height) {
  const mask=new Uint8Array(width*height),seen=new Uint8Array(mask.length),components=[];
  for(let i=0;i<mask.length;i++){const r=rgba[i*4],g=rgba[i*4+1],b=rgba[i*4+2];mask[i]=Math.min(r,g,b)>90&&((g-r>=-6&&b-r>0)||(Math.max(r,g,b)-Math.min(r,g,b)<28&&r>140))?1:0;}
  for(let i=0;i<mask.length;i++) {if(!mask[i]||seen[i])continue;const stack=[i];seen[i]=1;let minX=width,minY=height,maxX=0,maxY=0,count=0;
    while(stack.length){const j=stack.pop(),x=j%width,y=Math.floor(j/width);count++;minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);for(const k of [x>0?j-1:-1,x<width-1?j+1:-1,y>0?j-width:-1,y<height-1?j+width:-1])if(k>=0&&mask[k]&&!seen[k]){seen[k]=1;stack.push(k);}}
    const w=maxX-minX+1,h=maxY-minY+1,ratio=w/h;
    if(count>mask.length*.10&&count/(w*h)>.60&&ratio>1.15&&ratio<2.6)components.push({x:minX,y:minY,w,h,count});
  }
  components.sort((a,b)=>b.count-a.count);
  if(!components.length || components[1]?.count>components[0].count*.5)return null;
  const c=components[0],margin=2;const x=Math.max(0,c.x-margin),y=Math.max(0,c.y-margin);return {x:x/width,y:y/height,w:Math.min(width-x,c.w+margin*2)/width,h:Math.min(height-y,c.h+margin*2)/height};
}
export function cleanPixels(rgba,width,height,fixedThreshold=null){
  const n=width*height,gray=new Uint8Array(n),hist=new Uint32Array(256);
  for(let i=0;i<n;i++){const value=Math.round(.299*rgba[i*4]+.587*rgba[i*4+1]+.114*rgba[i*4+2]);gray[i]=value;hist[value]++;}
  let total=0,background=220;for(let v=0;v<256;v++){total+=hist[v];if(total>=n*.70){background=v;break;}}
  const threshold=fixedThreshold??Math.max(75,Math.min(195,background*.62));
  // Remove pale security patterns; retain a grayscale pass separately for faint ink.
  const output=new Uint8ClampedArray(n*4);
  for(let i=0;i<n;i++){const v=gray[i]<threshold?0:255;output[i*4]=output[i*4+1]=output[i*4+2]=v;output[i*4+3]=255;}
  return output;
}
export function frameCrop(videoWidth,videoHeight,stageWidth,stageHeight,frame){
 const scale=Math.max(stageWidth/videoWidth,stageHeight/videoHeight),offsetX=(stageWidth-videoWidth*scale)/2,offsetY=(stageHeight-videoHeight*scale)/2;
 const x=Math.max(0,(frame.x-offsetX)/scale),y=Math.max(0,(frame.y-offsetY)/scale);
 return {x,y,w:Math.min(videoWidth-x,frame.w/scale),h:Math.min(videoHeight-y,frame.h/scale)};
}
