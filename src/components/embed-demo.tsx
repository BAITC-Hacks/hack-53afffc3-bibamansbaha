'use client';
import { useState } from 'react';
import { Header, Icon } from './ui';

export function EmbedDemo() {
  const [open, setOpen] = useState(false);
  return <div className="app-shell embed-demo"><Header active="embed"/><main className="embed-content"><span className="eyebrow">ДЕМОНСТРАЦИЯ ВСТРАИВАНИЯ</span><h1>Помощник рядом<br/>с вашим каталогом</h1><p>Откройте виджет внизу страницы. Это тот же работающий подбор и та же сохранённая корзина в изолированном iframe текущего сайта.</p><p className="muted">Страница демонстрирует способ интеграции. Виджет не установлен на ekt.kz.</p><button className="button primary" onClick={() => setOpen(true)}>Попробовать помощника <Icon name="chat" size={18}/></button></main>{open && <section className="embed-window" aria-label="Виджет EKT"><div className="embed-title"><strong>EKT · Подбор оборудования</strong><button aria-label="Закрыть виджет" onClick={() => setOpen(false)}><Icon name="close"/></button></div><iframe src="/" title="EKT Ассистент — подбор и корзина"/></section>}<button className="widget-launcher" aria-expanded={open} onClick={() => setOpen(!open)}><Icon name={open ? 'close' : 'chat'}/>{open ? 'Закрыть помощника' : 'Помочь с подбором?'}</button></div>;
}
