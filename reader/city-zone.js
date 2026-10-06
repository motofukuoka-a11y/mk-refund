// JR北海道 rule_10.pdf / 旅客営業規則第86条の札幌市内ゾーン。
export const sapporoCityStations=['ほしみ','星置','稲穂','手稲','稲積公園','発寒','発寒中央','琴似','桑園','札幌','苗穂','白石','厚別','森林公園','平和','新札幌','上野幌','八軒','新川','新琴似','太平','百合が原','篠路','拓北','あいの里教育大','あいの里公園'];
export function cityContext(input,calculator){
 const city=input.city||{};if(!city.from&&!city.to)return null;
 if(city.from&&city.to)throw new Error('札幌市内相互間の券は、この市内制度の計算対象ではありません。');
 if(!input.kind.kinds.includes('ordinary'))throw new Error('札幌市内制度は乗車券部分について確認してください。');
 const {from,to,stop,vias=[]}=input;
 if(city.from&&from!=='札幌'||city.to&&to!=='札幌')throw new Error('札幌市内の中心駅は札幌です。元券の発着駅を確認してください。');
 const actualFrom=city.from?input.actualFrom:from,actualTo=city.to?input.actualTo:to;
 if(city.from&&!sapporoCityStations.includes(actualFrom)||city.to&&!sapporoCityStations.includes(actualTo))throw new Error('札幌市内の実際の乗車駅・下車予定駅を選択してください。');
 const original=calculator.route(from,to,vias);
 if(calculator.totals(original).business<=200)throw new Error('中心駅からの元券区間が200kmを超えません。市内表示と経由を確認してください。');
 const path=calculator.route(actualFrom,actualTo,vias),points=[actualFrom,...path.map(s=>s.to)],positions=points.flatMap((s,i)=>s===stop?[i]:[]);
 if(positions.length!==1)throw new Error('旅行中止駅を実際の乗車経路上で確認してください。');
 const index=positions[0],used=path.slice(0,index),unused=path.slice(index);
 // ゾーンを出た後に再進入する経路では第86条の特例を適用しない。
 if(new Set(points).size!==points.length)throw new Error('経路が同じ駅を複数回通ります。券面の経由順序を確認してください。');
 const outside=points.map(s=>!sapporoCityStations.includes(s));
 if(city.from){const exit=outside.indexOf(true);if(exit>=0&&points.slice(exit).some(s=>sapporoCityStations.includes(s)))throw new Error('札幌市内を出て再び入る経路は個別取扱いを確認してください。');}
 if(city.to){const entry=outside.lastIndexOf(true)+1;if(points.slice(0,entry).some(s=>sapporoCityStations.includes(s)))throw new Error('札幌市内を通過して再び入る経路は個別取扱いを確認してください。');}
 if(city.from&&sapporoCityStations.includes(stop))throw new Error('発側の札幌市内での旅行中止は、実乗区間の収受等の個別取扱いを確認してください。');
 if(city.to&&input.mode==='accident'&&sapporoCityStations.includes(stop))throw new Error('着側の札幌市内での事故中止は、中心駅までの利用状況を含め個別取扱いを確認してください。');
 const usedVias=vias.filter(s=>used.some(e=>e.to===s));
 let usedFarePath=used,basis='実際の乗車駅から中止駅まで';
 if(city.from){const central=calculator.route('札幌',stop,usedVias);if(calculator.totals(central).business>200){usedFarePath=central;basis='既乗区間も200km超のため中心駅（札幌）から中止駅まで';}}
 const unusedVias=vias.filter(s=>unused.some(e=>e.from===s));
 const unusedFarePath=city.to&&input.mode==='accident'?calculator.route(stop,'札幌',unusedVias):unused;
 return {path,original,usedFarePath,unusedFarePath,used,unused,actualFrom,actualTo,basis,city};
}
