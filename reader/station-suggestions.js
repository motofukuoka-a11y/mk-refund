// A visible, keyboard-accessible station list also works where native datalists
// are not displayed. Values remain free text until the refund calculation.
const normalize=value=>value.normalize('NFKC').replace(/[\s　]/g,'').replace(/[ァ-ヶ]/g,c=>String.fromCharCode(c.charCodeAt(0)-0x60));
const commonReadings={札幌:'さっぽろ',函館:'はこだて',旭川:'あさひかわ',帯広:'おびひろ',釧路:'くしろ',小樽:'おたる',網走:'あばしり',稚内:'わっかない',北見:'きたみ',岩見沢:'いわみざわ',千歳:'ちとせ',南千歳:'みなみちとせ',東室蘭:'ひがしむろらん',室蘭:'むろらん',苫小牧:'とまこまい',新函館北斗:'しんはこだてほくと',新千歳空港:'しんちとせくうこう',長万部:'おしゃまんべ',倶知安:'くっちゃん',富良野:'ふらの',名寄:'なよろ',留萌:'るもい'};
export function stationSuggestions(stations,value,multiple=false){
 const query=normalize(multiple?value.split(/[,、]/).at(-1):value);
 if(!query){const popular=['札幌','函館','旭川','帯広','釧路','小樽','網走','稚内'];return popular.filter(s=>stations.includes(s)).concat(stations.filter(s=>!popular.includes(s))).slice(0,8);}
 return stations.map((station,index)=>{const keys=[normalize(station),commonReadings[station]||''];return {station,index,rank:keys.some(key=>key.startsWith(query))?0:keys.some(key=>key.includes(query))?1:2};}).filter(s=>s.rank<2).sort((a,b)=>a.rank-b.rank||a.index-b.index).slice(0,8).map(s=>s.station);
}
export function replaceStation(value,station,multiple=false){
 if(!multiple)return station;
 const last=Math.max(value.lastIndexOf(','),value.lastIndexOf('、'));
 return last<0?station:value.slice(0,last+1)+station;
}
export function attachStationSuggestions(input,stations,{multiple=false}={}){
 const wrapper=document.createElement('div');wrapper.className='station-input';input.parentNode.insertBefore(wrapper,input);wrapper.append(input);
 const list=document.createElement('div');list.id=input.id+'Candidates';list.className='station-candidates';list.setAttribute('role','listbox');list.setAttribute('aria-label','駅候補');list.hidden=true;wrapper.append(list);
 input.removeAttribute('list');input.setAttribute('role','combobox');input.setAttribute('aria-autocomplete','list');input.setAttribute('aria-controls',list.id);input.setAttribute('aria-expanded','false');
 let matches=[],active=-1;
 const close=()=>{list.hidden=true;input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');active=-1;};
 function highlight(){[...list.children].forEach((option,index)=>option.setAttribute('aria-selected',String(index===active)));if(active<0)input.removeAttribute('aria-activedescendant');else input.setAttribute('aria-activedescendant',list.children[active].id);}
 function choose(station){input.value=replaceStation(input.value,station,multiple);input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));close();input.focus();input.setSelectionRange(input.value.length,input.value.length);close();}
 function render(){matches=stationSuggestions(stations,input.value,multiple);active=-1;list.replaceChildren(...matches.map((station,index)=>{const option=document.createElement('button');option.type='button';option.id=list.id+'-'+index;option.setAttribute('role','option');option.setAttribute('aria-selected','false');option.textContent=station;option.addEventListener('pointerdown',event=>event.preventDefault());option.addEventListener('click',event=>{event.preventDefault();choose(station);});return option;}));list.hidden=!matches.length;input.setAttribute('aria-expanded',String(matches.length>0));input.removeAttribute('aria-activedescendant');}
 input.addEventListener('focus',render);input.addEventListener('input',event=>{if(!event.isComposing)render();});input.addEventListener('compositionend',render);
 input.addEventListener('blur',event=>{if(!wrapper.contains(event.relatedTarget))close();});
 input.addEventListener('keydown',event=>{if(event.isComposing)return;if(event.key==='Escape'){close();return;}if(['ArrowDown','ArrowUp'].includes(event.key)){if(list.hidden)render();if(!matches.length)return;event.preventDefault();active=event.key==='ArrowDown'?(active+1)%matches.length:(active<0?matches.length-1:(active+matches.length-1)%matches.length);highlight();}else if(event.key==='Enter'&&!list.hidden&&active>=0){event.preventDefault();choose(matches[active]);}else if(event.key==='Tab')close();});
 document.addEventListener('pointerdown',event=>{if(!wrapper.contains(event.target))close();});
 return {close};
}
