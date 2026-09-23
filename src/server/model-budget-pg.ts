import { randomUUID } from 'node:crypto';
import { pgTransaction, postgres } from './postgres';
import { modelReserveUSD, type ModelBudgetSettlement, type ModelTokenBounds } from './model-budget';
import { AppError } from './errors';

export class PostgresModelBudget {
 constructor(private purpose:'acceptance'|'demo'){}
 close(){}
 private async initialize(){await postgres().query('INSERT INTO ekt_budget_policy(purpose,max_calls,max_nano_usd) VALUES($1,$2,$3) ON CONFLICT(purpose) DO NOTHING',[this.purpose,this.purpose==='acceptance'?6:100,this.purpose==='acceptance'?250000000:1000000000]);}
 async reserve(model:string,bounds:ModelTokenBounds){
  const reserve=Math.ceil(modelReserveUSD(model,bounds)*1e9);await this.initialize();
  return pgTransaction(async client=>{
   const policy=(await client.query('SELECT * FROM ekt_budget_policy WHERE purpose=$1 FOR UPDATE',[this.purpose])).rows[0];
   const totals=(await client.query('SELECT count(*) AS calls,coalesce(sum(committed_nano_usd),0) AS amount FROM ekt_budget_attempts WHERE purpose=$1',[this.purpose])).rows[0];
   if(Number(totals.calls)>=policy.max_calls||Number(totals.amount)+reserve>Number(policy.max_nano_usd))throw new AppError('MODEL_BUDGET_EXHAUSTED','Лимит платных AI-вызовов исчерпан. Доступен обычный поиск по каталогу.',429);
   const attemptId=randomUUID();await client.query("INSERT INTO ekt_budget_attempts(id,purpose,requested_model,status,reserved_nano_usd,committed_nano_usd) VALUES($1,$2,$3,'reserved',$4,$4)",[attemptId,this.purpose,model,reserve]);return{attemptId};
  });
 }
 async settle(id:string,outcome:ModelBudgetSettlement){
  const valid=(n:number|undefined)=>n===undefined||Number.isSafeInteger(n)&&n>=0;
  if(!['completed','error','timeout'].includes(outcome.status)||!valid(outcome.durationMs)||!valid(outcome.inputTokens)||!valid(outcome.outputTokens)||!valid(outcome.reasoningTokens)||(outcome.reasoningTokens??0)>(outcome.outputTokens??0))throw new AppError('MODEL_BUDGET_METADATA','Некорректные метаданные AI.',503);
  await pgTransaction(async client=>{
   const attempt=(await client.query('SELECT * FROM ekt_budget_attempts WHERE id=$1 AND purpose=$2 FOR UPDATE',[id,this.purpose])).rows[0];
   if(!attempt)throw new AppError('MODEL_BUDGET_ATTEMPT','Попытка AI не зарегистрирована.',503);
   if(attempt.status!=='reserved')return;
   if(outcome.returnedModel&&outcome.returnedModel!==attempt.requested_model&&!new RegExp(`^${String(attempt.requested_model).replaceAll('.', '\\.')}-\\d{4}-\\d{2}-\\d{2}$`).test(outcome.returnedModel))throw new AppError('MODEL_BUDGET_MODEL','Провайдер вернул другую модель.',503);
   let cost=Number(attempt.reserved_nano_usd);
   if(outcome.status==='completed'&&outcome.inputTokens!==undefined&&outcome.outputTokens!==undefined){
    const amount=BigInt(outcome.inputTokens)*(attempt.requested_model==='gpt-5.5'?5000n:400n)+BigInt(outcome.outputTokens)*(attempt.requested_model==='gpt-5.5'?30000n:1600n);
    if(amount>BigInt(Number.MAX_SAFE_INTEGER))throw new AppError('MODEL_BUDGET_METADATA','Недопустимый расход AI.',503);cost=Number(amount);
   }
   await client.query('UPDATE ekt_budget_attempts SET finished_at=now(),returned_model=$2,status=$3,input_tokens=$4,output_tokens=$5,reasoning_tokens=$6,duration_ms=$7,committed_nano_usd=$8 WHERE id=$1',[id,outcome.returnedModel??null,outcome.status,outcome.inputTokens??null,outcome.outputTokens??null,outcome.reasoningTokens??null,outcome.durationMs,cost]);
  });
 }
 async status(){
  await this.initialize();
  const policy=(await postgres().query('SELECT * FROM ekt_budget_policy WHERE purpose=$1',[this.purpose])).rows[0];
  const totals=(await postgres().query('SELECT count(*) AS calls,coalesce(sum(committed_nano_usd),0) AS amount FROM ekt_budget_attempts WHERE purpose=$1',[this.purpose])).rows[0];
  return{remainingCalls:Math.max(0,policy.max_calls-Number(totals.calls)),remainingUSD:Math.max(0,Number(policy.max_nano_usd)-Number(totals.amount))/1e9};
 }
}
