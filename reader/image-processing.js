// Pure pixel helpers shared by browser capture and the sample benchmark.
export function enhanceOcrPixels(rgba,channel='blue'){
 const values=new Uint8Array(rgba.length/4),hist=new Uint32Array(256);
 for(let j=0;j<values.length;j++){const i=j*4,v=channel==='blue'?rgba[i+2]:Math.round(.299*rgba[i]+.587*rgba[i+1]+.114*rgba[i+2]);values[j]=v;hist[v]++;}
 const percentile=ratio=>{let sum=0;for(let v=0;v<256;v++){sum+=hist[v];if(sum>=values.length*ratio)return v;}return 255;};
 const low=percentile(.03),high=percentile(.90),range=Math.max(60,high-low),output=new Uint8ClampedArray(rgba.length);
 for(let j=0;j<values.length;j++){const i=j*4,v=Math.round(Math.max(0,Math.min(255,(values[j]-low)*255/range)));output[i]=output[i+1]=output[i+2]=v;output[i+3]=255;}
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
