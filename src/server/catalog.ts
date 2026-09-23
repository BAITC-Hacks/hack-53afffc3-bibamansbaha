import { z } from 'zod';
import type { CatalogMode, Product, Match } from '../shared/types';
import { AppError } from './errors';
import { get as httpsGet } from 'node:https';

// Keep the previously verified connection-close transport. Safe stage timings and
// one caller-wide deadline below distinguish transport time from page/detail work.
type TransportTiming=(stage:'fetchMs'|'readMs',milliseconds:number)=>void;
export type CatalogTransport=(url:URL,authorization:string,signal:AbortSignal,timing:TransportTiming)=>Promise<unknown>;
const getCatalogJson:CatalogTransport=(url,authorization,signal,timing)=>new Promise((resolve,reject)=>{
 const started=performance.now();let headersAt:number|undefined,finished=false;
 const finish=(error?:unknown,value?:unknown)=>{if(finished)return;finished=true;timing(headersAt===undefined?'fetchMs':'readMs',performance.now()-(headersAt??started));if(error)reject(error);else resolve(value);};
 const req=httpsGet(url,{signal,headers:{Authorization:authorization,Accept:'application/json','User-Agent':'EKT-Assistant/0.1',Connection:'close'},timeout:8000},response=>{
  headersAt=performance.now();timing('fetchMs',headersAt-started);
  if(response.statusCode!==200){finish(new AppError('CATALOG_UNAVAILABLE',`Каталог недоступен (HTTP ${response.statusCode}).`,503));response.destroy();return;}
  const chunks:Buffer[]=[];let bytes=0;
  response.on('data',(chunk:Buffer)=>{bytes+=chunk.length;if(bytes>3_000_000){req.destroy(new Error('Response too large'));return;}chunks.push(chunk);});
  response.on('error',error=>finish(error));response.on('aborted',()=>finish(new Error('Catalog response interrupted')));
  response.on('end',()=>{try{finish(undefined,JSON.parse(Buffer.concat(chunks).toString('utf8')));}catch{finish(new AppError('CATALOG_SCHEMA','Каталог вернул неподдерживаемый формат.',503));}});
 });req.on('timeout',()=>req.destroy(new Error('Catalog timeout')));req.on('error',error=>finish(error));
});

const object = z.object({ id:z.union([z.string(),z.number()]),name:z.string(),article:z.string(),price:z.union([z.number(),z.string()]).nullable().optional() }).passthrough();
const pageSchema=z.object({page:z.number(),per_page:z.number(),count:z.number(),items:z.array(object)});
const numeric=(value:unknown):number|null=> {if(value===null||value===undefined||value==='')return null;const n=Number(String(value).replace(',','.'));return Number.isFinite(n)&&n>=0?n:null;};
export function safeUrl(value:unknown):string|null {try{const u=new URL(String(value));return u.protocol==='https:'&&u.hostname==='ekt.kz'?u.href:null;}catch{return null;}}
export const normalize=(s:string)=>s.toLocaleLowerCase('ru').replace(/ё/g,'е').replace(/\s+/g,' ').trim();
export function moneyMinor(value:unknown):number|null { const s=String(value??'').replace(',','.');if(!/^\d+(\.\d{1,2})?$/.test(s))return null;const [a,b='']=s.split('.');const n=BigInt(a)*100n+BigInt(b.padEnd(2,'0'));return n<=BigInt(Number.MAX_SAFE_INTEGER)?Number(n):null; }
export function normalizeProduct(input:unknown,mode:CatalogMode='live',fetchedAt=new Date().toISOString()):Product {
 const raw=object.parse(input); const props=(raw.properties&&typeof raw.properties==='object'?raw.properties:{}) as Record<string,unknown>;
 const attributes:Record<string,string>={};
 const names:Record<string,string>={TORGOVAYA_MARKA:'Бренд',KOLICHESTVO_POLYUSOV:'Полюсы',NOMINALNYY_TOK:'Ток',NOMINALNOE_NAPRYAZHENIE:'Напряжение',NOMINALNAYA_OTKLYUCHAYUSHCHAYA_SPOSOBNOST:'Отключающая способность',TIP_USTANOVKI:'Монтаж'};
 for(const [key,label] of Object.entries(names))if(typeof props[key]==='string')attributes[label]=props[key] as string;
 if(props.KRATNOST_MIN!==undefined)attributes['KRATNOST_MIN (поле источника)']=String(props.KRATNOST_MIN);
 const warnings:string[]=[];
 const nameCurrent=raw.name.match(/(?:^|\s)(\d+)\s*[АA](?:\s|$)/);const propCurrent=String(props.NOMINALNYY_TOK??'').match(/\d+/);
 if(nameCurrent&&propCurrent&&nameCurrent[1]!==propCurrent[0])warnings.push('Противоречие источника: ток в названии и характеристиках различается. Подбор аналога требует проверки менеджером.');
 warnings.push('Единица измерения не предоставлена API; количество — в единицах каталога. Общий остаток не гарантирует наличие в вашем городе.');
 if((numeric(props.KRATNOST_MIN)??0)>1)warnings.push('Кратность или минимум требует уточнения: семантика KRATNOST_MIN не документирована.');
 const source=`https://ekt.kz/api/products/detail?id=${encodeURIComponent(String(raw.id))}`;
 return {id:String(raw.id),sku:raw.article,supplierSku:typeof props.ARTIKULPOSTAVSHCHIKA==='string'?props.ARTIKULPOSTAVSHCHIKA:undefined,name:raw.name,category:typeof props.OBYEM==='string'?props.OBYEM:'Каталог EKT',priceMinor:moneyMinor(raw.price),currency:'KZT',unit:null,stock:numeric(raw.quantity),warehouses:Array.isArray(raw.stores)?raw.stores.map((s:Record<string,unknown>)=>({name:String(s.name??'Склад'),quantity:numeric(s.quantity)})):[],attributes,image:safeUrl(raw.image),url:safeUrl(raw.url),certificates:[],evidence:[{source,field:'article, price, quantity, stores, properties',fetchedAt},{source:'https://ekt.kz/',field:'Валюта цен сайта: тенге; API currency не возвращает',fetchedAt}],warnings,minQuantity:null,packSize:null,mode};
}
export function fixtureProducts():Product[]{
 const at=new Date().toISOString();
 const make=(id:string,name:string,stock:number|null,price:number,attributes:Record<string,string>,unit='шт'):Product=>({id,sku:id,name,category:unit==='м'?'Кабель':'Модульный автомат',priceMinor:price,currency:'KZT',unit,stock,warehouses:[{name:'Демонстрационный склад',quantity:stock}],attributes,image:null,url:null,certificates:[],evidence:[{source:'fixture:synthetic-catalog',field:'Синтетические данные для демонстрации; не каталог ekt.kz',fetchedAt:at}],warnings:['Демонстрационный товар, цена и остаток.'],minQuantity:unit==='м'?0.1:1,packSize:unit==='м'?null:1,mode:'fixture'});
 const attrs={'Ток':'16 А','Полюсы':'1','Характеристика':'C','Напряжение':'230 В','Отключающая способность':'6 кА'};
 return [make('DEMO-C16-OUT','Демо автомат C16, 1P, 6 кА — исходная позиция',0,180000,{...attrs,Бренд:'Учебный A'}),make('DEMO-C16-IN','Демо автомат C16, 1P, 6 кА — аналог',25,195000,{...attrs,Бренд:'Учебный B'}),make('DEMO-C25','Демо автомат C25, 1P, 6 кА',10,230000,{...attrs,Ток:'25 А'}),make('DEMO-CABLE','Демо кабель ВВГнг-LS 3×2,5 мм²',120.5,45000,{'Жилы':'3','Сечение':'2,5 мм²','Материал':'Медь','Исполнение':'нг-LS'},'м'),make('DEMO-UNKNOWN','Демо товар с неизвестным остатком',null,100000,{}),make('DEMO-NO-ALT','Демо автомат D63, 3P — замена не найдена',0,900000,{...attrs,Ток:'63 А',Полюсы:'3',Характеристика:'D'})];
}
export interface CatalogAdapter {get(id:string,fresh?:boolean):Promise<Product>;search(query:string):Promise<Match[]>;status():{mode:CatalogMode;count:number;fetchedAt:string|null;partial:boolean;error?:string};}
type CatalogOptions={transport?:CatalogTransport;now?:()=>number;operationTimeoutMs?:number};
type CatalogOperation={controller:AbortController;deadlineAt:number};
const cacheTtlMs=120_000;
let instanceSequence=0;
export class Catalog implements CatalogAdapter {
 private products=new Map<string,Product>();private list:Product[]=[];private fetchedAt:string|null=null;private loading:Promise<void>|null=null;private lastError:string|undefined;private detailLoads=new Map<string,Promise<Product>>();
 private readonly now:()=>number;private readonly operationTimeoutMs:number;
 private readonly counters={instanceId:++instanceSequence,operations:0,cacheHits:0,cacheMisses:0,loadJoins:0,detailJoins:0,pages:0,httpAttempts:0};
 private readonly timings={fetchMs:0,readMs:0,normalizeMs:0,searchMs:0,detailMs:0,totalMs:0};
 private lastOperation:{kind:string;elapsedMs:number;outcome:'ok'|'error';code?:string}|null=null;
 readonly mode:CatalogMode;
 constructor(mode=(process.env.CATALOG_MODE??'fixture') as CatalogMode,private options:CatalogOptions={}){
  if(!['fixture','live','snapshot'].includes(mode))throw new Error('Invalid CATALOG_MODE');this.mode=mode;this.now=options.now??Date.now;
  const configured=options.operationTimeoutMs??Number(process.env.CATALOG_OPERATION_TIMEOUT_MS??6000);this.operationTimeoutMs=Number.isFinite(configured)?Math.min(30_000,Math.max(25,configured)):6000;
  if(mode==='fixture'){this.list=fixtureProducts();this.list.forEach(p=>this.products.set(p.id,p));this.fetchedAt=new Date(this.now()).toISOString();}
 }
 /** Safe cumulative counters only: no queries, product IDs, response bodies or authorization. */
 diagnostics(){return{mode:this.mode,...this.counters,timings:{...this.timings},operationTimeoutMs:this.operationTimeoutMs,cacheTtlMs,cacheAgeMs:this.fetchedAt?Math.max(0,this.now()-Date.parse(this.fetchedAt)):null,lastOperation:this.lastOperation?{...this.lastOperation}:null};}
 private check(operation:CatalogOperation){if(operation.controller.signal.aborted||this.now()>=operation.deadlineAt){operation.controller.abort();throw new AppError('CATALOG_TIMEOUT','Каталог не ответил за отведённое время. Повторите запрос; корзина не изменена.',503);}}
 private async wait<T>(pending:Promise<T>,operation:CatalogOperation):Promise<T>{
  const signal=operation.controller.signal;
  return new Promise<T>((resolve,reject)=>{const abort=()=>reject(new AppError('CATALOG_TIMEOUT','Каталог не ответил за отведённое время. Повторите запрос; корзина не изменена.',503));pending.then(value=>{signal.removeEventListener('abort',abort);try{this.check(operation);resolve(value);}catch(error){reject(error);}},error=>{signal.removeEventListener('abort',abort);reject(error);});try{this.check(operation);signal.addEventListener('abort',abort,{once:true});}catch(error){reject(error);}});
 }
 private async operation<T>(kind:string,run:(operation:CatalogOperation)=>Promise<T>):Promise<T>{
  const started=this.now(),controller=new AbortController();const operation={controller,deadlineAt:started+this.operationTimeoutMs};const timer=setTimeout(()=>controller.abort(),this.operationTimeoutMs);this.counters.operations++;
  try{const value=await run(operation);this.check(operation);this.lastOperation={kind,elapsedMs:this.now()-started,outcome:'ok'};return value;}
  catch(error){const failure=error instanceof z.ZodError?new AppError('CATALOG_SCHEMA','Каталог вернул неподдерживаемый формат.',503):error;this.lastOperation={kind,elapsedMs:this.now()-started,outcome:'error',code:failure instanceof AppError?failure.code:'CATALOG_UNAVAILABLE'};throw failure;}
  finally{clearTimeout(timer);this.timings.totalMs+=this.now()-started;}
 }
 private async request(path:string,operation:CatalogOperation):Promise<unknown>{
  const base=process.env.EKT_API_BASE_URL??'https://ekt.kz';if(new URL(base).origin!=='https://ekt.kz')throw new AppError('CATALOG_CONFIG','Разрешён только официальный origin каталога.',503);
  if(!process.env.EKT_API_USERNAME||!process.env.EKT_API_PASSWORD)throw new AppError('CATALOG_AUTH','Доступ к каталогу не настроен.',503);
  for(let attempt=0;attempt<2;attempt++){
   this.check(operation);this.counters.httpAttempts++;
   try{return await this.wait((this.options.transport??getCatalogJson)(new URL(path,base),`Basic ${Buffer.from(`${process.env.EKT_API_USERNAME}:${process.env.EKT_API_PASSWORD}`).toString('base64')}`,operation.controller.signal,(stage,ms)=>{this.timings[stage]+=ms;}),operation);}
   catch(error){this.check(operation);if(attempt===1)throw error instanceof AppError?error:new AppError('CATALOG_UNAVAILABLE','Каталог не ответил. Попробуйте позже; корзина не изменена.',503);}
  }
  throw new Error('Unreachable');
 }
 async load(){return this.operation('load',operation=>this.loadWithin(operation));}
 private async loadWithin(operation:CatalogOperation){
  this.check(operation);
  if(this.mode==='fixture')return;
  if(this.mode==='snapshot')throw new AppError('SNAPSHOT_UNAVAILABLE','Локальный проверенный snapshot не настроен.',503);
  if(this.fetchedAt&&this.now()-Date.parse(this.fetchedAt)<cacheTtlMs){this.counters.cacheHits++;return;}
  if(this.loading){this.counters.loadJoins++;return this.wait(this.loading,operation);}
  this.counters.cacheMisses++;
  this.loading=(async()=>{try{const unique=new Map<string,Product>();const pages=Math.min(5,Math.max(1,Number(process.env.CATALOG_MAX_PAGES)||2));for(let page=1;page<=pages;page++){this.check(operation);this.counters.pages++;const raw=await this.request(`/api/products?page=${page}`,operation);const started=this.now();const data=pageSchema.parse(raw);for(const p of data.items){const n=normalizeProduct(p,'live',new Date(this.now()).toISOString());unique.set(n.id,n);}this.timings.normalizeMs+=this.now()-started;if(data.items.length<data.per_page)break;}this.check(operation);this.list=[...unique.values()];this.fetchedAt=new Date(this.now()).toISOString();this.lastError=undefined;}catch(error){this.lastError=error instanceof AppError?error.message:'Каталог вернул неподдерживаемые данные.';throw error;}finally{this.loading=null;}})();return this.loading;
 }
 async get(id:string,fresh=false){return this.operation('detail',operation=>this.getWithin(id,fresh,operation));}
 private async getWithin(id:string,fresh:boolean,operation:CatalogOperation):Promise<Product>{
  this.check(operation);if(this.mode==='snapshot')throw new AppError('SNAPSHOT_UNAVAILABLE','Snapshot не настроен.',503);if(this.mode==='fixture'){const product=this.products.get(id);if(!product)throw new AppError('NOT_FOUND','Товар не найден.',404);return structuredClone(product);}if(!/^\d{1,15}$/.test(id))throw new AppError('NOT_FOUND','Некорректный ID товара.',404);
  const cached=this.products.get(id);if(!fresh&&cached&&this.now()-Date.parse(cached.evidence[0].fetchedAt)<cacheTtlMs){this.counters.cacheHits++;return structuredClone(cached);}
  const key=`${fresh?'fresh':'read'}:${id}`,existing=this.detailLoads.get(key);if(existing){this.counters.detailJoins++;return structuredClone(await this.wait(existing,operation));}this.counters.cacheMisses++;
  const started=this.now();const pending=(async()=>{try{const raw=await this.request(`/api/products/detail?id=${encodeURIComponent(id)}`,operation);const normalizeStarted=this.now();const p=normalizeProduct(raw,'live',new Date(this.now()).toISOString());this.timings.normalizeMs+=this.now()-normalizeStarted;if(p.id!==id)throw new AppError('CATALOG_SCHEMA','Каталог вернул другой товар.',503);this.check(operation);this.products.set(id,p);return p;}finally{this.timings.detailMs+=this.now()-started;}})();this.detailLoads.set(key,pending);
  try{return structuredClone(await this.wait(pending,operation));}finally{if(this.detailLoads.get(key)===pending)this.detailLoads.delete(key);}
 }
 status(){return {mode:this.mode,count:this.list.length,fetchedAt:this.fetchedAt,partial:this.mode!=='fixture',...(this.lastError?{error:this.lastError}:{})};}
 async search(query:string):Promise<Match[]>{return this.operation('search',async operation=>{await this.loadWithin(operation);const started=this.now();const q=normalize(query);if(!q)return[];const exact=this.list.filter(p=>[p.sku,p.id,p.supplierSku].some(x=>x&&normalize(x)===q));const tokens=q.split(/\s+/).filter(t=>t.length>1);const candidates=exact.length?exact:this.list.map(p=>({p,score:tokens.filter(t=>normalize(`${p.sku} ${p.name}`).includes(t)).length})).filter(x=>x.score>0).sort((a,b)=>b.score-a.score).slice(0,5).map(x=>x.p);this.timings.searchMs+=this.now()-started;const result:Match[]=[];for(const p of candidates.slice(0,5)){result.push({product:await this.getWithin(p.id,false,operation),reasons:[exact.length?'Артикул или ID совпадает точно':'Кандидат по тексту; проверьте характеристики'],differences:[],kind:exact.length?'exact':'candidate'});}return result;});}
 async alternatives(product:Product):Promise<Match[]>{return this.operation('alternatives',async operation=>{await this.loadWithin(operation);if(product.warnings.some(w=>w.startsWith('Противоречие')))return[];const keys=product.category.includes('Кабель')?['Жилы','Сечение','Материал','Исполнение']:['Ток','Полюсы','Характеристика','Напряжение','Отключающая способность'];if(keys.some(k=>!product.attributes[k]))return[];const matches:Match[]=[];for(const item of this.list.filter(p=>p.id!==product.id&&p.category===product.category).slice(0,12)){const p=await this.getWithin(item.id,false,operation);if(p.stock===null||p.stock<=0||p.warnings.some(w=>w.startsWith('Противоречие')))continue;if(keys.every(k=>normalize(p.attributes[k]??'')===normalize(product.attributes[k]))){matches.push({product:p,kind:'alternative',reasons:keys.map(k=>`${k}: ${p.attributes[k]} — совпадает`),differences:p.attributes['Бренд']!==product.attributes['Бренд']?[`Бренд: ${product.attributes['Бренд']??'не указан'} → ${p.attributes['Бренд']??'не указан'}`]:[]});}}return matches.slice(0,3);});}
}
