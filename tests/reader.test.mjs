import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {createCalculator} from '../reader/calculator.js';import {parseTicket} from '../reader/parser.js';
const read=n=>JSON.parse(fs.readFileSync(`reader/data/${n}.json`));
const stations=read('stations');const calc=createCalculator(read('segments'),stations,read('ordinary_fares_main'),read('ordinary_fares_local'),read('discount_rules'));
const base={from:'札幌',to:'函館',stop:'長万部',price:5020,discount:'student',valid:true};
test('paid ticket price minus used discounted fare',()=>{const r=calc.calculate(base);assert.equal(r.deduction,3170);assert.equal(r.refund,1630);assert.equal(r.unusedInfo.business.toFixed(1),'112.3');assert.equal(calc.calculate({...base,price:5000}).refund,1610);});
test('short used segment forfeits distance discount',()=>{const r=calc.calculate({...base,stop:'小樽',vias:['小樽']});assert.equal(r.usedDiscount,false);assert.equal(r.deduction,r.usedFare);});
test('destination and invalid paths',()=>{assert.equal(calc.calculate({...base,stop:'函館'}).eligible,false);assert.throws(()=>calc.calculate({...base,stop:'旭川'}),/経路上/);assert.throws(()=>calc.calculate({...base,valid:false}),/有効/);assert.throws(()=>calc.calculate({...base,discount:'caregiver_type1'}),/同行/);assert.throws(()=>calc.calculate({...base,passenger:'child'}),/小児/);});
test('six discounts, no balance and ambiguous stop',()=>{for(const r of read('discount_rules').discounts){assert.equal(calc.calculate({...base,discount:r.id,companion:true}).eligible,true);}assert.equal(calc.calculate({...base,price:1}).refund,0);assert.throws(()=>calc.calculate({...base,stop:'札幌',vias:['小樽','札幌']}),/複数回/);});
test('OCR parser handles fullwidth and ambiguous amounts conservatively',()=>{const r=parseTicket('普通乗車券\n札幌 → 函館\n学割\n発売額 ５，０２０円',stations);assert.equal(r.from,'札幌');assert.equal(r.to,'函館');assert.equal(r.price,5020);assert.equal(r.discount,'student');assert.equal(parseTicket('札幌→函館\n5,020円\n2,000円',stations).price,null);assert.equal(parseTicket('障割\n札幌→函館',stations).discount,null);assert.equal(parseTicket('指定席特急券\n札幌→函館',stations).unsupported,true);assert.equal(parseTicket('札幌→函館\n旭川→網走',stations).from,'');});

test('OCR decimal separator and missing arrow',()=>{const r=parseTicket('札幌 つ 函館\n発売額 5.020円',stations);assert.equal(r.price,5020);assert.equal(r.from,'札幌');assert.equal(r.to,'函館');});

import {mergeReadings} from '../reader/parser.js';
import {cleanPixels,frameCrop,ticketBounds} from '../reader/image-processing.js';
test('actual MARS OCR yen symbols and field disagreement',()=>{assert.equal(parseTicket('恵み 野 っ 札幌\n*\\620',stations).price,620);assert.equal(parseTicket('恵み 野 っ 札幌\n*\\620',stations).from,'恵み野');const a=parseTicket('札幌→函館\n*5,020',stations),b=parseTicket('札幌→旭川\n*5,030',stations);const r=mergeReadings([a,b]);assert.equal(r.from,'');assert.equal(r.price,null);assert.equal(mergeReadings([a,parseTicket('入場券',stations)]).unsupported,true);assert.equal(parseTicket('乗車券(かえり)',stations).unsupported,true);});
test('landscape frame crops native video with cover offset',()=>{assert.deepEqual(frameCrop(1920,1080,960,540,{x:160,y:70,w:640,h:400}),{x:320,y:140,w:1280,h:800});const r=frameCrop(1080,1920,960,540,{x:160,y:70,w:640,h:400});assert.equal(r.x,180);assert.equal(r.w,720);assert.ok(r.y>0&&r.y+r.h<=1920);});
test('security pattern threshold, solid ticket crop stays inside image',()=>{const pixels=new Uint8ClampedArray([30,30,30,255,210,220,220,255,180,195,195,255]);const clean=cleanPixels(pixels,3,1);assert.equal(clean[0],0);assert.equal(clean[4],255);const solid=new Uint8ClampedArray(160*100*4);for(let i=0;i<16000;i++)solid.set([180,210,220,255],i*4);const box=ticketBounds(solid,160,100);assert.equal(box.x,0);assert.equal(box.y,0);assert.equal(box.w,1);assert.equal(box.h,1);});
test('yen glyph omitted on standalone fare line, not dates or ambiguous fares',()=>{assert.equal(parseTicket('恵み 野 っ 札幌\n620',stations).price,620);assert.equal(parseTicket('19.-5.22\n30003-01\nC56',stations).price,null);assert.equal(parseTicket('620\n3200',stations).price,null);});

import {classifyTicket} from '../reader/ticket-kind.js';
test('limited express and green ticket titles, combined ticket and spaced OCR',()=>{
 for(const title of ['指定席特急券','自由席特急券','特 急 券','特急\n券'])assert.equal(classifyTicket(title).id,'limited_express');
 assert.equal(classifyTicket('自由席特急券').seat,'unreserved');assert.equal(classifyTicket('指定席特急券').seat,'reserved');
 assert.equal(classifyTicket('グ リ ー ン 券').id,'green');assert.equal(classifyTicket('グリーン\n券').id,'green');
 for(const title of ['特急券・グリーン券','特急・グリーン券','特急券(グリーン)'])assert.equal(classifyTicket(title).id,'limited_express+green');
 assert.equal(classifyTicket('乗車券・特急券・グリーン券').id,'ordinary+limited_express+green');assert.equal(classifyTicket('乗車券・特急券').calculable,false);
 assert.equal(classifyTicket('指定料金券').id,'seat_fee');assert.equal(classifyTicket('不鮮明な文字').id,'unknown');
});
test('instructions mentioning express or green tickets do not reclassify ordinary title',()=>{const r=classifyTicket('乗車券\n札幌→函館\n特急券は別途お求めください\nグリーン券が必要な場合があります');assert.equal(r.id,'ordinary');assert.equal(r.calculable,true);});
test('partial combined title and contradictory ticket types',()=>{const p=t=>parseTicket(t,stations);assert.equal(mergeReadings([p('乗車券・特急券'),p('特急券')]).ticketKind.id,'ordinary+limited_express');const r=mergeReadings([p('特急券'),p('グリーン券')]);assert.equal(r.ticketKind.id,'conflict');assert.equal(r.unsupported,true);assert.equal(mergeReadings([p('特急券'),p('読めない')]).ticketKind.id,'limited_express');});
test('real fee-ticket instruction OCR is not classified as an express title',()=>{const r=classifyTicket('生\n東室蘭 っ 札幌\n指定料多券とお千持ちの特急券は指定別車に限り有効\nです。お手持ちの乗車券等と同時にご利用の場合に限って有効です。\n510');assert.equal(r.id,'unknown');assert.equal(classifyTicket('グリー\nン券').id,'green');});
