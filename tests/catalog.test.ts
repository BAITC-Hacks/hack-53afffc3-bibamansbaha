import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Catalog, normalizeProduct, moneyMinor, safeUrl } from '../src/server/catalog';
test('missing stock is unknown, identifiers keep zeroes, unsafe links are rejected',()=>{
 const p=normalizeProduct({id:'001',article:'000A',name:'Sample',price:null,image:'javascript:alert(1)'});
 assert.equal(p.stock,null);assert.equal(p.priceMinor,null);assert.equal(p.sku,'000A');assert.equal(p.id,'001');assert.equal(p.image,null);assert.equal(safeUrl('https://evil.example/test'),null);
 assert.equal(moneyMinor('12.35'),1235);
});
test('alternatives require matching critical attributes and positive stock',async()=>{
 const c=new Catalog('fixture');const original=await c.get('DEMO-C16-OUT');const alternatives=await c.alternatives(original);
 assert.deepEqual(alternatives.map(x=>x.product.id),['DEMO-C16-IN']);
 assert.deepEqual(await c.alternatives(await c.get('DEMO-NO-ALT')),[]);
});
test('undocumented KRATNOST_MIN does not become a guessed minimum or package size',()=>{
 const p=normalizeProduct({id:1,article:'A',name:'Sample',price:12,quantity:30,properties:{KRATNOST_MIN:'6'}});
 assert.equal(p.minQuantity,null);assert.equal(p.packSize,null);assert.equal(p.attributes['KRATNOST_MIN (поле источника)'],'6');
});
