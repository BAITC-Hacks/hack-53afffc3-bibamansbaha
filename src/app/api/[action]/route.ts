import { NextRequest } from 'next/server';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { runtime as services } from '../../../server/runtime';
import { authorize, session, reply, failure, boundedBody, bodyJson } from '../../../server/http';
import { AppError } from '../../../server/errors';
import { parseAttachment } from '../../../server/attachments';
import { modelStatus, createVisionProvider, interpretRequest } from '../../../server/model';
import { purchaseTerms } from '../../../server/purchase-terms';
import { assertSafeText } from '../../../server/privacy';
import type { AppState, RequestedLine, Match } from '../../../shared/types';
export const runtime='nodejs';
export const dynamic='force-dynamic';
type Context={params:Promise<{action:string}>};
const lineSchema=z.object({id:z.string().max(100),query:z.string().min(1).max(2000),quantity:z.number().positive().max(1_000_000),unit:z.string().max(30).optional(),source:z.string().max(300),selectedId:z.string().max(80).optional()});
async function state(s:{id:string;csrf:string}):Promise<AppState>{try{await services.catalog.load();}catch{/* Preserve the explicit unavailable state instead of switching datasets. */}return{messages:services.cart.messages(s.id),cart:services.cart.getCart(s.id),proposal:services.cart.currentProposal(s.id),catalog:services.catalog.status(),model:modelStatus(),csrf:s.csrf};}
async function matchLines(lines:z.infer<typeof lineSchema>[]):Promise<RequestedLine[]>{const result:RequestedLine[]=[];for(const line of lines){assertSafeText(JSON.stringify(line));let matches=await services.catalog.search(line.query);const exact=matches.find(m=>m.kind==='exact');if(exact?.product.stock===0)matches=[...matches,...await services.catalog.alternatives(exact.product)];const requested=matches.find(m=>m.product.id===line.selectedId);const selected=requested??(exact&&exact.product.stock!==0?exact:undefined);result.push({...line,selectedId:selected?.product.id,matches,status:selected?(selected.kind==='alternative'?'alternative':'exact'):matches.length?'clarify':'not_found'});}return result;}
export async function GET(request:NextRequest,context:Context){try{if((await context.params).action!=='state')throw new AppError('NOT_FOUND','Страница API не найдена.',404);const s=session(request);return reply(await state(s),s);}catch(e){return failure(e);}}
export async function POST(request:NextRequest,context:Context){try{
 const action=(await context.params).action;const s=session(request,false);authorize(request,s);
 if(action==='parse'){
  const bytes=await boundedBody(request,8*1024*1024+64*1024);
  const form=await new Request(request.url,{method:'POST',headers:{'content-type':request.headers.get('content-type')??''},body:bytes}).formData();
  const file=form.get('file');if(!(file instanceof File))throw new AppError('FILE','Выберите файл.');
  const parsed=await parseAttachment({name:file.name,type:file.type,buffer:Buffer.from(await file.arrayBuffer())},createVisionProvider());
  const lines=await matchLines(parsed.lines.map(l=>({...l,id:randomUUID()})));
  return reply({lines,warnings:parsed.warnings},s);
 }
 const body=await bodyJson(request);
 if(action==='cancel'){const data=z.object({proposalId:z.string().uuid()}).strict().parse(body);return reply({proposal:services.cart.cancel(s.id,data.proposalId)},s);}
 if(action==='match'){const data=z.object({lines:z.array(lineSchema).max(100)}).parse(body);return reply({lines:await matchLines(data.lines)},s);}
 if(action==='proposal'){const data=z.object({lines:z.array(z.object({productId:z.string(),quantity:z.number(),requestedUnit:z.string().max(30).nullable().optional(),unitConfirmed:z.boolean().optional()}).strict()).min(1).max(100),excluded:z.array(z.string().max(400)).max(100).default([])}).strict().parse(body);const proposal=await services.cart.prepare(s.id,data.lines,data.excluded);return reply({proposal,cart:services.cart.getCart(s.id)},s);}
 if(action==='confirm'){const data=z.object({proposalId:z.string().uuid(),version:z.number().int().positive(),hash:z.string().length(64),confirmed:z.literal(true)}).strict().parse(body);return reply(await services.cart.confirm(s.id,data),s);}
 if(action==='cart'){const data=z.object({productId:z.string().max(80),quantity:z.number().min(0).max(1_000_000)}).strict().parse(body);return reply({cart:await services.cart.updateCart(s.id,data.productId,data.quantity)},s);}
 if(action==='chat'){
  const {text}=z.object({text:z.string().trim().min(1).max(8000)}).strict().parse(body);const history=services.cart.messages(s.id);services.cart.addMessage(s.id,{role:'user',text});
  if(/^(?:да[,!\s]*)?(?:добавь|добавить|подтверждаю)[.!\s]*$/i.test(text)||/^(?:нет|спасибо|не добавляй)[.!\s]*$/i.test(text)){services.cart.addMessage(s.id,{role:'assistant',text:'Корзина не изменена. Для добавления проверьте состав, цену и количество в предложении и нажмите кнопку подтверждения.'});return reply({state:await state(s)},s);}
  let query=text;let quantity:number|undefined;let terms=/оплат|достав|минимальн|парти[яию]|самовывоз/i.test(text);let notice='';
  if(modelStatus().configured){try{const parsed=await interpretRequest(text,history.slice(-6).map(m=>m.text+(m.products?`\nАртикулы: ${m.products.map(p=>p.product.sku).join(', ')}`:'')));query=parsed.query;quantity=parsed.quantity;terms=terms||parsed.intent==='terms';if(parsed.intent==='clarify'&&!terms){services.cart.addMessage(s.id,{role:'assistant',text:'Уточните артикул, маркировку или параметры товара. Можно загрузить спецификацию или фото маркировки.'});return reply({state:await state(s)},s);}}catch{notice='AI сейчас недоступен; выполнен обычный поиск по введённому тексту. ';}}
  else notice='Обычный поиск без AI. ';
  if(terms){services.cart.addMessage(s.id,{role:'assistant',text:purchaseTerms.map(t=>`${t.topic}: ${t.text}\nИсточник: ${t.sourceUrl} (проверено ${t.checkedAt})`).join('\n\n')});return reply({state:await state(s)},s);}
  let matches:Match[]=await services.catalog.search(query);
  if(!matches.length&&query!==text)matches=await services.catalog.search(text);
  const exact=matches.find(m=>m.kind==='exact');
  if(exact?.product.stock===0)matches=[...matches,...await services.catalog.alternatives(exact.product)];
  const summary=matches.length?`${notice}Найдено ${matches.length} поз. ${exact?.product.stock===0?'Исходная позиция отсутствует. '+(matches.some(m=>m.kind==='alternative')?'Ниже — кандидаты с совпадающими критическими параметрами; выберите замену явно.':'Безопасный аналог по имеющимся данным не найден.'): 'Проверьте характеристики и выберите товар для предложения.'} ${services.catalog.status().partial?'Поиск ограничен загруженной выборкой каталога.':''}`:`${notice}В загруженной выборке совпадений нет. Это не означает отсутствие товара на ekt.kz. Уточните артикул или обратитесь к менеджеру.`;
  services.cart.addMessage(s.id,{role:'assistant',text:summary,products:matches});
  if(quantity&&exact&&exact.product.stock!==0){try{await services.cart.prepare(s.id,[{productId:exact.product.id,quantity}]);}catch(e){services.cart.addMessage(s.id,{role:'assistant',text:e instanceof AppError?e.message:'Не удалось подготовить предложение.'});}}
  return reply({state:await state(s)},s);
 }
 throw new AppError('NOT_FOUND','Метод API не найден.',404);
 }catch(e){return failure(e);}}
