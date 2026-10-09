// Test fixtures only: originals and transformed photographs stay outside Git.
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const [input,output]=process.argv.slice(2);
if(!input||!output)throw new Error('Usage: node generate-degraded.mjs samples.json output-directory');
const samples=JSON.parse(await fs.readFile(input,'utf8'));
await fs.mkdir(output,{recursive:true});
const cases=[];
const random=seed=>()=>{seed=(1664525*seed+1013904223)>>>0;return seed/4294967296;};
for(const sample of samples){
 const name=sample.name||path.parse(sample.file).name;
 cases.push({name,variant:'original',file:path.resolve(sample.original||sample.file),expected:sample.expected});
 const source=await sharp(sample.file).resize({width:2000,height:2000,fit:'inside'}).png().toBuffer();
 const {data,info}=await sharp(source).ensureAlpha().raw().toBuffer({resolveWithObject:true});
 const noisy=Buffer.from(data),rng=random(5906),dark=Buffer.from(data),lines=Buffer.from(data);
 for(let i=0;i<noisy.length;i+=4)for(let c=0;c<3;c++){
  noisy[i+c]=Math.max(0,Math.min(255,noisy[i+c]+Math.round((rng()-.5)*36)));
  dark[i+c]=Math.round(dark[i+c]*.38);
 }
 for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++){
  if(Math.abs(y-info.height*.45)<=1||Math.abs(y-info.height*.62)<=1||Math.abs(x-info.width*.57)<=1){const i=(y*info.width+x)*4;lines[i]=lines[i+1]=lines[i+2]=35;}
 }
 const variants={
  small:()=>sharp(source).resize({width:900}).jpeg({quality:85}),
  poor:()=>sharp(source).blur(.75).jpeg({quality:12}),
  noise:()=>sharp(noisy,{raw:info}).png(),
  dark:()=>sharp(dark,{raw:info}).png(),
  lines:()=>sharp(lines,{raw:info}).png(),
  combined:()=>sharp(noisy,{raw:info}).modulate({brightness:.55}).resize({width:1100}).jpeg({quality:35})
 };
 for(const [variant,make] of Object.entries(variants)){
  const file=path.resolve(output,`${name}-${variant}.${['small','poor','combined'].includes(variant)?'jpg':'png'}`);
  await make().toFile(file);cases.push({name,variant,file,expected:sample.expected});
 }
}
await fs.writeFile(path.resolve(output,'manifest.json'),JSON.stringify(cases,null,2)+'\n');
console.log(`${samples.length} photographs × 7 conditions = ${cases.length} cases`);
