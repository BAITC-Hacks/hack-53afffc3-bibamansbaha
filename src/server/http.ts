import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { AppError } from './errors';
import { runtime } from './runtime';
import { ZodError } from 'zod';
import { AttachmentError } from './attachments';
const requestCounts=new Map<string,{at:number;count:number}>();
let newSessions={at:Date.now(),count:0};
export function session(request:NextRequest,create=true){const id=request.cookies.get('ekt_session')?.value;const existing=id?runtime.cart.getSession(id):null;if(existing)return existing;if(!create)throw new AppError('SESSION','Сессия отсутствует или истекла. Обновите страницу.',401);if(Date.now()-newSessions.at>60_000)newSessions={at:Date.now(),count:0};if(++newSessions.count>100)throw new AppError('RATE_LIMIT','Слишком много новых сессий. Повторите через минуту.',429);return runtime.cart.createSession();}
export function authorize(request:NextRequest,s:{id:string;csrf:string}){
 const origin=request.headers.get('origin');const allowed=process.env.APP_ORIGIN??'http://127.0.0.1:3000';
 if(!origin||origin!==allowed||request.headers.get('sec-fetch-site')==='cross-site')throw new AppError('CSRF','Источник запроса не разрешён. Обновите страницу.',403);
 const token=request.headers.get('x-csrf-token')??'';const actual=Buffer.from(token);const expected=Buffer.from(s.csrf);if(!/^[a-f0-9]{64}$/.test(token)||actual.length!==expected.length||!timingSafeEqual(actual,expected))throw new AppError('CSRF','Обновите страницу и повторите действие.',403);
 const bucket=requestCounts.get(s.id);if(!bucket||Date.now()-bucket.at>60_000){requestCounts.set(s.id,{at:Date.now(),count:1});if(requestCounts.size>1000)for(const [key,value]of requestCounts)if(Date.now()-value.at>60_000)requestCounts.delete(key);}else if(++bucket.count>40)throw new AppError('RATE_LIMIT','Слишком много запросов. Подождите минуту.',429);
}
export function reply(data:unknown,s?:{id:string},status=200){const r=NextResponse.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin'}});if(s)r.cookies.set('ekt_session',s.id,{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',maxAge:86400,path:'/'});return r;}
export function failure(error:unknown){if(error instanceof AppError)return reply({error:error.message,code:error.code,...error.details},undefined,error.status);if(error instanceof ZodError)return reply({error:'Проверьте формат, количество и выбранные позиции.',code:'VALIDATION'},undefined,400);if(error instanceof AttachmentError||error instanceof Error&&'code'in error&&error.code==='MODEL_UNAVAILABLE')return reply({error:error.message,code:error.code},undefined,400);return reply({error:'Не удалось выполнить действие. Корзина не изменена; повторите запрос.',code:'INTERNAL'},undefined,500);}
export async function boundedBody(request:NextRequest,limit=100_000){const length=Number(request.headers.get('content-length'));if(length>limit)throw new AppError('FILE_LIMIT','Запрос слишком большой.',413);if(!request.body)return Buffer.alloc(0);const reader=request.body.getReader();const chunks:Uint8Array[]=[];let size=0;try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit){await reader.cancel();throw new AppError('FILE_LIMIT','Файл превышает лимит 8 МБ.',413);}chunks.push(value);}}finally{reader.releaseLock();}return Buffer.concat(chunks);}
export async function bodyJson(request:NextRequest){try{return JSON.parse((await boundedBody(request)).toString('utf8'));}catch(e){if(e instanceof AppError)throw e;throw new AppError('JSON','Некорректный JSON.');}}
