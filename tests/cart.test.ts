import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CartService } from '../src/server/cart';
import { Catalog } from '../src/server/catalog';

test('a proposal leaves cart empty; explicit confirmation persists exactly once',async()=>{
 const service=new CartService(':memory:',new Catalog('fixture'));
 const session=service.createSession();
 const p=await service.prepare(session.id,[{productId:'DEMO-C16-IN',quantity:2}],[]);
 assert.equal(service.getCart(session.id).lines.length,0);
 await assert.rejects(()=>service.confirm(session.id,{proposalId:p.id,version:p.version,hash:p.hash,confirmed:false}),/подтверждение/);
 const confirmed=await service.confirm(session.id,{proposalId:p.id,version:p.version,hash:p.hash,confirmed:true});
 assert.equal(confirmed.cart.totalMinor,390000);
 const replay=await service.confirm(session.id,{proposalId:p.id,version:p.version,hash:p.hash,confirmed:true});
 assert.equal(replay.cart.lines[0].quantity,2);
 service.close();
});

test('another session cannot confirm or read the proposal',async()=>{
 const s=new CartService(':memory:',new Catalog('fixture'));const a=s.createSession();const b=s.createSession();
 const p=await s.prepare(a.id,[{productId:'DEMO-C16-IN',quantity:1}]);
 await assert.rejects(()=>s.confirm(b.id,{proposalId:p.id,hash:p.hash,version:1,confirmed:true}),/недоступно/);
 assert.equal(s.getCart(b.id).lines.length,0);s.close();
});
test('combined cart stock and fractional units are validated',async()=>{
 const s=new CartService(':memory:',new Catalog('fixture'));const a=s.createSession();
 const p=await s.prepare(a.id,[{productId:'DEMO-C16-IN',quantity:24}]);
 await s.confirm(a.id,{proposalId:p.id,hash:p.hash,version:1,confirmed:true});
 await assert.rejects(()=>s.prepare(a.id,[{productId:'DEMO-C16-IN',quantity:2}]),/превышает/);
 await assert.rejects(()=>s.prepare(a.id,[{productId:'DEMO-C16-IN',quantity:0.5}]),/целое/);
 const cable=await s.prepare(a.id,[{productId:'DEMO-CABLE',quantity:2.5}]);
 assert.equal(cable.totalMinor,112500);s.close();
});
test('unknown stock, zero stock and superseded proposals cannot commit',async()=>{
 const s=new CartService(':memory:',new Catalog('fixture'));const a=s.createSession();
 await assert.rejects(()=>s.prepare(a.id,[{productId:'DEMO-UNKNOWN',quantity:1}]),/неизвестен/);
 await assert.rejects(()=>s.prepare(a.id,[{productId:'DEMO-C16-OUT',quantity:1}]),/превышает/);
 const old=await s.prepare(a.id,[{productId:'DEMO-C16-IN',quantity:1}]);
 await s.prepare(a.id,[{productId:'DEMO-C16-IN',quantity:2}]);
 await assert.rejects(()=>s.confirm(a.id,{proposalId:old.id,hash:old.hash,version:1,confirmed:true}),/не действует/);s.close();
});
test('changed source price requires a new explicit confirmation',async()=>{
 const catalog=new Catalog('fixture');const baseGet=catalog.get.bind(catalog);let changed=false;
 catalog.get=async(id:string)=>{const p=await baseGet(id);if(changed)p.priceMinor=210000;return p;};
 const s=new CartService(':memory:',catalog);const a=s.createSession();const p=await s.prepare(a.id,[{productId:'DEMO-C16-IN',quantity:1}]);changed=true;
 await assert.rejects(()=>s.confirm(a.id,{proposalId:p.id,hash:p.hash,version:1,confirmed:true}),/изменились/);
 assert.equal(s.getCart(a.id).lines.length,0);assert.equal(s.currentProposal(a.id)?.totalMinor,210000);s.close();
});
