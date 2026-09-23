import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Catalog } from '../src/server/catalog';
import { CartService } from '../src/server/cart';
import { matchRequestedLines } from '../src/server/requested-lines';

test('EKT-003/004 unresolved source units cannot be bypassed in a direct proposal and edits invalidate review', async (t) => {
  const catalog=new Catalog('fixture'); const service=new CartService(':memory:',catalog);t.after(()=>service.close());const s=service.createSession();
  const lines=await matchRequestedLines(catalog,[{id:'source',query:'DEMO-CABLE',quantity:2,unit:'бухта',source:'Synthetic CSV'}],[]);
  service.saveRequestedLines(s.id,lines);
  await assert.rejects(()=>service.prepare(s.id,[{productId:'DEMO-CABLE',quantity:2,unitConfirmed:true}]),{code:'SOURCE_CONTEXT'});
  const selection={lineId:'source',productId:'DEMO-CABLE',quantity:2};
  await assert.rejects(()=>service.prepare(s.id,[{...selection,requestedUnit:'м',unitConfirmed:true}]),{code:'UNIT_REVIEW'});
  const edited=lines.map(l=>({...l,quantity:20}));service.saveRequestedLines(s.id,edited);
  await service.reviewRequestedUnit(s.id,'source');
  const p=await service.prepare(s.id,[{...selection,quantity:20}]);assert.equal(p.lines[0].requestedUnit,'бухта');assert.equal(p.lines[0].quantity,20);
  service.saveRequestedLines(s.id,edited.map(l=>({...l,quantity:21})));
  await assert.rejects(()=>service.prepare(s.id,[{...selection,quantity:21,unitConfirmed:true}]),{code:'UNIT_REVIEW'});
  assert.equal(service.getCart(s.id).lines.length,0);
});

test('EKT-008 explicit exclusion survives rematch and server reload and cannot appear in the cart', async (t) => {
  const catalog=new Catalog('fixture');const service=new CartService(':memory:',catalog);t.after(()=>service.close());const s=service.createSession();
  const initial=await matchRequestedLines(catalog,[{id:'a',query:'DEMO-C25',quantity:3,unit:'шт',source:'new file'},{id:'b',query:'DEMO-CABLE',quantity:0.5,unit:'м',source:'new file'}],[]);
  const excluded=initial.map(l=>l.id==='a'?{...l,selectedId:undefined,selection:'excluded' as const}:l);
  service.saveRequestedLines(s.id,excluded);
  const matched=await matchRequestedLines(catalog,service.requestedLines(s.id),service.requestedLines(s.id));service.saveRequestedLines(s.id,matched);
  assert.equal(service.requestedLines(s.id)[0].selectedId,undefined);
  await assert.rejects(()=>service.prepare(s.id,[{lineId:'a',productId:'DEMO-C25',quantity:3}]),{code:'SOURCE_CONTEXT'});
  const p=await service.prepare(s.id,[{lineId:'b',productId:'DEMO-CABLE',quantity:0.5}],['DEMO-C25']);
  await service.confirm(s.id,{proposalId:p.id,version:p.version,hash:p.hash,confirmed:true});
  assert.deepEqual(service.getCart(s.id).lines.map(l=>l.product.id),['DEMO-CABLE']);
  const restored=await matchRequestedLines(catalog,matched.map(l=>l.id==='a'?{...l,selection:'manual',selectedId:'DEMO-C25'}:l),matched);
  assert.equal(restored[0].selectedId,'DEMO-C25');
});
