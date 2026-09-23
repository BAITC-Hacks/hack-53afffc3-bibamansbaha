'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Header, Icon } from './ui';
import { useAppState } from './use-app-state';
import { isEmbedEvent } from './embed-events';

export function EmbedDemo() {
  const [open, setOpen] = useState(false);
  const { state, error, setError, refresh } = useAppState();
  const frame = useRef<HTMLIFrameElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const launcher = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => {
    dialog.current?.close();
    setOpen(false);
    requestAnimationFrame(() => launcher.current?.focus());
  }, []);
  useEffect(() => {
    if (open && !dialog.current?.open) { dialog.current?.showModal(); closeButton.current?.focus(); }
  }, [open]);
  useEffect(() => {
    const update = () => { void refresh().catch(() => setError('Не удалось обновить корзину. Повторите загрузку страницы.')); };
    const message = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== frame.current?.contentWindow) return;
      if (isEmbedEvent(event.data, 'ekt:cart-changed')) update();
      if (isEmbedEvent(event.data, 'ekt:close')) close();
      if (isEmbedEvent(event.data, 'ekt:focus-close')) closeButton.current?.focus();
    };
    const focus = () => { if (state) update(); };
    window.addEventListener('message', message);
    window.addEventListener('focus', focus);
    return () => { window.removeEventListener('message', message); window.removeEventListener('focus', focus); };
  }, [close, refresh, setError, state]);
  return <div className="app-shell embed-demo">
    <Header state={state} active="embed"/>
    <main className="embed-content"><span className="eyebrow">ДЕМОНСТРАЦИЯ ВСТРАИВАНИЯ</span><h1>Помощник рядом<br/>с вашим каталогом</h1><p>Откройте виджет внизу страницы. Это тот же работающий подбор и та же сохранённая корзина в изолированном iframe текущего сайта.</p><p className="muted">Страница демонстрирует способ интеграции. Виджет не установлен на ekt.kz.</p><button className="button primary" disabled={!state} onClick={() => setOpen(true)}>Попробовать помощника <Icon name="chat" size={18}/></button>{error && <p className="error-banner" role="alert">{error}</p>}</main>
    <dialog ref={dialog} className="embed-window" aria-label="Виджет EKT" onCancel={event => { event.preventDefault(); close(); }}>
      <div className="embed-title"><strong>EKT · Подбор оборудования</strong><button ref={closeButton} aria-label="Закрыть виджет" onClick={close} onKeyDown={event => {
        if (event.key === 'Tab' && frame.current?.contentWindow) {
          event.preventDefault();
          frame.current.contentWindow.postMessage({ type: event.shiftKey ? 'ekt:focus-last' : 'ekt:focus-first' }, window.location.origin);
        }
      }}><Icon name="close"/></button></div>
      {open && state && <iframe ref={frame} src="/" title="EKT Ассистент — подбор и корзина"/>}
    </dialog>
    <button ref={launcher} className="widget-launcher" aria-haspopup="dialog" aria-expanded={open} disabled={!state} onClick={() => setOpen(true)}><Icon name="chat"/>Помочь с подбором?</button>
  </div>;
}
