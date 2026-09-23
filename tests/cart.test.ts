import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CartService } from '../src/server/cart';
import { Catalog } from '../src/server/catalog';
import { unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

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
test('a slow conflicting confirmation cannot overwrite a completed concurrent commit',async()=>{
 const catalog=new Catalog('fixture');const get=catalog.get.bind(catalog);
 const s=new CartService(':memory:',catalog);const a=s.createSession();const p=await s.prepare(a.id,[{productId:'DEMO-C16-IN',quantity:1}]);
 let release:()=>void=()=>{};const barrier=new Promise<void>(resolve=>{release=resolve;});let calls=0;
 catalog.get=async(id:string)=>{const item=await get(id);if(++calls===1){await barrier;item.priceMinor=210000;}return item;};
 const input={proposalId:p.id,version:1,hash:p.hash,confirmed:true};const slow=s.confirm(a.id,input);const fast=await s.confirm(a.id,input);release();const repeated=await slow;
 assert.equal(fast.proposal.status,'committed');assert.equal(repeated.proposal.status,'committed');assert.equal(s.getProposal(a.id,p.id).status,'committed');assert.equal(s.getCart(a.id).lines[0].quantity,1);s.close();
});
test('technical identity change invalidates the proposal even if price stays equal',async()=>{
 const c=new Catalog('fixture');const get=c.get.bind(c);let changed=false;c.get=async(id:string)=>{const p=await get(id);if(changed)p.name='Changed technical identity';return p;};
 const s=new CartService(':memory:',c);const a=s.createSession();const p=await s.prepare(a.id,[{productId:'DEMO-C16-IN',quantity:1}]);changed=true;
 await assert.rejects(()=>s.confirm(a.id,{proposalId:p.id,hash:p.hash,version:1,confirmed:true}),/изменились/);assert.equal(s.getCart(a.id).lines.length,0);s.close();
});
test('quantity change cannot silently approve a newly increased unit price',async()=>{
 const c=new Catalog('fixture');const get=c.get.bind(c);let changed=false;c.get=async(id:string)=>{const p=await get(id);if(changed)p.priceMinor=999900;return p;};
 const s=new CartService(':memory:',c);const a=s.createSession();const p=await s.prepare(a.id,[{productId:'DEMO-C16-IN',quantity:2}]);await s.confirm(a.id,{proposalId:p.id,hash:p.hash,version:1,confirmed:true});changed=true;
 await assert.rejects(()=>s.updateCart(a.id,'DEMO-C16-IN',1),/изменились/);assert.equal(s.getCart(a.id).totalMinor,390000);s.close();
});

test('expired and cancelled proposals never change the cart',async(t)=>{
 t.mock.timers.enable({apis:['Date'],now:Date.now()});
 const s=new CartService(':memory:',new Catalog('fixture'));const a=s.createSession();
 const p=await s.prepare(a.id,[{productId:'DEMO-C16-IN',quantity:1}]);
 t.mock.timers.tick(10*60_000+1);
 await assert.rejects(()=>s.confirm(a.id,{proposalId:p.id,hash:p.hash,version:1,confirmed:true}),/истёк/);
 assert.equal(s.getCart(a.id).lines.length,0);
 const next=await s.prepare(a.id,[{productId:'DEMO-C16-IN',quantity:2}]);s.cancel(a.id,next.id);
 await assert.rejects(()=>s.confirm(a.id,{proposalId:next.id,hash:next.hash,version:1,confirmed:true}),/не действует/);
 assert.equal(s.getCart(a.id).lines.length,0);s.close();
});

test('confirmed cart and session survive closing and reopening the database',async()=>{
 const path=join(tmpdir(),`ekt-cart-test-${randomUUID()}.sqlite`);
 let s=new CartService(path,new Catalog('fixture'));
 try {
  const a=s.createSession();const p=await s.prepare(a.id,[{productId:'DEMO-CABLE',quantity:2.5}]);
  await s.confirm(a.id,{proposalId:p.id,hash:p.hash,version:1,confirmed:true});s.close();
  s=new CartService(path,new Catalog('fixture'));
  assert.equal(s.getSession(a.id)?.csrf,a.csrf);assert.equal(s.getCart(a.id).totalMinor,112500);
  const replay=await s.confirm(a.id,{proposalId:p.id,hash:p.hash,version:1,confirmed:true});
  assert.equal(replay.cart.lines[0].quantity,2.5);
 } finally {s.close();unlinkSync(path);}
});

test('source units cannot silently become catalog units',async()=>{
 const catalog=new Catalog('fixture');const s=new CartService(':memory:',catalog);const a=s.createSession();
 await assert.rejects(()=>s.prepare(a.id,[{productId:'DEMO-CABLE',quantity:2,requestedUnit:'упак'}]),/единиц/);
 const p=await s.prepare(a.id,[{productId:'DEMO-CABLE',quantity:20,requestedUnit:'упак',unitConfirmed:true}]);
 assert.equal(p.lines[0].requestedUnit,'упак');assert.equal(p.lines[0].quantity,20);
 const equal=await s.prepare(a.id,[{productId:'DEMO-CABLE',quantity:2,requestedUnit:'m'}]);assert.equal(equal.totalMinor,90000);
 const get=catalog.get.bind(catalog);catalog.get=async(id:string)=>({...await get(id),unit:null});
 await assert.rejects(()=>s.prepare(a.id,[{productId:'DEMO-C16-IN',quantity:2,requestedUnit:'шт'}]),/единиц/);
 assert.equal(s.getCart(a.id).lines.length,0);s.close();
});

test('price refresh retains reviewed source units and never converts quantities',async()=>{
 const catalog=new Catalog('fixture');const get=catalog.get.bind(catalog);let changed=false;
 catalog.get=async(id:string)=>{const p=await get(id);if(changed)p.priceMinor=46000;return p;};
 const s=new CartService(':memory:',catalog);const a=s.createSession();
 const p=await s.prepare(a.id,[{productId:'DEMO-CABLE',quantity:20,requestedUnit:'упак',unitConfirmed:true}]);changed=true;
 await assert.rejects(()=>s.confirm(a.id,{proposalId:p.id,hash:p.hash,version:1,confirmed:true}),/изменились/);
 const replacement=s.currentProposal(a.id)!;assert.equal(replacement.lines[0].requestedUnit,'упак');assert.equal(replacement.lines[0].quantity,20);assert.equal(replacement.totalMinor,920000);assert.equal(s.getCart(a.id).lines.length,0);s.close();
});
