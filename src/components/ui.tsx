'use client';

import Link from 'next/link';
import type { AppState, Product } from '@/shared/types';

export type IconName = 'chat' | 'bag' | 'file' | 'arrow' | 'plus' | 'close' | 'check' | 'search' | 'shield' | 'chevron' | 'box' | 'attach' | 'photo' | 'grid';
const paths: Record<IconName, React.ReactNode> = {
  chat: <><path d="M4 4h16v12H9l-5 4V4Z"/><path d="M8 8h8M8 12h5"/></>,
  bag: <><path d="M5 8h14l1 12H4L5 8Z"/><path d="M8 9V6a4 4 0 0 1 8 0v3"/></>,
  file: <><path d="M6 3h8l4 4v14H6V3Z"/><path d="M14 3v5h4M9 12h6M9 16h5"/></>,
  arrow: <><path d="M12 20V4m-6 6 6-6 6 6"/></>,
  plus: <path d="M12 5v14M5 12h14"/>, close: <path d="m6 6 12 12M6 18 18 6"/>,
  check: <path d="m5 12 4 4L19 6"/>, search: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></>,
  shield: <><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8 11 3 3 5-6"/></>,
  chevron: <path d="m9 5 7 7-7 7"/>, box: <><path d="m12 3 9 5v9l-9 5-9-5V8l9-5Zm-9 5 9 5 9-5M12 13v9"/><path d="m8 5 9 5"/></>,
  attach: <path d="m9 12 6-6a3 3 0 0 1 4 4l-9 9a5 5 0 0 1-7-7l10-10M7 14l8-8"/>,
  photo: <><rect x="3" y="5" width="18" height="15" rx="2"/><circle cx="8" cy="10" r="1"/><path d="m4 18 5-5 4 3 4-6 4 7"/></>,
  grid: <><path d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z"/></>,
};
export function Icon({ name, size = 20 }: { name: IconName; size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>; }
export function money(value: number | null) { return value === null ? 'Цена не указана' : `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(value / 100)} ₸`; }
export function date(value: string) { return new Date(value).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); }
export function MessageText({ text }: { text: string }) {
  return text.split(/(https:\/\/ekt\.kz(?:\/[^\s<>]*)?)/g).map((part, i) => {
    if (!part.startsWith('https://ekt.kz')) return <span key={i}>{part}</span>;
    const clean = part.replace(/[.,;!?)]*$/, '');
    try {
      const url = new URL(clean);
      if (url.protocol === 'https:' && url.hostname === 'ekt.kz') return <span key={i}><a href={url.href} target="_blank" rel="noreferrer">{clean}</a>{part.slice(clean.length)}</span>;
    } catch { /* Unparseable text stays plain text. */ }
    return <span key={i}>{part}</span>;
  });
}
export function unit(product: Product) { return product.unit || 'ед. каталога'; }
export function Header({ state, active = 'chat' }: { state?: AppState | null; active?: 'chat' | 'cart' | 'embed' }) {
  const count = state?.cart.lines.length ?? 0;
  return <header className="site-header"><Link href="/" className="brand" aria-label="EKT — ассистент"><span className="brand-mark">EKT<span className="brand-cut"/></span><span className="brand-caption">ЭЛЕКТРОТЕХНИКА<br/>ДЛЯ ВАШИХ ЗАДАЧ</span></Link><nav className="header-nav" aria-label="Основная навигация"><Link href="/" className={active === 'chat' ? 'active' : ''}><Icon name="chat"/>Подбор оборудования</Link><Link href="/cart" className={active === 'cart' ? 'active' : ''}><Icon name="bag"/>Корзина<span className="count">{count}</span></Link></nav><a className="catalog-link" href="https://ekt.kz" target="_blank" rel="noreferrer">Каталог ekt.kz <span aria-hidden="true">↗</span></a></header>;
}
export function StatusBar({ state }: { state: AppState }) {
  const mode = state.catalog.mode;
  return <div className="status-bar"><span className={`status-dot ${mode === 'live' ? 'live' : 'demo'}`}/><span>{mode === 'live' ? 'Живой каталог' : mode === 'snapshot' ? 'Снимок каталога' : 'Демонстрационные товары'}</span><span className="status-separator">/</span><span>{state.model.verified ? 'AI подключён' : state.model.configured ? 'AI · проверка при запросе' : 'Поиск без AI'}</span><span className="status-cart">Корзина прототипа</span></div>;
}
export function Evidence({ product }: { product: Product }) { return <details className="evidence"><summary>Источник и характеристики</summary><dl>{Object.entries(product.attributes).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl>{product.evidence.map((item, i) => <p key={i}>{item.field}: {item.source} · {date(item.fetchedAt)}</p>)}{product.certificates.map((item, i) => <a key={i} href={item.url} target="_blank" rel="noreferrer">{item.name} ↗</a>)}{product.certificates.length === 0 && <p>Сертификаты не переданы источником. Уточните документы у менеджера.</p>}{!product.unit && <p>Единица измерения в источнике не указана. Уточните перед закупкой.</p>}</details>; }
export function ProductThumb({ product }: { product: Product }) {
  // The neutral fallback is an icon, never a fabricated image of a catalog item.
  return <div className="product-thumb">{product.image ? <img src={product.image} alt="" loading="lazy" onError={event => { event.currentTarget.style.display = 'none'; }}/>: <Icon name="box" size={28}/>}</div>;
}
