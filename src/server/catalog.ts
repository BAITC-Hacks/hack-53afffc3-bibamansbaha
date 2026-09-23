import { z } from 'zod';
import type { CatalogMode, Product, Match } from '../shared/types';
import { AppError } from './errors';

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
 const warnings:string[]=[];
 const nameCurrent=raw.name.match(/(?:^|\s)(\d+)\s*[АA](?:\s|$)/);const propCurrent=String(props.NOMINALNYY_TOK??'').match(/\d+/);
 if(nameCurrent&&propCurrent&&nameCurrent[1]!==propCurrent[0])warnings.push('Противоречие источника: ток в названии и характеристиках различается. Подбор аналога требует проверки менеджером.');
 warnings.push('Единица измерения не предоставлена API; количество — в единицах каталога. Общий остаток не гарантирует наличие в вашем городе.');
 const source=`https://ekt.kz/api/products/detail?id=${encodeURIComponent(String(raw.id))}`;
 return {id:String(raw.id),sku:raw.article,supplierSku:typeof props.ARTIKULPOSTAVSHCHIKA==='string'?props.ARTIKULPOSTAVSHCHIKA:undefined,name:raw.name,category:typeof props.OBYEM==='string'?props.OBYEM:'Каталог EKT',priceMinor:moneyMinor(raw.price),currency:'KZT',unit:null,stock:numeric(raw.quantity),warehouses:Array.isArray(raw.stores)?raw.stores.map((s:Record<string,unknown>)=>({name:String(s.name??'Склад'),quantity:numeric(s.quantity)})):[],attributes,image:safeUrl(raw.image),url:safeUrl(raw.url),certificates:[],evidence:[{source,field:'article, price, quantity, stores, properties',fetchedAt},{source:'https://ekt.kz/',field:'Валюта цен сайта: тенге; API currency не возвращает',fetchedAt}],warnings,minQuantity:numeric(props.KRATNOST_MIN),packSize:null,mode};
}
export function fixtureProducts():Product[]{
 const at=new Date().toISOString();
 const make=(id:string,name:string,stock:number|null,price:number,attributes:Record<string,string>,unit='шт'):Product=>({id,sku:id,name,category:unit==='м'?'Кабель':'Модульный автомат',priceMinor:price,currency:'KZT',unit,stock,warehouses:[{name:'Демонстрационный склад',quantity:stock}],attributes,image:null,url:null,certificates:[],evidence:[{source:'fixture:synthetic-catalog',field:'Синтетические данные для демонстрации; не каталог ekt.kz',fetchedAt:at}],warnings:['Демонстрационный товар, цена и остаток.'],minQuantity:unit==='м'?0.1:1,packSize:unit==='м'?null:1,mode:'fixture'});
 const attrs={'Ток':'16 А','Полюсы':'1','Характеристика':'C','Напряжение':'230 В','Отключающая способность':'6 кА'};
 return [make('DEMO-C16-OUT','Демо автомат C16, 1P, 6 кА — исходная позиция',0,180000,{...attrs,Бренд:'Учебный A'}),make('DEMO-C16-IN','Демо автомат C16, 1P, 6 кА — аналог',25,195000,{...attrs,Бренд:'Учебный B'}),make('DEMO-C25','Демо автомат C25, 1P, 6 кА',10,230000,{...attrs,Ток:'25 А'}),make('DEMO-CABLE','Демо кабель ВВГнг-LS 3×2,5 мм²',120.5,45000,{'Жилы':'3','Сечение':'2,5 мм²','Материал':'Медь','Исполнение':'нг-LS'},'м'),make('DEMO-UNKNOWN','Демо товар с неизвестным остатком',null,100000,{}),make('DEMO-NO-ALT','Демо автомат D63, 3P — замена не найдена',0,900000,{...attrs,Ток:'63 А',Полюсы:'3',Характеристика:'D'})];
}
export interface CatalogAdapter {get(id:string,fresh?:boolean):Promise<Product>;search(query:string):Promise<Match[]>;status():{mode:CatalogMode;count:number;fetchedAt:string|null;partial:boolean;error?:string};}
export class Catalog implements CatalogAdapter {
 private products=new Map<string,Product>();private list:Product[]=[];private fetchedAt:string|null=null;private loading:Promise<void>|null=null;private lastError:string|undefined;
 readonly mode:CatalogMode;
 constructor(mode=(process.env.CATALOG_MODE??'fixture') as CatalogMode){if(!['fixture','live','snapshot'].includes(mode))throw new Error('Invalid CATALOG_MODE');this.mode=mode;if(mode==='fixture'){this.list=fixtureProducts();this.list.forEach(p=>this.products.set(p.id,p));this.fetchedAt=new Date().toISOString();}}
 private async request(path:string):Promise<unknown>{
  const base=process.env.EKT_API_BASE_URL??'https://ekt.kz';if(new URL(base).origin!=='https://ekt.kz')throw new AppError('CATALOG_CONFIG','Разрешён только официальный origin каталога.',503);
  if(!process.env.EKT_API_USERNAME||!process.env.EKT_API_PASSWORD)throw new AppError('CATALOG_AUTH','Доступ к каталогу не настроен.',503);
  for(let attempt=0;attempt<2;attempt++)try{const response=await fetch(new URL(path,base),{headers:{Authorization:`Basic ${Buffer.from(`${process.env.EKT_API_USERNAME}:${process.env.EKT_API_PASSWORD}`).toString('base64')}`,Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(8000),cache:'no-store'});if(!response.ok)throw new AppError('CATALOG_UNAVAILABLE',`Каталог недоступен (HTTP ${response.status}).`,503);const body=await response.text();if(body.length>3_000_000)throw new Error('Response too large');return JSON.parse(body);}catch(error){if(attempt===1)throw error instanceof AppError?error:new AppError('CATALOG_UNAVAILABLE','Каталог не ответил. Попробуйте позже; корзина не изменена.',503);}
  throw new Error('Unreachable');
 }
 async load(){
  if(this.mode==='fixture')return;
  if(this.mode==='snapshot')throw new AppError('SNAPSHOT_UNAVAILABLE','Локальный проверенный snapshot не настроен.',503);
  if(this.fetchedAt&&Date.now()-Date.parse(this.fetchedAt)<120_000)return;
  if(this.loading)return this.loading;
  this.loading=(async()=>{try{const unique=new Map<string,Product>();const pages=Math.min(5,Math.max(1,Number(process.env.CATALOG_MAX_PAGES)||2));for(let page=1;page<=pages;page++){const data=pageSchema.parse(await this.request(`/api/products?page=${page}`));for(const p of data.items){const n=normalizeProduct(p);unique.set(n.id,n);}if(data.items.length<data.per_page)break;}this.list=[...unique.values()];this.fetchedAt=new Date().toISOString();this.lastError=undefined;}catch(error){this.lastError=error instanceof Error?error.message:'Ошибка каталога';throw error;}finally{this.loading=null;}})();return this.loading;
 }
 async get(id:string,fresh=false){if(this.mode==='fixture'){const product=this.products.get(id);if(!product)throw new AppError('NOT_FOUND','Товар не найден.',404);return structuredClone(product);}if(!/^\d{1,15}$/.test(id))throw new AppError('NOT_FOUND','Некорректный ID товара.',404);const cached=this.products.get(id);if(!fresh&&cached&&Date.now()-Date.parse(cached.evidence[0].fetchedAt)<120_000)return cached;const raw=await this.request(`/api/products/detail?id=${encodeURIComponent(id)}`);const p=normalizeProduct(raw);if(p.id!==id)throw new AppError('CATALOG_SCHEMA','Каталог вернул другой товар.',503);this.products.set(id,p);return p;}
 status(){return {mode:this.mode,count:this.list.length,fetchedAt:this.fetchedAt,partial:this.mode!=='fixture',...(this.lastError?{error:this.lastError}:{})};}
 async search(query:string){await this.load();const q=normalize(query);if(!q)return[];const exact=this.list.filter(p=>[p.sku,p.id,p.supplierSku].some(x=>x&&normalize(x)===q));const tokens=q.split(/\s+/).filter(t=>t.length>1);const candidates=exact.length?exact:this.list.map(p=>({p,score:tokens.filter(t=>normalize(`${p.sku} ${p.name}`).includes(t)).length})).filter(x=>x.score>0).sort((a,b)=>b.score-a.score).slice(0,5).map(x=>x.p);const result:Match[]=[];for(const p of candidates.slice(0,5)){result.push({product:await this.get(p.id),reasons:[exact.length?'Артикул или ID совпадает точно':'Кандидат по тексту; проверьте характеристики'],differences:[],kind:exact.length?'exact':'candidate'});}return result;}
 async alternatives(product:Product):Promise<Match[]>{await this.load();if(product.warnings.some(w=>w.startsWith('Противоречие')))return[];const keys=product.category.includes('Кабель')?['Жилы','Сечение','Материал','Исполнение']:['Ток','Полюсы','Характеристика','Напряжение','Отключающая способность'];if(keys.some(k=>!product.attributes[k]))return[];const matches:Match[]=[];for(const item of this.list.filter(p=>p.id!==product.id&&p.category===product.category).slice(0,12)){const p=await this.get(item.id);if(p.stock===null||p.stock<=0||p.warnings.some(w=>w.startsWith('Противоречие')))continue;if(keys.every(k=>normalize(p.attributes[k]??'')===normalize(product.attributes[k]))){matches.push({product:p,kind:'alternative',reasons:keys.map(k=>`${k}: ${p.attributes[k]} — совпадает`),differences:p.attributes['Бренд']!==product.attributes['Бренд']?[`Бренд: ${product.attributes['Бренд']??'не указан'} → ${p.attributes['Бренд']??'не указан'}`]:[]});}}return matches.slice(0,3);}
}
