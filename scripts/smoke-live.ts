import { performance } from 'node:perf_hooks';
import { readFile } from 'node:fs/promises';
import { Catalog } from '../src/server/catalog';
import { parseAttachment } from '../src/server/attachments';
import { createVisionProvider, interpretRequest } from '../src/server/model';

// Explicit read-only integration check. Never confirms a proposal or writes an order.
const catalog=new Catalog('live');
const observations:Record<string,unknown>[]=[];
async function measure(name:string,run:()=>Promise<unknown>){
 const start=performance.now();
 try {await run();observations.push({name,status:'passed',ms:Math.round(performance.now()-start)});}
 catch(error){observations.push({name,status:'failed',ms:Math.round(performance.now()-start),code:error instanceof Error&&'code'in error?error.code:'UNAVAILABLE'});process.exitCode=1;}
}
async function main(){
for(const mode of ['cold','warm'])await measure(`catalog SKU ${mode}`,async()=>{
 const matches=await catalog.search('200300285_');if(!matches.some(m=>m.kind==='exact'))throw new Error('No exact match');
});
for(const mode of ['cold','warm'])await measure(`model text + catalog ${mode}`,async()=>{
 const intent=await interpretRequest('Найди артикул 200300285_',[]);
 const matches=await catalog.search(intent.query);if(!matches.length)throw new Error('No model-guided match');
});
const buffer=await readFile('.tmp/demo-files/sample-label.jpg');
for(const mode of ['cold','warm'])await measure(`JPEG recognition + catalog ${mode}`,async()=>{
 const result=await parseAttachment({name:'new-label.jpg',type:'image/jpeg',buffer},createVisionProvider());
 if(!result.lines.length)throw new Error('No extracted lines');
 for(const line of result.lines)if(!(await catalog.search(line.query)).length)throw new Error('No image-guided match');
});
console.log(JSON.stringify({checkedAt:new Date().toISOString(),catalog:catalog.status(),network:'Current local Windows connection; serial single observations, not p95',observations},null,2));
}
main().catch(()=>{console.error('Live smoke could not start; check local configuration and generated demo files.');process.exitCode=1;});
