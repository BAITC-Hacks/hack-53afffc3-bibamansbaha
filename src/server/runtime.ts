import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { Catalog } from './catalog';
import { CartService, type SessionSnapshot } from './cart';
import { pgTransaction, postgres } from './postgres';
import { AppError } from './errors';
type Services={catalog:Catalog;cart:CartService};
const requestServices = new AsyncLocalStorage<Services>();
const catalog = new Catalog();
let localCart: CartService | undefined;
export const runtime = {
 get catalog(){return requestServices.getStore()?.catalog ?? catalog;},
 get cart(){const current=requestServices.getStore();if(current)return current.cart;if(process.env.DATABASE_URL||process.env.VERCEL)throw new AppError('STORAGE_CONTEXT','Хранилище требует контекст запроса.',503);return localCart??=new CartService(process.env.DATABASE_PATH??'.data/ekt.sqlite',catalog);},
};
async function rateLimit(key:string,limit:number){
 const window=Math.floor(Date.now()/60000);
 const result=await postgres().query('INSERT INTO ekt_rate_limits(key,bucket,count) VALUES($1,$2,1) ON CONFLICT(key,bucket) DO UPDATE SET count=ekt_rate_limits.count+1 RETURNING count',[key,window]);
 if(result.rows[0].count>limit)throw new AppError('RATE_LIMIT','Слишком много запросов. Подождите минуту.',429);
 await postgres().query('DELETE FROM ekt_rate_limits WHERE bucket<$1',[window-2]);
}
export async function withPersistence<T>(request:NextRequest,action:()=>Promise<T>):Promise<T>{
 if(!process.env.DATABASE_URL){if(process.env.VERCEL)throw new AppError('DATABASE_CONFIG','Постоянное хранилище не настроено.',503);return action();}
 const ip=process.env.VERCEL?request.headers.get('x-vercel-forwarded-for')??'unknown':'local';
 await rateLimit('ip:'+createHash('sha256').update(ip).digest('hex'),60);
 const supplied=request.cookies.get('ekt_session')?.value;
 const id=supplied&&/^[a-f0-9]{64}$/.test(supplied)?supplied:undefined;
 if(id)await rateLimit('session:'+id,40);
 if(!id)await postgres().query('DELETE FROM ekt_sessions WHERE expires_at<now()');
 return pgTransaction(async client=>{
  const cart=new CartService(':memory:',catalog);
  try{
   if(id){const result=await client.query('SELECT state FROM ekt_sessions WHERE id=$1 AND expires_at>now() FOR UPDATE',[id]);if(result.rows[0])cart.restoreSession(result.rows[0].state as SessionSnapshot);}
   const result=await requestServices.run({catalog,cart},action);
   const snapshot=cart.exportSession();
   if(snapshot){const s=snapshot.session;await client.query('INSERT INTO ekt_sessions(id,created_at,expires_at,state) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT(id) DO UPDATE SET state=excluded.state,revision=ekt_sessions.revision+1',[s.id,s.createdAt,new Date(Date.parse(s.createdAt)+86400000).toISOString(),JSON.stringify(snapshot)]);}
   return result;
  }finally{cart.close();}
 });
}
