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
