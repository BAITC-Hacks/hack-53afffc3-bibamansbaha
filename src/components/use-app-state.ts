'use client';
import { useCallback, useEffect, useState } from 'react';
import type { AppState } from '@/shared/types';

export function useAppState() {
  const [state, setState] = useState<AppState | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const refresh = useCallback(async () => {
    const response = await fetch('/api/state', { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Не удалось загрузить сессию.');
    setState(data as AppState);
    return data as AppState;
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/state', { cache: 'no-store', signal: controller.signal })
      .then(async response => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Не удалось загрузить сессию.');
        return result as AppState;
      })
      .then(result => setState(result))
      .catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Ошибка подключения'); });
    return () => controller.abort();
  }, []);
  async function request<T>(path: string, body: unknown, label: string): Promise<T | null> {
    if (!state || busy) return null;
    setBusy(label); setError('');
    try {
      const form = body instanceof FormData;
      const response = await fetch(path, { method: 'POST', headers: { 'x-csrf-token': state.csrf, ...(form ? {} : { 'Content-Type': 'application/json' }) }, body: form ? body : JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) {
        if (result.proposal) setState(prev => prev ? { ...prev, proposal: result.proposal } : prev);
        throw new Error(result.error || 'Не удалось выполнить действие. Попробуйте ещё раз.');
      }
      return result as T;
    } catch (e) { setError(e instanceof Error ? e.message : 'Нет связи с сервером. Повторите действие.'); return null; }
    finally { setBusy(''); }
  }
  return { state, setState, error, setError, busy, request, refresh };
}
