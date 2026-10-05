const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
async function load(source = fs.readFileSync('app.js', 'utf8')) {
  const elements = new Map();
  const get = id => {
    if (!elements.has(id)) elements.set(id, {value:'', checked:false, innerHTML:'', textContent:'', classList:{toggle(){},add(){},remove(){},contains(){return true;}},append(){},addEventListener(){},setAttribute(){}});
    return elements.get(id);
  };
  get('ordinaryDiscount').value='none';
  const document = {getElementById:get,createElement:()=>({}),documentElement:{dataset:{}}};
  const fetch = async path => ({json:async()=>JSON.parse(fs.readFileSync(path,'utf8'))});
  const api = await new AsyncFunction('document','fetch','localStorage', source + '\nreturn {route, totals, fare, ordinaryRefund, accidentRefund, conditional};')(document,fetch,{getItem(){},setItem(){}});
  const set = values => Object.entries(values).forEach(([id,value])=>get(id).value=value);
  set({ordinaryDiscount:'none',ordinaryStatus:'after',passenger:'adult',type:'ordinary',refundMode:'regular',commuterMonths:'1'});
  return {...api,get,set};
}
function calculate(api, from, to, stop, vias=[]) {
  api.set({ordinaryStop:stop});
  const segments=api.route(from,to,vias), info=api.totals(segments);
  return api.ordinaryRefund(api.fare(info.table,info.km,'adult'),info,segments,to);
}
test('original route suffix and all six discounts',async()=>{
  const api=await load();
  for (const discount of JSON.parse(fs.readFileSync('data/discount_rules.json')).discounts) {
    api.set({ordinaryDiscount:discount.id}); api.get('discountCompanion').checked=true;
    const result=calculate(api,'札幌','函館','長万部');
    const unused=api.route('長万部','函館',[]), info=api.totals(unused);
    const normal=api.fare(info.table,info.km,'adult');
    const full=api.totals(api.route('札幌','函館',[]));
    const used=api.totals(api.route('札幌','長万部',[]));
    const fullFare=api.fare(full.table,full.km,'adult'), usedFare=api.fare(used.table,used.km,'adult');
    const amount=discount.rate?Math.ceil(fullFare*(1-discount.rate)/10)*10:fullFare;
    const deduction=discount.rate?Math.ceil(usedFare*(1-discount.rate)/10)*10:usedFare;
    assert.equal(result.refund,Math.max(0,amount-deduction-220));
    assert.notEqual(result.refund,Math.max(0,(discount.rate?Math.ceil(normal*(1-discount.rate)/10)*10:normal)-220));assert.equal(result.fee,220);
    assert.equal(result.extra.find(x=>x.label==='未使用区間営業キロ').value,`${info.business.toFixed(1)}km`);
  }
});
test('101km threshold uses business distance, not rounded fare km',async()=>{
  const api=await load();
  for(const km of [100,100.9,101,101.1]) {
    const segments=[{from:'札幌',to:'函館',line_type:'地方交通線',business_km:km,conversion_km:120}];
    const info=api.totals(segments);api.set({ordinaryStop:'札幌'});
    const result=api.ordinaryRefund(3000,info,segments,'函館');
    assert.equal(result.ok,km>=101);assert.equal(result.fee,km>=101?220:0);
  }
});
test('local and mixed fare table selection and route via preservation',async()=>{
  const api=await load();
  const mixed=[{from:'札幌',to:'長万部',line_type:'幹線',business_km:50},{from:'長万部',to:'函館',line_type:'地方交通線',business_km:60,conversion_km:66}];
  api.set({ordinaryStop:'札幌'});
  const info=api.totals(mixed); const result=api.ordinaryRefund(3000,info,mixed,'函館');
  assert.equal(info.business,110);assert.equal(info.fareCalculationKm,116);
  assert.match(result.extra.find(x=>x.label==='参照運賃表').value,/幹線/);
  const path=api.route('札幌','函館',['小樽']); const index=path.findIndex(x=>x.from==='小樽');
  api.set({ordinaryStop:'小樽'});const all=api.totals(path);
  const viaResult=api.ordinaryRefund(api.fare(all.table,all.km,'adult'),all,path,'函館');
  assert.equal(viaResult.extra.find(x=>x.label==='未使用区間営業キロ').value,`${api.totals(path.slice(index)).business.toFixed(1)}km`);
});
test('destination, invalid stops, ambiguous stops and discount conditions',async()=>{
  const api=await load();
  assert.equal(calculate(api,'札幌','函館','函館').refund,0);
  assert.throws(()=>calculate(api,'札幌','函館','旭川'),/経路上/);
  assert.throws(()=>calculate(api,'札幌','函館','未登録'),/登録駅/);
  assert.throws(()=>calculate(api,'札幌','函館','札幌',['小樽','札幌']),/複数回/);
  api.set({ordinaryDiscount:'student',ordinaryStatus:'before'});
  assert.throws(()=>calculate(api,'札幌','小樽','札幌'),/100km/);
  api.set({ordinaryDiscount:'caregiver_type1'});
  assert.throws(()=>calculate(api,'札幌','函館','札幌'),/確認/);
  api.get('discountCompanion').checked=true;
  assert.equal(calculate(api,'札幌','函館','札幌').fee,220);
});
test('accident results match main for all ticket types and purchase checks',async()=>{
  const current=await load(), baseline=await load(execFileSync('git',['show','34e6cd0:app.js'],{encoding:'utf8'}));
  for(const type of ['ordinary','unreserved','reserved','green','unassigned','commuter','coupon'])
    for(const status of ['before','after']) for(const purchase of ['yes','not-confirmed']) {
      const values={accidentPurchased:purchase,accidentStatus:status,accidentStop:'長万部',accidentChargeCondition:'unavailable',commuterMonths:'1',commuterAccidentDays:'5',commuterCategory:'通勤',commuterAccidentScope:'full',commuterPrice:'1000'};
      current.set(values);baseline.set(values);
      const path=current.route('札幌','函館',[]), info=current.totals(path), fare=current.fare(info.table,info.km,'adult');
      assert.deepEqual(current.accidentRefund(type,fare,path,'函館',1000,info),baseline.accidentRefund(type,fare,path,'函館',1000,info));
    }
});

test('used segment discount conditions and zero balance',async()=>{
  const api=await load();
  for (const discount of ['student','disability_type1_single','disability_type2_single','caregiver_type1']) {
    api.set({ordinaryDiscount:discount});api.get('discountCompanion').checked=true;
    for(const km of [100,100.1,101]) {
      const path=[{from:'札幌',to:'長万部',line_type:'幹線',business_km:km},{from:'長万部',to:'函館',line_type:'幹線',business_km:120}];
      api.set({ordinaryStop:'長万部'}); const info=api.totals(path);
      const result=api.ordinaryRefund(6000,info,path,'函館');
      const normal=api.fare(api.totals(path.slice(0,1)).table,Math.ceil(km),'adult');
      const rate=discount==='student'?0.2:0.5;
      const applies=discount==='caregiver_type1'||km>100;
      const deduction=applies?Math.ceil(normal*(1-rate)/10)*10:normal;
      assert.equal(result.extra.find(x=>x.label==='控除する既乗区間運賃').value,deduction);
      assert.equal(result.refund,Math.max(0,Math.ceil(6000*(1-rate)/10)*10-deduction-220));
    }
  }
  api.set({ordinaryDiscount:'none',ordinaryStop:'長万部'});
  const path=[{from:'札幌',to:'長万部',line_type:'幹線',business_km:100},{from:'長万部',to:'函館',line_type:'幹線',business_km:120}];
  assert.equal(api.ordinaryRefund(100,api.totals(path),path,'函館').refund,0);
});
