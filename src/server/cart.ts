import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { z } from 'zod';
import type { Cart, CartPlan, Message, Product, Proposal, ProposalLine, RequestedLine } from '../shared/types';
import type { CatalogAdapter } from './catalog';
import { AppError } from './errors';
import { needsUnitReview } from '../shared/units';
import { assertSafeText, containsPaymentData, PAYMENT_REDACTED, safeStoredValue } from './privacy';
import { lineTotal, totalMoney, quantityMillis, quantitySum } from './money';
export { lineTotal } from './money';

type Session={id:string;csrf:string;createdAt:string};
type Selection={productId:string;quantity:number;requestedUnit?:string|null;unitConfirmed?:boolean;lineId?:string};
const selectionSchema=z.array(z.object({productId:z.string().min(1).max(80),quantity:z.number().positive().max(1_000_000),requestedUnit:z.string().max(30).nullable().optional(),unitConfirmed:z.boolean().optional(),lineId:z.string().max(100).optional()}).strict()).min(1).max(100);
const lineIdentity=(line:RequestedLine)=>JSON.stringify([line.id,line.query,line.quantity,line.rawUnit??line.unit,line.unit,line.selectedId,line.selection]);
const reviewKey=(line:RequestedLine,catalogUnit:string)=>createHash('sha256').update(lineIdentity(line)+catalogUnit).digest('hex');
const emptyCart=():Cart=>({lines:[],totalMinor:0,updatedAt:new Date().toISOString(),mode:'prototype',revision:0});
const fingerprint=(p:Product)=>JSON.stringify([p.id,p.sku,p.supplierSku,p.name,p.category,p.priceMinor,p.currency,p.stock,p.unit,p.minQuantity,p.packSize,p.attributes,p.warnings]);
export function validateQuantity(product:Product,quantity:number){
 quantityMillis(quantity);
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
export function planCart(cart:Cart,lines:ProposalLine[],operation:'add'|'replace'='add'):CartPlan{
 const resultLines=structuredClone(cart.lines);
 for(const line of lines){const index=resultLines.findIndex(l=>l.product.id===line.product.id);const existing=index<0?undefined:resultLines[index];const quantity=operation==='replace'?line.quantity:quantitySum(line.quantity,existing?.quantity??0);validateQuantity(line.product,quantity);const merged={...line,quantity,lineTotalMinor:lineTotal(line.product.priceMinor!,quantity)};if(index<0)resultLines.push(merged);else resultLines[index]=merged;}
 const beforeMinor=totalMoney(cart.lines),afterMinor=totalMoney(resultLines),addedMinor=totalMoney(lines);
 return{operation,cartRevision:cart.revision,beforeMinor,afterMinor,deltaMinor:afterMinor-beforeMinor,addedMinor,repricingMinor:operation==='add'?afterMinor-beforeMinor-addedMinor:0,resultLines};
}
export interface CartAdapter {getCart(sessionId:string):Cart;updateCart(sessionId:string,productId:string,quantity:number):Promise<Cart>;}
export class CartService implements CartAdapter {
 private db:DatabaseSync;
 constructor(path:string,private catalog:CatalogAdapter){
  if(path!==':memory:')mkdirSync(dirname(path),{recursive:true});this.db=new DatabaseSync(path);
  this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, csrf TEXT NOT NULL, created_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS carts(session_id TEXT PRIMARY KEY, body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS proposals(id TEXT PRIMARY KEY, session_id TEXT NOT NULL, body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY, session_id TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL);');
  this.db.exec('CREATE TABLE IF NOT EXISTS requested_lines(session_id TEXT PRIMARY KEY, body TEXT NOT NULL)');
 }
 close(){this.db.close();}
 createSession():Session {const cutoff=new Date(Date.now()-86400_000).toISOString();this.transaction(()=>{for(const table of ['messages','proposals','carts'])this.db.prepare(`DELETE FROM ${table} WHERE session_id IN (SELECT id FROM sessions WHERE created_at < ?)`).run(cutoff);this.db.prepare('DELETE FROM sessions WHERE created_at < ?').run(cutoff);});const s={id:randomBytes(32).toString('hex'),csrf:randomBytes(32).toString('hex'),createdAt:new Date().toISOString()};this.db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(s.id,s.csrf,s.createdAt);return s;}
 getSession(id:string):Session|null{const s=this.db.prepare('SELECT * FROM sessions WHERE id=?').get(id) as {id:string;csrf:string;created_at:string}|undefined;if(!s||Date.now()-Date.parse(s.created_at)>24*3600_000)return null;return{id:s.id,csrf:s.csrf,createdAt:s.created_at};}
 private own(sessionId:string){if(!this.getSession(sessionId))throw new AppError('SESSION','Сессия истекла. Обновите страницу.',401);}
 getCart(sessionId:string):Cart{this.own(sessionId);const row=this.db.prepare('SELECT body FROM carts WHERE session_id=?').get(sessionId) as {body:string}|undefined;const cart:Cart=row?JSON.parse(row.body):emptyCart();return{...cart,revision:cart.revision??0};}
 private saveCart(s:string,cart:Cart){this.db.prepare('INSERT INTO carts VALUES(?,?) ON CONFLICT(session_id) DO UPDATE SET body=excluded.body').run(s,JSON.stringify(cart));}
 private saveProposal(s:string,p:Proposal){this.db.prepare('INSERT INTO proposals VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(p.id,s,JSON.stringify(p));}
 getProposal(s:string,id:string):Proposal {this.own(s);const row=this.db.prepare('SELECT body FROM proposals WHERE id=? AND session_id=?').get(id,s) as {body:string}|undefined;if(!row)throw new AppError('PROPOSAL_NOT_FOUND','Предложение недоступно в этой сессии.',404);const p:Proposal=safeStoredValue(JSON.parse(row.body));if(containsPaymentData(row.body)&&p.status==='awaiting_confirmation')p.status='invalidated';return p;}
 currentProposal(s:string):Proposal|null {this.own(s);const row=this.db.prepare('SELECT id FROM proposals WHERE session_id=? ORDER BY rowid DESC LIMIT 1').get(s) as {id:string}|undefined;if(!row)return null;const p=this.getProposal(s,row.id);if(p.status==='awaiting_confirmation'&&Date.parse(p.expiresAt)<Date.now()){p.status='expired';this.saveProposal(s,p);}return p;}
 cancel(s:string,id:string):Proposal{return this.transaction(()=>{const p=this.getProposal(s,id);if(p.status==='awaiting_confirmation'){p.status='cancelled';this.saveProposal(s,p);}return p;});}
 messages(s:string):Message[]{this.own(s);return (this.db.prepare('SELECT body FROM messages WHERE session_id=? ORDER BY created_at ASC,rowid ASC').all(s) as {body:string}[]).map(x=>{const m:Message=JSON.parse(x.body);return containsPaymentData(x.body)?{id:m.id,role:m.role,createdAt:m.createdAt,text:PAYMENT_REDACTED}:m;});}
 addMessage(s:string,message:Omit<Message,'id'|'createdAt'>):Message{this.own(s);assertSafeText(JSON.stringify(message));const m={...message,id:randomUUID(),createdAt:new Date().toISOString()};this.db.prepare('INSERT INTO messages VALUES(?,?,?,?)').run(m.id,s,JSON.stringify(m),m.createdAt);return m;}
 private transaction<T>(fn:()=>T):T{this.db.exec('BEGIN IMMEDIATE');try{const result=fn();this.db.exec('COMMIT');return result;}catch(error){this.db.exec('ROLLBACK');throw error;}}
 requestedLines(s:string):RequestedLine[]{this.own(s);const row=this.db.prepare('SELECT body FROM requested_lines WHERE session_id=?').get(s) as {body:string}|undefined;return row?safeStoredValue(JSON.parse(row.body)):[];}
 saveRequestedLines(s:string,lines:RequestedLine[]):RequestedLine[]{this.own(s);assertSafeText(JSON.stringify(lines));return this.transaction(()=>{const old=this.requestedLines(s);const next=lines.map(line=>{const previous=old.find(item=>item.id===line.id);const retained=previous&&line.unitConfirmed!==false&&lineIdentity(previous)===lineIdentity(line);return{...line,unitConfirmed:retained?previous.unitConfirmed:false,unitReviewKey:retained?previous.unitReviewKey:undefined};});this.db.prepare('INSERT INTO requested_lines VALUES(?,?) ON CONFLICT(session_id) DO UPDATE SET body=excluded.body').run(s,JSON.stringify(next));const pending=this.currentProposal(s);if(pending?.status==='awaiting_confirmation'){pending.status='invalidated';this.saveProposal(s,pending);}return next;});}
 async reviewRequestedUnit(s:string,id:string):Promise<RequestedLine[]>{const before=this.requestedLines(s);const line=before.find(l=>l.id===id);if(!line?.selectedId||line.selection==='excluded')throw new AppError('UNIT_REVIEW','Сначала выберите товар для строки.');const product=await this.catalog.get(line.selectedId,true);if(!product.unit)throw new AppError('UNIT_REVIEW','Единица каталога неизвестна. Нужна проверка менеджером.');validateQuantity(product,line.quantity);return this.transaction(()=>{const lines=this.requestedLines(s);const current=lines.find(l=>l.id===id);if(!current||lineIdentity(current)!==lineIdentity(line))throw new AppError('STATE','Строка изменилась. Проверьте единицы заново.',409);current.unitConfirmed=true;current.unitReviewKey=reviewKey(current,product.unit!);this.db.prepare('UPDATE requested_lines SET body=? WHERE session_id=?').run(JSON.stringify(lines),s);return lines;});}
 async prepare(s:string,input:Selection[],excluded:string[]=[],expectedPreviousId?:string,operation:'add'|'replace'='add'):Promise<Proposal>{
  this.own(s);assertSafeText(JSON.stringify({input,excluded}));const selections=selectionSchema.parse(input);const quantities=new Map<string,number>();for(const x of selections)quantities.set(x.productId,quantitySum(x.quantity,quantities.get(x.productId)??0));
  const draft=this.requestedLines(s);
  if(draft.length&&operation==='add')for(const selection of selections){const source=draft.find(l=>l.id===selection.lineId);if(!source||source.selection==='excluded'||source.selectedId!==selection.productId||source.quantity!==selection.quantity)throw new AppError('SOURCE_CONTEXT','Выбор строки изменился. Сопоставьте позиции заново.',409);selection.requestedUnit=source.rawUnit??source.unit??null;selection.unitConfirmed=source.unitConfirmed;}
  const cart=this.getCart(s);const lines:ProposalLine[]=[];
  for(const [id,quantity] of quantities){const p=await this.catalog.get(id,true);const sourceLines=selections.filter(x=>x.productId===id);if(!p.unit)throw new AppError('UNIT_REVIEW','Неизвестная единица каталога. Добавление требует проверки менеджером.');for(const line of sourceLines){const stored=draft.find(l=>l.id===line.lineId);const reviewed=stored?stored.unitReviewKey===reviewKey(stored,p.unit):line.unitConfirmed===true;if(needsUnitReview(line.requestedUnit,p.unit)&&!reviewed)throw new AppError('UNIT_REVIEW','Проверьте несовпадение единиц и общее количество в единицах каталога. Автоматический пересчёт упаковок не выполняется.');}validateQuantity(p,quantity);const requestedUnit=[...new Set(sourceLines.map(x=>x.requestedUnit?.trim()).filter(Boolean))].join(' / ');lines.push({product:p,quantity,lineTotalMinor:lineTotal(p.priceMinor!,quantity),sourceLineIds:sourceLines.map(x=>x.lineId).filter((id):id is string=>!!id),...(requestedUnit?{requestedUnit,unitConfirmed:sourceLines.every(x=>!needsUnitReview(x.requestedUnit,p.unit)||x.unitConfirmed===true)}:{})});}
  const plan=planCart(cart,lines,operation);
  const createdAt=new Date().toISOString();const p:Proposal={id:randomUUID(),version:1,hash:'',contractVersion:2,plan,status:'awaiting_confirmation',lines,totalMinor:totalMoney(lines),createdAt,expiresAt:new Date(Date.now()+10*60_000).toISOString(),excluded:excluded.slice(0,100).map(x=>x.slice(0,400))};p.hash=createHash('sha256').update(JSON.stringify([s,p.id,p.version,p.lines,p.plan,p.expiresAt])).digest('hex');
  return this.transaction(()=>{if(operation==='add'&&JSON.stringify(this.requestedLines(s))!==JSON.stringify(draft))throw new AppError('SOURCE_CONTEXT','Строки изменились. Подготовьте новое предложение.',409);if(this.getCart(s).revision!==cart.revision)throw new AppError('CART_CHANGED','Корзина изменилась. Подготовьте предложение заново.',409);const old=this.currentProposal(s);if(expectedPreviousId&&old?.id!==expectedPreviousId)throw new AppError('STATE','Уже подготовлено новое предложение. Проверьте его.',409);if(old&&old.status==='awaiting_confirmation'){old.status='invalidated';this.saveProposal(s,old);}this.saveProposal(s,p);return p;});
 }
 async confirm(s:string,input:{proposalId:string;version:number;hash:string;confirmed:boolean}):Promise<{proposal:Proposal;cart:Cart}>{
  this.own(s);if(input.confirmed!==true)throw new AppError('CONFIRMATION_REQUIRED','Нужно явное подтверждение показанного предложения.');
  const proposal=this.getProposal(s,input.proposalId);
  const check=(p:Proposal)=>{if(p.version!==input.version||p.hash!==input.hash)throw new AppError('VERSION','Версия предложения изменилась. Проверьте новый состав.',409);if(p.status==='committed')return;if(p.status!=='awaiting_confirmation')throw new AppError('STATE','Предложение уже не действует. Подготовьте новое.',409);if(p.contractVersion!==2||!p.plan){p.status='invalidated';this.saveProposal(s,p);throw new AppError('VERSION','Прежнее предложение устарело. Подготовьте новое с полным расчётом корзины.',409);}if(Date.parse(p.expiresAt)<Date.now()){p.status='expired';this.saveProposal(s,p);throw new AppError('EXPIRED','Срок предложения истёк. Подготовьте новое.',409);}};
  check(proposal);if(proposal.status==='committed')return{proposal,cart:proposal.committedCart??this.getCart(s)};
  const current:Product[]=[];for(const l of proposal.lines)current.push(await this.catalog.get(l.product.id,true));
  if(this.getCart(s).revision!==proposal.plan!.cartRevision||current.some((p,i)=>fingerprint(p)!==fingerprint(proposal.lines[i].product))){
   const alreadyCommitted=this.transaction(()=>{const latest=this.getProposal(s,input.proposalId);check(latest);if(latest.status==='committed')return latest;latest.status='invalidated';this.saveProposal(s,latest);return null;});
   if(alreadyCommitted)return{proposal:alreadyCommitted,cart:alreadyCommitted.committedCart??this.getCart(s)};
   let replacement:Proposal|undefined;try{replacement=await this.prepare(s,proposal.lines.flatMap<Selection>((l,i)=>l.sourceLineIds?.length?l.sourceLineIds.map(id=>{const source=this.requestedLines(s).find(row=>row.id===id);if(!source)throw new AppError('SOURCE_CONTEXT','Строка изменена.',409);return{lineId:id,productId:l.product.id,quantity:source.quantity};}):[{productId:l.product.id,quantity:l.quantity,requestedUnit:l.requestedUnit,unitConfirmed:l.unitConfirmed&&l.product.unit===current[i].unit}]),proposal.excluded,proposal.id,proposal.plan!.operation);}catch{/* Stock or units may no longer support a replacement, or a newer proposal already exists. */}throw new AppError('DATA_CHANGED','Цена, остаток или корзина изменились. Проверьте обновлённое предложение и подтвердите заново.',409,replacement?{proposal:replacement}:undefined);
  }
  return this.transaction(()=>{const p=this.getProposal(s,input.proposalId);check(p);const cart=this.getCart(s);if(p.status==='committed')return{proposal:p,cart:p.committedCart??cart};if(cart.revision!==p.plan!.cartRevision)throw new AppError('CART_CHANGED','Корзина изменилась. Проверьте новое предложение.',409);const checked=planCart(cart,p.lines,p.plan!.operation);if(JSON.stringify(checked)!==JSON.stringify(p.plan))throw new AppError('VERSION','Расчёт предложения изменился. Подготовьте новое.',409);cart.lines=checked.resultLines;cart.totalMinor=checked.afterMinor;cart.revision++;cart.updatedAt=new Date().toISOString();p.status='committed';p.committedCart=structuredClone(cart);this.saveCart(s,cart);this.saveProposal(s,p);return{proposal:p,cart};});
 }
 async updateCart(s:string,id:string,quantity:number,expectedRevision?:number):Promise<Cart>{
  this.own(s);if(!Number.isFinite(quantity)||quantity<0)throw new AppError('QUANTITY','Некорректное количество.');
  const before=this.getCart(s);if(expectedRevision!==undefined&&before.revision!==expectedRevision)throw new AppError('CART_CHANGED','Корзина изменилась. Обновите состояние.',409);
  const existing=before.lines.find(l=>l.product.id===id);if(!existing)throw new AppError('NOT_FOUND','Позиция не найдена в вашей корзине.',404);
  const product=quantity>0?await this.catalog.get(id,true):null;if(product)validateQuantity(product,quantity);
  if(product&&fingerprint(product)!==fingerprint(existing.product)){const proposal=await this.prepare(s,[{productId:id,quantity,requestedUnit:existing.requestedUnit,unitConfirmed:existing.unitConfirmed}],[],undefined,'replace');throw new AppError('DATA_CHANGED','Данные товара изменились. Проверьте предложение изменения корзины и подтвердите заново.',409,{proposal});}
  return this.transaction(()=>{const cart=this.getCart(s);if(cart.revision!==before.revision)throw new AppError('CART_CHANGED','Корзина изменилась. Обновите состояние.',409);const line=cart.lines.find(l=>l.product.id===id)!;if(product){line.product=product;line.quantity=quantity;line.lineTotalMinor=lineTotal(product.priceMinor!,quantity);}else cart.lines=cart.lines.filter(l=>l.product.id!==id);cart.totalMinor=totalMoney(cart.lines);cart.revision++;cart.updatedAt=new Date().toISOString();this.saveCart(s,cart);const p=this.currentProposal(s);if(p?.status==='awaiting_confirmation'){p.status='invalidated';this.saveProposal(s,p);}return cart;});
 }
}
