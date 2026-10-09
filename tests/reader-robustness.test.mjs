import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {parseTicket,mergeReadings,titleOnlyReading} from '../reader/parser.js';
import {stationBand,titleBand,removeLongRules} from '../reader/image-processing.js';
import {stationSuggestions} from '../reader/station-suggestions.js';
const stations=JSON.parse(fs.readFileSync(new URL('../reader/data/stations.json',import.meta.url)));
const readings=JSON.parse(fs.readFileSync(new URL('../reader/data/station-readings.json',import.meta.url)));
const item=(text,x,y,w,h,score=.96)=>({text,score,poly:[[x,y],[x+w,y],[x+w,y+h],[x,y+h]]});

test('route excludes OCR variants of via lines and issue locations',()=>{
 for(const via of ['経由：千歳線・室蘭線','經由：千歲線·室蘭線','经由：千歲線→室蘭線']){
  const p=parseTicket(`乗車券\n島 松 長 万 部\n${via}\n￥3,960\n島松駅MR発行`,stations);
  assert.equal(p.from,'島松');assert.equal(p.to,'長万部');assert.equal(p.price,3960);
 }
});
test('a noisy arrow retains explicit stations without inventing partial names',()=>{
 for(const text of ['島松 公→長万部','島松→長 長万部']){
  const p=parseTicket(text,stations);assert.equal(p.from,'島松');assert.equal(p.to,'長万部');
 }
 const partial=parseTicket('長万 → 幌',stations);assert.equal(partial.from,'');assert.equal(partial.to,'');
 const multiple=parseTicket('札幌函館→長万部',stations);assert.equal(multiple.from,'');
});
test('city marker next to a stray glyph stays editable as a Tokudane ticket',()=>{
 const p=parseTicket('トクだ値30\n札幌 民(市内) →長万部\n￥5,440 内訳：乗3,380・特2,060',stations);
 assert.equal(p.from,'札幌');assert.equal(p.to,'長万部');assert.equal(p.ticketKind.city.from,true);assert.equal(p.ticketKind.restricted,false);
 assert.equal(parseTicket('乗車券\n東京都区内→函館',stations).ticketKind.restricted,true);
});
test('resolved Sapporo city evidence clears only the temporary city restriction',()=>{
 const fragment=parseTicket('トクだ値30\n札幌(市内)\n￥5,440',stations);
 assert.equal(fragment.ticketKind.restricted,true);
 const recovered=parseTicket('トクだ値30\n札幌(市内)→長万部\n￥5,440',stations);
 assert.equal(mergeReadings([fragment,recovered]).ticketKind.restricted,false);
 for(const title of ['トクだ値30 グリーン','トクだ値30 障割','団体乗車券','トクだ値30\n大阪市内']){
  const restricted=parseTicket(`${title}\n札幌(市内)`,stations);
  assert.equal(mergeReadings([restricted,recovered]).ticketKind.restricted,true,title);
 }
});
test('split travel dates and explicit departure times locate station recovery; issue dates do not',()=>{
 const split=[item('10月',30,240,70,35),item('9日',110,240,65,35),item('（18:46発）',200,240,150,35)];
 assert.ok(stationBand(split,800,500));
 assert.ok(stationBand([item('(18:46発)',80,240,200,35)],800,500));
 assert.equal(stationBand([item('2026.10.-9 発券',30,400,200,30)],800,500),null);
});
test('title recovery is isolated from adjacent stations, money and city markers',()=>{
 const original=parseTicket('長万部→札幌\n￥1,470\n4号車13番D席',stations);
 const crop=titleOnlyReading(parseTicket('特急券\n札幌→函館\n￥9,990',stations));
 const merged=mergeReadings([original,crop]);
 assert.equal(merged.ticketKind.id,'limited_express');assert.equal(merged.from,'長万部');assert.equal(merged.to,'札幌');assert.equal(merged.price,1470);assert.equal(merged.chargeSeat,'reserved');
 assert.ok(titleBand([item('特急#',180,90,150,35)],800,500));
 assert.equal(titleBand([item('特急券は別途必要',180,90,150,35)],800,500),null);
});
test('all registered stations have kana candidates; exact spelling ranks before substrings',()=>{
 assert.equal(Object.keys(readings).length,stations.length);
 for(const station of stations)assert.ok(stationSuggestions(stations,readings[station],false,readings).includes(station),station);
 assert.equal(stationSuggestions(stations,'さ',false,readings)[0],'札幌');
 assert.equal(stationSuggestions(stations,'しま',false,readings)[0],'島松');
 assert.equal(stationSuggestions(stations,'オシャ',false,readings)[0],'長万部');
 assert.equal(stationSuggestions(stations,'札幌、しま',true,readings)[0],'島松');
});
test('rule removal removes long thin lines while preserving separate character strokes and source pixels',()=>{
 const width=240,height=160,pixels=new Uint8ClampedArray(width*height*4).fill(255);
 const ink=(x,y)=>{pixels[(y*width+x)*4]=pixels[(y*width+x)*4+1]=pixels[(y*width+x)*4+2]=0;};
 for(let x=10;x<230;x++)ink(x,120);
 for(let y=10;y<150;y++)ink(200,y);
 for(let x=30;x<60;x++)ink(x,50);
 const output=removeLongRules(pixels,width,height);
 assert.equal(output[(120*width+50)*4],255);assert.equal(output[(70*width+200)*4],255);
 assert.equal(output[(50*width+45)*4],0);assert.equal(pixels[(120*width+50)*4],0);
 assert.equal(output[(120*width+50)*4+3],255);
});
