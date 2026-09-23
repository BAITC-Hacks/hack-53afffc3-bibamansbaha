import {test,before} from 'node:test';
import assert from 'node:assert/strict';
import {NextRequest} from 'next/server';
process.env.CATALOG_MODE='fixture';process.env.DATABASE_PATH=':memory:';process.env.OPENAI_API_KEY='';process.env.OPENAI_MODEL='';process.env.APP_ORIGIN='http://127.0.0.1:3001';
let GET:typeof import('../src/app/api/[action]/route').GET, POST:typeof import('../src/app/api/[action]/route').POST;
let runtime:typeof import('../src/server/runtime').runtime;
before(async()=>{({GET,POST}=await import('../src/app/api/[action]/route'));({runtime}=await import('../src/server/runtime'));});
const ctx=(action:string)=>({params:Promise.resolve({action})});
test('EKT-015 malformed CSRF receives 403, valid token still permits a proposal',async()=>{
 const s=runtime.cart.createSession();
 for(const token of ['é'.repeat(64),'x'.repeat(64),'','a'.repeat(4096)]){
  const response=await POST(new NextRequest(`${process.env.APP_ORIGIN}/api/proposal`,{method:'POST',headers:{origin:process.env.APP_ORIGIN!,cookie:`ekt_session=${s.id}`,'x-csrf-token':token,'content-type':'application/json'},body:JSON.stringify({lines:[{productId:'DEMO-C25',quantity:1}]})}),ctx('proposal'));
  assert.equal(response.status,403);assert.equal(runtime.cart.getCart(s.id).lines.length,0);
 }
 const good=await POST(new NextRequest(`${process.env.APP_ORIGIN}/api/proposal`,{method:'POST',headers:{origin:process.env.APP_ORIGIN!,cookie:`ekt_session=${s.id}`,'x-csrf-token':s.csrf,'content-type':'application/json'},body:JSON.stringify({lines:[{productId:'DEMO-C25',quantity:1}]})}),ctx('proposal'));assert.equal(good.status,200);
});
test('EKT-002 payment HTTP rejection does not expose or save text in state',async()=>{
 const s=runtime.cart.createSession();const sensitive=['4111','1111','1111','1111'].join(' ');
 const response=await POST(new NextRequest(`${process.env.APP_ORIGIN}/api/chat`,{method:'POST',headers:{origin:process.env.APP_ORIGIN!,cookie:`ekt_session=${s.id}`,'x-csrf-token':s.csrf,'content-type':'application/json'},body:JSON.stringify({text:`Номер карты ${sensitive}`})}),ctx('chat'));
 assert.equal(response.status,422);assert.equal((await response.text()).includes(sensitive),false);
 const state=await GET(new NextRequest(`${process.env.APP_ORIGIN}/api/state`,{headers:{cookie:`ekt_session=${s.id}`}}),ctx('state'));
 const value=await state.json();assert.equal(value.messages.length,0);assert.equal(JSON.stringify(value).includes(sensitive),false);
});

test('chat selection after a saved specification preserves excluded source lines',async()=>{
 const s=runtime.cart.createSession();const product=await runtime.catalog.get('DEMO-C25');
 runtime.cart.saveRequestedLines(s.id,[{id:'file',query:'DEMO-CABLE',quantity:2,unit:'м',source:'file',selection:'excluded',matches:[],status:'clarify'}]);
 runtime.cart.addMessage(s.id,{role:'assistant',text:'Найден товар',products:[{product,kind:'exact',reasons:[],differences:[]}]});
 const response=await POST(new NextRequest(`${process.env.APP_ORIGIN}/api/select`,{method:'POST',headers:{origin:process.env.APP_ORIGIN!,cookie:`ekt_session=${s.id}`,'x-csrf-token':s.csrf,'content-type':'application/json'},body:JSON.stringify({productId:product.id,quantity:2})}),ctx('select'));
 assert.equal(response.status,200);const value=await response.json();assert.equal(value.lines[0].selection,'excluded');assert.deepEqual(value.proposal.lines.map((line:{product:{id:string}})=>line.product.id),['DEMO-C25']);assert.equal(runtime.cart.getCart(s.id).lines.length,0);
});

test('selecting a new chat card keeps previously selected pending specification positions',async()=>{
 const s=runtime.cart.createSession();const cable=await runtime.catalog.get('DEMO-CABLE');const other=await runtime.catalog.get('DEMO-C25');
 runtime.cart.saveRequestedLines(s.id,[{id:'pending-file',query:cable.sku,quantity:2,unit:'м',source:'file',selection:'auto',selectedId:cable.id,matches:[{product:cable,kind:'exact',reasons:[],differences:[]}],status:'exact'}]);
 await runtime.cart.prepare(s.id,[{lineId:'pending-file',productId:cable.id,quantity:2}]);runtime.cart.addMessage(s.id,{role:'assistant',text:'Другой товар',products:[{product:other,kind:'exact',reasons:[],differences:[]}]});
 const response=await POST(new NextRequest(`${process.env.APP_ORIGIN}/api/select`,{method:'POST',headers:{origin:process.env.APP_ORIGIN!,cookie:`ekt_session=${s.id}`,'x-csrf-token':s.csrf,'content-type':'application/json'},body:JSON.stringify({productId:other.id,quantity:1})}),ctx('select'));
 assert.equal(response.status,200);assert.deepEqual((await response.json()).proposal.lines.map((line:{product:{id:string}})=>line.product.id),[cable.id,other.id]);assert.equal(runtime.cart.getCart(s.id).lines.length,0);
});
