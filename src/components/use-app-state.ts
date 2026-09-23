'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppState } from '@/shared/types';

let initialState:Promise<AppState>|null=null;
function readState(deduplicate=false):Promise<AppState>{
  if(deduplicate&&initialState)return initialState;
  const pending=(async()=>{const response=await fetch('/api/state',{cache:'no-store',signal:AbortSignal.timeout(45000)});const data=await response.json();if(!response.ok)throw new Error(data.error||'Не удалось загрузить состояние с сервера.');return data as AppState;})();
  if(deduplicate){initialState=pending;void pending.finally(()=>{if(initialState===pending)initialState=null;}).catch(()=>{});}
  return pending;
}

export function useAppState() {
  const [state, setState] = useState<AppState | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [requiresRefresh,setRequiresRefresh]=useState(false);
  const sequence=useRef(0);
  const locked=useRef(false);
  const refresh = useCallback(async (deduplicate=false) => {
    const version=++sequence.current;
    try {
      const data=await readState(deduplicate);
      if(version===sequence.current){setState(data);setRequiresRefresh(false);}
      return data as AppState;
    } catch(error){
      if(error instanceof TypeError)throw new Error('Нет связи с сервером. Проверьте подключение и обновите состояние.');
      if(error instanceof DOMException&&error.name==='TimeoutError')throw new Error('Сервер не ответил вовремя. Обновите состояние перед повтором.');
      throw error;
    }
  },[]);
  useEffect(()=>{let active=true;void refresh(true).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[refresh]);

  async function request<T>(path:string,body:unknown,label:string):Promise<T|null>{
    if(!state||locked.current)return null;
    locked.current=true;setBusy(label);setError('');++sequence.current;
    async function recoverConfirmation():Promise<T|null>{
      setRequiresRefresh(true);
      setState(prev=>prev?.proposal?{...prev,proposal:{...prev.proposal,status:'invalidated'}}:prev);
      try{const current=await refresh();const id=(body as {proposalId?:string}).proposalId;const recovered=current.proposal;if(recovered&&recovered.id===id&&recovered.status==='committed')return{proposal:recovered,cart:current.cart} as T;}catch{/* Keep confirmation disabled until a verified refresh. */}
      return null;
    }
    try{
      if(path==='/api/confirm'&&requiresRefresh){setError('Сначала обновите состояние предложения.');return null;}
      const form=body instanceof FormData;
      let response:Response;
      try{response=await fetch(path,{method:'POST',headers:{'x-csrf-token':state.csrf,...(form?{}:{'Content-Type':'application/json'})},body:form?body:JSON.stringify(body),signal:AbortSignal.timeout(45000)});}
      catch(error){
        if(path==='/api/confirm'){
          const recovered=await recoverConfirmation();if(recovered)return recovered;
        }
        setError(error instanceof DOMException&&error.name==='TimeoutError'?'Сервер не ответил вовремя. Результат действия нужно проверить: обновите состояние.':'Нет связи с сервером. Проверьте подключение, обновите состояние и повторите запрос. Черновик сохранён в этом окне.');return null;
      }
      const result=await response.json();
      if(!response.ok){
        if(response.status===409){
          setRequiresRefresh(true);
          setState(prev=>prev?.proposal?{...prev,proposal:{...prev.proposal,status:'invalidated'}}:prev);
          try{await refresh();}catch{/* A stale confirmation remains disabled. */}
        }
        setError(result.error||`Сервер вернул ошибку ${response.status}. Обновите состояние и повторите запрос.`);return null;
      }
      return result as T;
    }catch{if(path==='/api/confirm'){const recovered=await recoverConfirmation();if(recovered)return recovered;}setError('Не удалось прочитать ответ сервера. Обновите состояние перед повтором.');return null;}
    finally{locked.current=false;setBusy('');}
  }
  return{state,setState,error,setError,busy,request,refresh,requiresRefresh};
}
