import fs from 'node:fs/promises';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
// Playwright can be supplied by the developer's existing test runtime.
const {chromium}=require(process.env.READER_PLAYWRIGHT_MODULE||'playwright');
const [manifest,output]=process.argv.slice(2);
if(!manifest||!output)throw new Error('Usage: node browser-robustness.mjs manifest.json results.json');
const cases=JSON.parse(await fs.readFile(manifest,'utf8'));
const url=process.env.READER_URL||'http://127.0.0.1:8765/reader/';
const browser=await chromium.launch({headless:true,...(process.env.READER_BROWSER?{executablePath:process.env.READER_BROWSER}:{})});
const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[],results=[];
page.on('pageerror',e=>errors.push(e.message));
try{
 await page.goto(url);await page.waitForFunction(()=>!document.querySelector('#choose').disabled);
 for(const item of cases){
  const start=Date.now();await page.locator('#resetAll').click();await page.locator('#file').setInputFiles(item.file);
  await page.waitForFunction(()=>/^読み取り完了|読み取りできません/.test(document.querySelector('#scanStatus').textContent),null,{timeout:180000});
  const actual=await page.evaluate(keys=>Object.fromEntries(keys.map(id=>{const input=document.getElementById(id);return [id,input.type==='checkbox'?input.checked:input.value];})),Object.keys(item.expected));
  const failed=Object.keys(item.expected).filter(key=>actual[key]!==item.expected[key]);
  const raw=await page.locator('#rawText').textContent();
  results.push({...item,actual,failed,ms:Date.now()-start,raw});
  await fs.writeFile(output,JSON.stringify({results,errors},null,2)+'\n');
  console.log(`${item.name} ${item.variant}: ${failed.length?'FAIL '+failed.join(','):'PASS'}`);
 }
 console.log(`${results.filter(r=>!r.failed.length).length}/${results.length} complete matches`);
 if(results.some(r=>r.failed.length)||errors.length)process.exitCode=1;
}finally{await browser.close();}
