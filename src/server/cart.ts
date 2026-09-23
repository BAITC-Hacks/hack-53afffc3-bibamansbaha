import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { z } from 'zod';
import type { Cart, Message, Product, Proposal, ProposalLine } from '../shared/types';
import type { CatalogAdapter } from './catalog';
import { AppError } from './errors';
import { needsUnitReview } from '../shared/units';

type Session={id:string;csrf:string;createdAt:string};
type Selection={productId:string;quantity:number;requestedUnit?:string|null;unitConfirmed?:boolean};
const selectionSchema=z.array(z.object({productId:z.string().min(1).max(80),quantity:z.number().positive().max(1_000_000),requestedUnit:z.string().max(30).nullable().optional(),unitConfirmed:z.boolean().optional()}).strict()).min(1).max(100);
const emptyCart=():Cart=>({lines:[],totalMinor:0,updatedAt:new Date().toISOString(),mode:'prototype'});
const fingerprint=(p:Product)=>JSON.stringify([p.id,p.sku,p.supplierSku,p.name,p.category,p.priceMinor,p.currency,p.stock,p.unit,p.minQuantity,p.packSize,p.attributes,p.warnings]);
export function lineTotal(priceMinor:number,quantity:number){return Number((BigInt(priceMinor)*BigInt(Math.round(quantity*1000))+500n)/1000n);}
export function validateQuantity(product:Product,quantity:number){
 if(product.warnings.some(w=>w.startsWith('Кратность или минимум')))throw new AppError('UNKNOWN_PACK_SIZE','Уточните кратность/минимум у менеджера: поле источника не документировано.');
 if(!Number.isFinite(quantity)||quantity<=0||quantity>1_000_000||Math.abs(quantity*1000-Math.round(quantity*1000))>0.000001)throw new AppError('QUANTITY','Укажите положительное количество, не более трёх знаков после запятой.');
 if((product.unit===null||product.unit==='шт')&&!Number.isInteger(quantity))throw new AppError('QUANTITY','Для этого товара доступно только целое количество.');
 if(product.stock===null)throw new AppError('UNKNOWN_STOCK','Остаток неизвестен. Добавление заблокировано до проверки.');
 if(quantity>product.stock)throw new AppError('INSUFFICIENT_STOCK','Количество с учётом корзины превышает доступный остаток.');
 if(product.minQuantity!==null&&quantity<product.minQuantity)throw new AppError('MIN_QUANTITY',`Минимальное количество по источнику: ${product.minQuantity}.`);
 if(product.packSize!==null&&Math.abs(quantity/product.packSize-Math.round(quantity/product.packSize))>0.000001)throw new AppError('PACK_SIZE',`Кратность упаковки: ${product.packSize}.`);
 if(product.priceMinor===null)throw new AppError('UNKNOWN_PRICE','Цена не предоставлена источником.');
 if(product.mode==='snapshot')throw new AppError('STALE','Исторические данные нельзя подтвердить как актуальные.');
}
export interface CartAdapter {getCart(sessionId:string):Cart;updateCart(sessionId:string,productId:string,quantity:number):Promise<Cart>;}
export class CartService implements CartAdapter {
 private db:DatabaseSync;
 constructor(path:string,private catalog:CatalogAdapter){
  if(path!==':memory:')mkdirSync(dirname(path),{recursive:true});this.db=new DatabaseSync(path);
  this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, csrf TEXT NOT NULL, created_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS carts(session_id TEXT PRIMARY KEY, body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS proposals(id TEXT PRIMARY KEY, session_id TEXT NOT NULL, body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY, session_id TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL);');
 }
 close(){this.db.close();}
 createSession():Session {const cutoff=new Date(Date.now()-86400_000).toISOString();this.transaction(()=>{for(const table of ['messages','proposals','carts'])this.db.prepare(`DELETE FROM ${table} WHERE session_id IN (SELECT id FROM sessions WHERE created_at < ?)`).run(cutoff);this.db.prepare('DELETE FROM sessions WHERE created_at < ?').run(cutoff);});const s={id:randomBytes(32).toString('hex'),csrf:randomBytes(32).toString('hex'),createdAt:new Date().toISOString()};this.db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(s.id,s.csrf,s.createdAt);return s;}
 getSession(id:string):Session|null{const s=this.db.prepare('SELECT * FROM sessions WHERE id=?').get(id) as {id:string;csrf:string;created_at:string}|undefined;if(!s||Date.now()-Date.parse(s.created_at)>24*3600_000)return null;return{id:s.id,csrf:s.csrf,createdAt:s.created_at};}
 private own(sessionId:string){if(!this.getSession(sessionId))throw new AppError('SESSION','Сессия истекла. Обновите страницу.',401);}
 getCart(sessionId:string):Cart{this.own(sessionId);const row=this.db.prepare('SELECT body FROM carts WHERE session_id=?').get(sessionId) as {body:string}|undefined;return row?JSON.parse(row.body):emptyCart();}
 private saveCart(s:string,cart:Cart){this.db.prepare('INSERT INTO carts VALUES(?,?) ON CONFLICT(session_id) DO UPDATE SET body=excluded.body').run(s,JSON.stringify(cart));}
 private saveProposal(s:string,p:Proposal){this.db.prepare('INSERT INTO proposals VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(p.id,s,JSON.stringify(p));}
 getProposal(s:string,id:string):Proposal {this.own(s);const row=this.db.prepare('SELECT body FROM proposals WHERE id=? AND session_id=?').get(id,s) as {body:string}|undefined;if(!row)throw new AppError('PROPOSAL_NOT_FOUND','Предложение недоступно в этой сессии.',404);return JSON.parse(row.body);}
 currentProposal(s:string):Proposal|null {this.own(s);const rows=this.db.prepare('SELECT body FROM proposals WHERE session_id=? ORDER BY rowid DESC LIMIT 1').all(s) as {body:string}[];if(!rows.length)return null;const p:Proposal=JSON.parse(rows[0].body);if(p.status==='awaiting_confirmation'&&Date.parse(p.expiresAt)<Date.now()){p.status='expired';this.saveProposal(s,p);}return p;}
 cancel(s:string,id:string):Proposal{return this.transaction(()=>{const p=this.getProposal(s,id);if(p.status==='awaiting_confirmation'){p.status='cancelled';this.saveProposal(s,p);}return p;});}
 messages(s:string):Message[]{this.own(s);return (this.db.prepare('SELECT body FROM messages WHERE session_id=? ORDER BY created_at ASC,rowid ASC').all(s) as {body:string}[]).map(x=>JSON.parse(x.body));}
 addMessage(s:string,message:Omit<Message,'id'|'createdAt'>):Message{this.own(s);const m={...message,id:randomUUID(),createdAt:new Date().toISOString()};this.db.prepare('INSERT INTO messages VALUES(?,?,?,?)').run(m.id,s,JSON.stringify(m),m.createdAt);return m;}
 private transaction<T>(fn:()=>T):T{this.db.exec('BEGIN IMMEDIATE');try{const result=fn();this.db.exec('COMMIT');return result;}catch(error){this.db.exec('ROLLBACK');throw error;}}
 async prepare(s:string,input:Selection[],excluded:string[]=[],expectedPreviousId?:string):Promise<Proposal>{
  this.own(s);const selections=selectionSchema.parse(input);const quantities=new Map<string,number>();for(const x of selections)quantities.set(x.productId,(quantities.get(x.productId)??0)+x.quantity);
  const cart=this.getCart(s);const lines:ProposalLine[]=[];
  for(const [id,quantity] of quantities){const p=await this.catalog.get(id,true);const sourceLines=selections.filter(x=>x.productId===id);for(const line of sourceLines)if(needsUnitReview(line.requestedUnit,p.unit)&&line.unitConfirmed!==true)throw new AppError('UNIT_REVIEW','Проверьте несовпадение единиц и количество в единицах каталога. Автоматический пересчёт упаковок не выполняется.');validateQuantity(p,quantity);validateQuantity(p,quantity+(cart.lines.find(l=>l.product.id===id)?.quantity??0));const requestedUnit=[...new Set(sourceLines.map(x=>x.requestedUnit?.trim()).filter(Boolean))].join(' / ');lines.push({product:p,quantity,lineTotalMinor:lineTotal(p.priceMinor!,quantity),...(requestedUnit?{requestedUnit,unitConfirmed:sourceLines.every(x=>!needsUnitReview(x.requestedUnit,p.unit)||x.unitConfirmed===true)}:{})});}
  const createdAt=new Date().toISOString();const p:Proposal={id:randomUUID(),version:1,hash:'',status:'awaiting_confirmation',lines,totalMinor:lines.reduce((s,l)=>s+l.lineTotalMinor,0),createdAt,expiresAt:new Date(Date.now()+10*60_000).toISOString(),excluded:excluded.slice(0,100).map(x=>x.slice(0,400))};p.hash=createHash('sha256').update(JSON.stringify([s,p.id,p.version,p.lines,p.expiresAt])).digest('hex');
  return this.transaction(()=>{const old=this.currentProposal(s);if(expectedPreviousId&&old?.id!==expectedPreviousId)throw new AppError('STATE','Уже подготовлено новое предложение. Проверьте его.',409);if(old&&old.status==='awaiting_confirmation'){old.status='invalidated';this.saveProposal(s,old);}this.saveProposal(s,p);return p;});
 }
 async confirm(s:string,input:{proposalId:string;version:number;hash:string;confirmed:boolean}):Promise<{proposal:Proposal;cart:Cart}>{
  this.own(s);if(input.confirmed!==true)throw new AppError('CONFIRMATION_REQUIRED','Нужно явное подтверждение показанного предложения.');
  const proposal=this.getProposal(s,input.proposalId);
  const check=(p:Proposal)=>{if(p.version!==input.version||p.hash!==input.hash)throw new AppError('VERSION','Версия предложения изменилась. Проверьте новый состав.',409);if(p.status==='committed')return;if(p.status!=='awaiting_confirmation')throw new AppError('STATE','Предложение уже не действует. Подготовьте новое.',409);if(Date.parse(p.expiresAt)<Date.now()){p.status='expired';this.saveProposal(s,p);throw new AppError('EXPIRED','Срок предложения истёк. Подготовьте новое.',409);}};
  check(proposal);if(proposal.status==='committed')return{proposal,cart:this.getCart(s)};
  const current:Product[]=[];for(const l of proposal.lines)current.push(await this.catalog.get(l.product.id,true));
  if(current.some((p,i)=>fingerprint(p)!==fingerprint(proposal.lines[i].product))){
   const alreadyCommitted=this.transaction(()=>{const latest=this.getProposal(s,input.proposalId);check(latest);if(latest.status==='committed')return latest;latest.status='invalidated';this.saveProposal(s,latest);return null;});
   if(alreadyCommitted)return{proposal:alreadyCommitted,cart:this.getCart(s)};
   let replacement:Proposal|undefined;try{replacement=await this.prepare(s,proposal.lines.map((l,i)=>({productId:l.product.id,quantity:l.quantity,requestedUnit:l.requestedUnit,unitConfirmed:l.unitConfirmed&&l.product.unit===current[i].unit})),proposal.excluded,proposal.id);}catch{/* Stock or units may no longer support a replacement, or a newer proposal already exists. */}throw new AppError('DATA_CHANGED','Цена или остаток изменились. Проверьте обновлённое предложение и подтвердите заново.',409,replacement?{proposal:replacement}:undefined);
  }
  return this.transaction(()=>{const p=this.getProposal(s,input.proposalId);check(p);const cart=this.getCart(s);if(p.status==='committed')return{proposal:p,cart};for(let i=0;i<p.lines.length;i++){const line=p.lines[i];const item=current[i];const existing=cart.lines.find(l=>l.product.id===item.id);const quantity=line.quantity+(existing?.quantity??0);validateQuantity(item,quantity);const merged={product:item,quantity,lineTotalMinor:lineTotal(item.priceMinor!,quantity)};if(existing)Object.assign(existing,merged);else cart.lines.push(merged);}cart.totalMinor=cart.lines.reduce((sum,l)=>sum+l.lineTotalMinor,0);cart.updatedAt=new Date().toISOString();p.status='committed';this.saveCart(s,cart);this.saveProposal(s,p);return{proposal:p,cart};});
 }
 async updateCart(s:string,id:string,quantity:number):Promise<Cart>{this.own(s);if(!Number.isFinite(quantity)||quantity<0)throw new AppError('QUANTITY','Некорректное количество.');const product=quantity>0?await this.catalog.get(id,true):null;if(product)validateQuantity(product,quantity);return this.transaction(()=>{const cart=this.getCart(s);const line=cart.lines.find(l=>l.product.id===id);if(!line)throw new AppError('NOT_FOUND','Позиция не найдена в вашей корзине.',404);if(product){if(fingerprint(product)!==fingerprint(line.product))throw new AppError('DATA_CHANGED','Данные товара изменились. Состав корзины сохранён. Удалите эту позицию и подтвердите новое предложение с актуальными данными.',409);line.product=product;line.quantity=quantity;line.lineTotalMinor=lineTotal(product.priceMinor!,quantity);}else cart.lines=cart.lines.filter(l=>l.product.id!==id);cart.totalMinor=cart.lines.reduce((sum,l)=>sum+l.lineTotalMinor,0);cart.updatedAt=new Date().toISOString();this.saveCart(s,cart);const p=this.currentProposal(s);if(p?.status==='awaiting_confirmation'){p.status='invalidated';this.saveProposal(s,p);}return cart;});}
}
