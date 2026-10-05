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
