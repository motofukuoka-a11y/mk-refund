import cvModule from '@techstark/opencv-js';
import {priceBand,recoveredMoney} from '../ocr-lines.js';
export async function recognize(engine,mat,width,height){
const [result]=await engine.predict(mat,{textDetLimitSideLen:1280,textDetLimitType:'max',textRecScoreThresh:.30});if(!recoveredMoney(result.items)){
     const r=priceBand(result.items,width,height);if(r){const part=mat.roi(new cvModule.Rect(r.x,r.y,r.w,r.h)),scaled=new cvModule.Mat(),padded=new cvModule.Mat();try{cvModule.resize(part,scaled,new cvModule.Size(r.w*2,r.h*2));cvModule.copyMakeBorder(scaled,padded,64,64,64,64,cvModule.BORDER_CONSTANT,new cvModule.Scalar(255,255,255,255));for(let j=0;j<padded.data.length;j+=4){if(padded.data[j]-padded.data[j+1]>15&&padded.data[j+2]-padded.data[j+1]>15)padded.data[j]=padded.data[j+1]=padded.data[j+2]=255;}const [money]=await engine.predict(padded,{textDetLimitSideLen:1280,textDetLimitType:'max',textRecScoreThresh:.3});result.moneyText=recoveredMoney(money.items);}finally{part.delete();scaled.delete();padded.delete();}}
    }
    return result;
}
