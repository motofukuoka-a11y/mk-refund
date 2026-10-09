import {test} from 'node:test';
import assert from 'node:assert/strict';
import {stationSuggestions,replaceStation} from '../reader/station-suggestions.js';
import {componentTotal} from '../reader/review-amounts.js';
import {parseTicket,mergeReadings,stationOnlyReading} from '../reader/parser.js';
import {stationBand} from '../reader/image-processing.js';
const stations=['札幌','新札幌','長万部','函館'];

test('station choices match partial names, common kana and the last via station',()=>{
 const stations=['東旭川','旭川','旭川四条','札幌','新札幌','函館','新函館北斗'];
 assert.deepEqual(stationSuggestions(stations,'旭'),['旭川','旭川四条','東旭川']);
 assert.deepEqual(stationSuggestions(stations,'サッポロ'),['札幌']);
 assert.deepEqual(stationSuggestions(stations,'札幌、函',true),['函館','新函館北斗']);
 assert.deepEqual(stationSuggestions(stations,'不存在'),[]);
 assert.ok(stationSuggestions(stations,'').includes('札幌'));
});
test('choosing a via station preserves earlier stations and its separator',()=>{
 assert.equal(replaceStation('札幌、 長','長万部',true),'札幌、長万部');
 assert.equal(replaceStation('札幌,小樽、長','長万部',true),'札幌,小樽、長万部');
 assert.equal(replaceStation('札','札幌'),'札幌');
});
test('editable fee totals use only selected components and keep known totals when incomplete',()=>{
 const all={ordinary:'3710',limited_express:'2290',green:'1800'};
 assert.equal(componentTotal({kinds:['ordinary','limited_express']},all),6000);
 assert.equal(componentTotal({kinds:['green']},all),1800);
 assert.equal(componentTotal({kinds:['ordinary','limited_express','green']},all),7800);
 for(const value of ['',0,-1,'22.90',null])assert.equal(componentTotal({kinds:['ordinary','limited_express']},{...all,limited_express:value}),null);
 assert.equal(componentTotal(null,all),null);
});

test('a readable destination is retained while the departure station is missing',()=>{
 const partial=parseTicket('トクだ値30\n→長万部\n￥5,440',stations);
 assert.equal(partial.from,'');assert.equal(partial.to,'長万部');
 const merged=mergeReadings([partial,parseTicket('えきねっと発券 札幌駅西MV',stations)]);
 assert.equal(merged.from,'');assert.equal(merged.to,'長万部');assert.equal(merged.price,5440);
});
test('station recovery preserves city notation without changing total, product or discount',()=>{
 const original=parseTicket('トクだ値30\n→長万部\n￥5,440 内訳：乗3,380・特2,060',stations);
 const noTitle=parseTicket('乗車券\n3割',stations);
 const crop=parseTicket('C制乗車券\n*10/12\n札幌（市内） 長万部',stations);
 const merged=mergeReadings([original,noTitle,stationOnlyReading(crop)]);
 assert.equal(merged.from,'札幌');assert.equal(merged.to,'長万部');assert.equal(merged.ticketKind.city.from,true);
 assert.equal(merged.price,5440);assert.deepEqual(merged.fees,{ordinary:3380,limited_express:2060});
 assert.equal(merged.ticketKind.product,'tokudane');assert.equal(merged.ticketKind.restricted,false);assert.equal(merged.discountNeedsReview,false);
 assert.ok(!merged.warnings.some(w=>/本人・介護者/.test(w)));
});
test('station crop requires a confident travel date and stays inside the image',()=>{
 const date={score:.95,text:'10月9日（18:46発）',poly:[[50,240],[600,240],[600,275],[50,275]]};
 const band=stationBand([date],800,500);assert.ok(band.y>=0&&band.y<240&&band.y+band.h<=500&&band.w===800);
 assert.equal(stationBand([],800,500),null);assert.equal(stationBand([{...date,score:.5}],800,500),null);
 assert.equal(stationBand([{...date,text:'2026.10.-9 発券'}],800,500),null);
});
