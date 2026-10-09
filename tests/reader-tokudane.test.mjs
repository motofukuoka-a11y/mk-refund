import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {parseTicket,mergeReadings,canStopAfterReading} from '../reader/parser.js';
import {classifyTicket,editableTicketKind} from '../reader/ticket-kind.js';
import {readTokudane} from '../reader/tokudane.js';
import {createCalculator} from '../reader/calculator.js';
import {createReaderRefundCalculator} from '../reader/before-refund.js';
import {createCancellationCalculator,supportsCancellation} from '../reader/cancellation.js';
import {enhanceOcrPixels} from '../reader/image-processing.js';
const read=n=>JSON.parse(fs.readFileSync(`reader/data/${n}.json`)),stations=read('stations');
const calculator=createCalculator(read('segments'),stations,read('ordinary_fares_main'),read('ordinary_fares_local'),read('discount_rules'));
const refund=createReaderRefundCalculator(calculator,stations);
const p=text=>parseTicket(text,stations);
const base={kind:editableTicketKind('tokudane'),usage:'before',mode:'normal',from:'旭川',to:'網走',price:6000,components:{ordinary:4000,limited_express:2000},tokudaneRate:'30',tokudanePaper:true,tokudaneDeparture:'before',unused:true,valid:true};
test('legacy printed percentages and current booking-deadline names stay distinct',()=>{
 for(const rate of [10,20,30,35,50,55])assert.equal(readTokudane(`トクだ値${rate}`).rate,rate);
 for(const name of ['特急トクだ値1','トクだ値14','トクだ値スペシャル28','新幹線eチケット（トクだ値1）'])assert.equal(readTokudane(name).rate,null);
 assert.equal(readTokudane('特急トクだ値1\n割引率：30％').rate,30);assert.equal(readTokudane('特急トクだ値1\n30％').rate,30);
 assert.equal(readTokudane('特急トクだ値14（20%割引）').rate,20);
 assert.equal(readTokudane('とくダネ30').rate,30);assert.equal(readTokudane('トクダ値２０').rate,20);
 assert.equal(readTokudane('トクだ値30（20%割引）').rate,null);
});
test('Tokudane is a distinct editable product even without a complete title or breakdown',()=>{
 const r=p('トクだ值30\n旭 川→網 走\n￥4,440\n1号車8番A席');
 assert.equal(r.ticketKind.product,'tokudane');assert.equal(r.ticketKind.rate,30);assert.equal(supportsCancellation(r.ticketKind),true);assert.equal(r.from,'旭川');assert.equal(r.price,4440);assert.equal(r.discountNeedsReview,false);
 for(const title of ['トクだ値30（料金のみ）','新幹線eチケット（障害者割・トクだ値14）','トクだ値30 グリーン','トクだ値30 往復','トクだ値30 自由席'])assert.equal(supportsCancellation(p(title).ticketKind),false);
});
test('a second reading cannot downgrade Tokudane into an ordinary ticket',()=>{
 const r=mergeReadings([p('乗車券・特急券\n旭川→網走\n6000円'),p('トクだ値30\n旭川→網走\n6000円')]);assert.equal(r.ticketKind.product,'tokudane');assert.equal(r.ticketKind.rate,30);
 const conflict=mergeReadings([p('トクだ値30'),p('トクだ値20')]);assert.equal(conflict.ticketKind.rate,null);assert.equal(conflict.ticketKind.rateConflict,true);
 assert.equal(mergeReadings([p('トクだ値30'),p('団体乗車券')]).ticketKind.restricted,true);
});
test('received paper Tokudane uses both paid components without applying the discount again',()=>{
 assert.equal(refund(base).fee,1800);assert.equal(refund(base).refund,4200);assert.equal(refund({...base,tokudaneRate:'20'}).fee,1200);
 assert.deepEqual(refund(base).rows.map(row=>[row.type,row.fee,row.refund]),[['ordinary',1200,2800],['limited_express',600,1400]]);
});
test('the supplied ticket rounds each fee before summing, rather than rounding the combined fee',()=>{
 const r=refund({...base,from:'札幌',to:'長万部',vias:['南千歳','東室蘭'],price:5440,components:{ordinary:3380,limited_express:2060}});
 assert.deepEqual(r.rows.map(row=>[row.paid,row.fee,row.refund]),[[3380,1010,2370],[2060,610,1450]]);
 assert.equal(r.fee,1620);assert.equal(r.refund,3820);assert.equal(r.estimate,undefined);
 assert.match(r.formula,/1,010円 ＋ 610円 ＝ 1,620円/);assert.match(r.formula,/5,440円 − 1,620円 ＝ 3,820円/);assert.match(r.reason,/それぞれ/);
 const twenty=refund({...base,price:5440,components:{ordinary:3380,limited_express:2060},tokudaneRate:'20'});
 assert.deepEqual(twenty.rows.map(row=>row.fee),[670,410]);assert.equal(twenty.refund,4360);
 const exactTotal=refund({...base,components:{ordinary:3710,limited_express:2290}});
 assert.equal(exactTotal.fee,1790);assert.equal(exactTotal.refund,4210);
});
test('Tokudane applies the 220 and 340 yen minima separately and never refunds a negative amount',()=>{
 const small=refund({...base,price:2000,components:{ordinary:1000,limited_express:1000},tokudaneRate:'20'});
 assert.deepEqual(small.rows.map(row=>row.fee),[220,340]);assert.equal(small.fee,560);assert.equal(small.refund,1440);
 for(const [parts,expected] of [[{ordinary:1000,limited_express:2000},[220,400]],[{ordinary:2000,limited_express:1000},[400,340]]]){
  const r=refund({...base,price:3000,components:parts,tokudaneRate:'20'});assert.deepEqual(r.rows.map(row=>row.fee),expected);assert.equal(r.refund,3000-expected[0]-expected[1]);
 }
 const tiny=refund({...base,price:300,components:{ordinary:100,limited_express:200},tokudaneRate:'20'});
 assert.equal(tiny.refund,0);assert.equal(tiny.fee,300);assert.ok(tiny.rows.every(row=>row.refund===0));
});
test('Tokudane requires complete integer components matching the paid total',()=>{
 for(const components of [undefined,{}, {ordinary:6000},{ordinary:4000,limited_express:0},{ordinary:4000,limited_express:-1},{ordinary:4000,limited_express:2000.5},{ordinary:4000,limited_express:NaN},{ordinary:4000,limited_express:'2000'},{ordinary:4000,limited_express:Number.MAX_SAFE_INTEGER+1},{ordinary:4000,limited_express:2000,green:500}])assert.throws(()=>refund({...base,components}),/それぞれ/);
 assert.throws(()=>refund({...base,components:{ordinary:4000,limited_express:1990}}),/内訳合計/);
});
test('integer percentage rounding keeps exact ten-yen boundaries',()=>{
 const r=refund({...base,price:10000,components:{ordinary:5000,limited_express:5000},tokudaneRate:'29'});
 assert.deepEqual(r.rows.map(row=>row.fee),[1450,1450]);assert.equal(r.refund,7100);
 const large=refund({...base,price:Number.MAX_SAFE_INTEGER,components:{ordinary:9007199254730991,limited_express:10000},tokudaneRate:'99'});
 assert.equal(large.fee,8917127262193580);assert.equal(large.price-large.fee,large.refund);
});
test('Tokudane cannot silently enter the ordinary before/after or accident rules',()=>{
 for(const [patch,pattern] of [[{tokudanePaper:false},/紙/],[{tokudaneDeparture:''},/出発/],[{tokudaneDeparture:'departed'},/出発/],[{tokudaneRate:''},/割引率/],[{tokudaneRate:'14.5'},/割引率/],[{tokudaneRate:'100'},/割引率/],[{unused:false},/未使用/],[{valid:false},/有効/],[{usage:'after'},/使用開始後/],[{mode:'accident'},/運休/]])assert.throws(()=>refund({...base,...patch}),pattern);
 assert.throws(()=>createCancellationCalculator(calculator,stations)({...base,usage:'after',started:true}),/トクだ値/);
 assert.throws(()=>refund({...base,kind:{...base.kind,restricted:true}}),/個別/);
});
test('explicit multiline and full-label breakdowns reflect the printed total',()=>{
 for(const body of ['内訳：\n乗車券運賃：2,970円\n特急料金：1,470円','内訳：乗車券2,970・特急料金1,470','内訳：\n乗2,970\n特1,470']){
  const r=p(`乗車券・特\n旭川→網走\n￥4,440\n${body}`);assert.equal(r.price,4440);assert.equal(r.ticketKind.id,'ordinary+limited_express');assert.deepEqual(r.fees,{ordinary:2970,limited_express:1470});
 }
 assert.equal(p('乗車券・特\n￥4,440\n内訳：\n乗2,970\n特1,400').fees,null);
});
test('breakdown identity is independent of component order and conflicting seats remain empty',()=>{
 const a=p('乗車券・特急券\n￥4,440\n内訳：乗2,970・特1,470\n1号車8番A席'),b=p('乗車券・特急券\n￥4,440\n内訳：特1,470・乗2,970\n自由席');
 const r=mergeReadings([a,b]);assert.deepEqual(r.fees,{ordinary:2970,limited_express:1470});assert.equal(r.chargeSeat,null);assert.equal(r.ticketKind.seat,'unknown');
 assert.equal(p('特急券\n自由席\n1号車8番A席').chargeSeat,null);
});
test('seat evidence prompts a second pass and discounts that need review stay blank',()=>{
 assert.equal(canStopAfterReading(p('普通乗車券\n旭川→網走\n￥4,440\n1号車8番A席')),false);
 const r=mergeReadings([p('乗車券\n障割\n旭川→網走\n￥4,440'),p('乗車券\n旭川→網走\n￥4,440')]);assert.equal(r.discount,null);assert.equal(r.discountNeedsReview,true);
 assert.equal(editableTicketKind('ordinary+limited_express').kinds.length,2);assert.equal(editableTicketKind(''),null);
});
test('contrast adjustment preserves faint ink and does not mutate the original pixels',()=>{
 const image=new Uint8ClampedArray(100*4);for(let i=0;i<100;i++)image.set(i<10?[140,150,160,255]:[230,240,250,255],i*4);
 const original=image.slice(),enhanced=enhanceOcrPixels(image);assert.deepEqual(image,original);assert.ok(enhanced[0]<image[2]);assert.equal(enhanced[40],255);assert.equal(enhanced[3],255);
});

test('traditional and simplified character variants produced by the OCR retain station and breakdown fields',()=>{const r=p('乗車券・特\n旭川→网走\n￥4,440\n內訳：乘2,970・特1,470');assert.equal(r.to,'網走');assert.deepEqual(r.fees,{ordinary:2970,limited_express:1470});});

test('instructions about other products do not block an otherwise supported title',()=>{assert.equal(classifyTicket('トクだ値30\n自由席には乗車できません。\n往復の場合は別途確認してください。').restricted,false);});

test('malformed monetary punctuation does not turn decimal-looking OCR into a larger fare',()=>{for(const text of ['￥44.40','￥4,44','￥4..440','￥4440,0'])assert.equal(p('乗車券\n旭川→網走\n'+text).price,null);assert.equal(p('￥4.440').price,4440);});
