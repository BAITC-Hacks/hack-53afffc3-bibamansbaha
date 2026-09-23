'use client';

import { useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import type { AppState, Cart, Match, Product, Proposal, RequestedLine } from '@/shared/types';
import { date, Evidence, Header, Icon, money, MessageText, ProductThumb, StatusBar, unit } from './ui';
import { useAppState } from './use-app-state';
import { needsUnitReview } from '@/shared/units';

function ProductCard({ match, onChoose, onEdit, busy }: { match: Match; onChoose: (product: Product, quantity: number) => void; onEdit: () => void; busy: boolean }) {
  const [quantity, setQuantity] = useState(1);
  const quantityId = useId();
  const p = match.product;
  const meter = p.unit === 'м' || p.unit === 'm';
  return <article className="product-card"><div className="product-card-top"><ProductThumb product={p}/><div><span className="sku">{p.sku}</span><h3>{p.url ? <a href={p.url} target="_blank" rel="noreferrer">{p.name}</a> : p.name}</h3></div><span className={`match-tag ${match.kind === 'exact' ? 'exact' : ''}`}>{match.kind === 'exact' ? 'Совпадение' : match.kind === 'alternative' ? 'Аналог' : 'Кандидат'}</span></div><div className="match-reasons">{match.reasons.map((reason, i) => <p key={i}><Icon name="check" size={14}/>{reason}</p>)}</div>{match.differences.length > 0 && <div className="warning">Отличия: {match.differences.join('; ')}</div>}{p.warnings.map((warning, i) => <p className="warning" key={i}>{warning}</p>)}<div className="product-footer"><div><strong className="price">{money(p.priceMinor)}</strong><span className="stock">{p.stock === null ? 'Остаток не указан' : p.stock > 0 ? `На складе: ${p.stock} ${unit(p)}` : 'Нет в наличии'}</span></div><div className="product-action"><label className="sr-only" htmlFor={quantityId}>Количество {p.sku}</label><input id={quantityId} aria-label={`Количество ${p.sku}`} type="number" min={meter ? 0.001 : 1} step={meter ? 0.001 : 1} max="100000" value={quantity} disabled={busy} onChange={e => { setQuantity(Number(e.target.value)); onEdit(); }}/><button className="button secondary compact" disabled={busy || p.priceMinor === null || p.stock === null || p.stock === 0 || quantity <= 0 || !Number.isFinite(quantity) || (!meter && !Number.isInteger(quantity))} onClick={() => onChoose(p, quantity)}><Icon name="plus" size={16}/>В предложение</button></div></div><Evidence product={p}/></article>;
}

type EditableRequestedLine = RequestedLine & { unitConfirmed?: boolean };
type ProposalSelection = { productId: string; quantity: number; requestedUnit?: string | null; unitConfirmed?: boolean };

function selectedProduct(line: RequestedLine) { return line.matches.find(match => match.product.id === line.selectedId)?.product; }
function requiresUnitCheck(line: RequestedLine) {
  const product = selectedProduct(line);
  return !!product && needsUnitReview(line.unit, product.unit);
}

function LineEditor({ lines, setLines, busy, onMatch, onPrepare }: { lines: EditableRequestedLine[]; setLines: (lines: EditableRequestedLine[]) => void; busy: boolean; onMatch: () => void; onPrepare: () => void }) {
  const selected = lines.filter(line => line.selectedId);
  const unitChecksPending = selected.some(line => requiresUnitCheck(line) && !line.unitConfirmed);
  function edit(id: string, changes: Partial<EditableRequestedLine>) {
    setLines(lines.map(line => line.id === id ? { ...line, ...changes, unitConfirmed: false } : line));
  }
  return <section className="specification" aria-labelledby="spec-heading">
    <div className="section-heading"><div><span className="eyebrow">РАЗБОР СПЕЦИФИКАЦИИ</span><h2 id="spec-heading">Проверьте позиции</h2></div><span className="count">{lines.length}</span></div>
    <p className="muted">Исправьте распознанный текст, единицы и количество. Выберите товар для каждой строки. Автоматический пересчёт единиц не выполняется.</p>
    <div className="spec-lines">{lines.map((line, index) => {
      const product = selectedProduct(line);
      const needsUnitCheck = requiresUnitCheck(line);
      return <div className="spec-line" key={line.id}>
        <span className="line-number">{String(index + 1).padStart(2, '0')}</span>
        <div className="line-fields">
          <p className="line-provenance">{line.source} · {{ exact: 'Совпадение', alternative: 'Есть аналоги', clarify: 'Нужно уточнить', not_found: 'Не найдено' }[line.status]} · единица документа: {line.unit || 'не указана'}</p>
          <label>Наименование<input value={line.query} disabled={busy} onChange={e => edit(line.id, { query: e.target.value, selectedId: undefined, matches: [] })}/></label>
          <div className="line-fields-row">
            <label className="source-unit-label">Единица в спецификации<input value={line.unit || ''} placeholder="Не указана" maxLength={30} disabled={busy} onChange={e => edit(line.id, { unit: e.target.value })}/></label>
            <label className="quantity-label">Количество{product ? ` (${unit(product)})` : ''}<input type="number" min="0.001" step="0.001" value={line.quantity} disabled={busy} onChange={e => edit(line.id, { quantity: Number(e.target.value) })}/></label>
          </div>
          <label className="candidate-label">Товар каталога<select value={line.selectedId || ''} disabled={busy} onChange={e => edit(line.id, { selectedId: e.target.value || undefined })}>
            <option value="">{line.matches.length ? 'Выбрать / исключить строку' : 'Совпадений пока нет'}</option>
            {line.matches.map(m => <option key={m.product.id} value={m.product.id}>{m.kind === 'alternative' ? 'Аналог · ' : ''}{m.product.name} · {money(m.product.priceMinor)} / {unit(m.product)}</option>)}
          </select></label>
          {needsUnitCheck && <div className="unit-check warning">
            <p>В документе: {line.unit}. В каталоге: {product?.unit || 'единица не указана'}. Автоматический пересчёт не выполняется. Уточните упаковку и исправьте количество выше в единицах выбранного товара.</p>
            <label className="unit-confirm-label"><input type="checkbox" checked={!!line.unitConfirmed} disabled={busy} onChange={e => setLines(lines.map(item => item.id === line.id ? { ...item, unitConfirmed: e.target.checked } : item))}/><span>Проверил единицы и количество: {line.quantity} {product ? unit(product) : ''}; в документе — {line.unit}.</span></label>
          </div>}
          {line.matches.map(m => <details className="candidate-details" key={m.product.id}><summary>{m.product.sku} · {m.kind === 'exact' ? 'Совпадение' : m.kind === 'alternative' ? 'Аналог' : 'Кандидат'}</summary><p>{m.reasons.join('. ')}</p>{m.differences.length > 0 && <p className="warning">Отличия: {m.differences.join('; ')}</p>}{m.product.warnings.map((w, i) => <p className="warning" key={i}>{w}</p>)}</details>)}
        </div>
      </div>;
    })}</div>
    <div className="spec-actions"><button className="button secondary" disabled={busy} onClick={onMatch}><Icon name="search" size={16}/>Сопоставить заново</button><button className="button primary" disabled={busy || selected.length === 0 || unitChecksPending} onClick={onPrepare}>Подготовить предложение · {selected.length}</button></div>
    {unitChecksPending && <p className="warning" role="status">Проверьте единицы и количество в отмеченных строках перед подготовкой предложения.</p>}
    <p className="microcopy">Строки без выбранного товара будут явно исключены из предложения.</p>
  </section>;
}
function ProposalPanel({ state, busy, onConfirm }: { state: AppState | null; busy: boolean; onConfirm: () => void }) {
  const p = state?.proposal;
  const committed = p?.status === 'committed';
  return <aside id="proposal" className="proposal-panel" aria-label="Ваше предложение"><div className="proposal-heading"><div className="icon-tile"><Icon name="bag"/></div><h2>Ваше предложение</h2>{p && <span className="count">{p.lines.length}</span>}</div><div className="workflow"><div className="workflow-step done"><span>1</span>Подбор</div><div className={`workflow-step ${p ? 'done' : ''}`}><span>2</span>Проверка</div><div className={`workflow-step ${committed ? 'done' : ''}`}><span>3</span>Корзина</div></div>{!p ? <div className="proposal-empty"><div className="empty-bag"><Icon name="bag" size={38}/></div><h3>Здесь соберём ваш подбор</h3><p>Выберите товары в чате или загрузите спецификацию. Перед сохранением проверим цены и наличие.</p><div className="proposal-note"><Icon name="shield" size={17}/><span>Товары попадут в корзину только после вашего подтверждения.</span></div></div> : <div className="proposal-content"><div className={`proposal-status ${committed ? 'success' : ''}`}>{committed ? <><Icon name="check" size={15}/>Сохранено в корзине</> : p.status === 'awaiting_confirmation' ? 'Ожидает вашего подтверждения' : p.status === 'expired' ? 'Срок истёк — подготовьте предложение заново' : p.status === 'invalidated' || p.status === 'cancelled' ? 'Состав изменён — подготовьте новое предложение' : 'Черновик предложения'}</div>{p.lines.map(line => <div className="proposal-line" key={line.product.id}><span className="sku">{line.product.sku}</span><h3>{line.product.name}</h3><div><span>{line.quantity} {unit(line.product)} × {money(line.product.priceMinor)}</span><strong>{money(line.lineTotalMinor)}</strong></div>{line.requestedUnit && needsUnitReview(line.requestedUnit, line.product.unit) && <p className="warning">Единица из документа: {line.requestedUnit}. Количество указано в {unit(line.product)} и проверено вручную. Автоматического пересчёта нет.</p>}{line.product.warnings.map((w, i) => <p className="warning" key={i}>{w}</p>)}</div>)}{p.excluded.length > 0 && <div className="excluded"><strong>Не включено:</strong><ul>{p.excluded.map((item, i) => <li key={i}>{item}</li>)}</ul></div>}<div className="proposal-total"><span>Итого</span><strong>{money(p.totalMinor)}</strong></div><p className="microcopy">Версия {p.version} · действительно до {date(p.expiresAt)}. При изменении цены или остатков потребуется новое подтверждение.</p>{committed ? <Link className="button primary full" href="/cart">Открыть корзину <Icon name="chevron" size={16}/></Link> : <button className="button primary full" disabled={busy || p.status !== 'awaiting_confirmation'} onClick={onConfirm}><Icon name="check" size={17}/>Подтверждаю состав и сумму</button>}<p className="microcopy centered">Сохраняет корзину прототипа.<br/>Оформление заказа не выполняется.</p></div>}<div className="proposal-footer"><Icon name="shield" size={16}/><span>Цены и остатки проверяются сервером</span></div></aside>;
}

export function Assistant() {
  const { state, setState, error, setError, busy, request, refresh } = useAppState();
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [lines, setLines] = useState<EditableRequestedLine[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [drag, setDrag] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const messagesEnd = useRef<HTMLDivElement>(null);
  const composerId = useId();
  const cancellingProposal = useRef<string | null>(null);
  function invalidateProposal() {
    const proposal = state?.proposal;
    if (!proposal || proposal.status !== 'awaiting_confirmation' || cancellingProposal.current === proposal.id) return;
    cancellingProposal.current = proposal.id;
    setState(prev => prev?.proposal?.id === proposal.id ? { ...prev, proposal: { ...prev.proposal, status: 'invalidated' } } : prev);
    void request<{ proposal: Proposal }>('/api/cancel', { proposalId: proposal.id }, 'Отменяем прежнее предложение').then(result => {
      if (result) setState(prev => prev?.proposal?.id === proposal.id ? { ...prev, proposal: result.proposal } : prev);
      cancellingProposal.current = null;
    });
  }
  function editLines(next: EditableRequestedLine[]) { setLines(next); invalidateProposal(); }
  function attachFile(next: File | null) { if (busy) return; setFile(next); invalidateProposal(); }
  useEffect(() => { if (state?.messages.length) messagesEnd.current?.scrollIntoView({ block: 'nearest', behavior: 'instant' }); }, [state?.messages.length]);
  async function send() {
    if (busy || !state) return;
    if (file) {
      const data = new FormData(); data.append('file', file);
      const result = await request<{ lines: RequestedLine[]; warnings: string[] }>('/api/parse', data, 'Распознаём документ');
      if (!result) return;
      setWarnings(result.warnings); setLines(result.lines); setFile(null);
      const matched = await request<{ lines: RequestedLine[] }>('/api/match', { lines: result.lines }, 'Сопоставляем с каталогом');
      if (matched) setLines(matched.lines);
      return;
    }
    if (!text.trim()) return;
    const result = await request<{ state: AppState }>('/api/chat', { text: text.trim() }, 'Ищем в каталоге');
    if (result) { setState(result.state); setText(''); }
  }
  async function prepare(items: ProposalSelection[], excluded: string[] = []) {
    const result = await request<{ proposal: Proposal; cart: Cart }>('/api/proposal', { lines: items, excluded }, 'Проверяем цены и остатки');
    if (result) setState(prev => prev ? { ...prev, proposal: result.proposal, cart: result.cart } : prev);
  }
  async function choose(product: Product, quantity: number) {
    const current: ProposalSelection[] = state?.proposal?.status === 'awaiting_confirmation' ? state.proposal.lines.map(line => ({ productId: line.product.id, quantity: line.quantity, requestedUnit: line.requestedUnit, unitConfirmed: line.unitConfirmed })) : [];
    const existing = current.find(item => item.productId === product.id);
    if (existing) existing.quantity += quantity; else current.push({ productId: product.id, quantity });
    await prepare(current);
  }
  async function confirm() {
    const p = state?.proposal; if (!p) return;
    const result = await request<{ proposal: Proposal; cart: Cart }>('/api/confirm', { proposalId: p.id, version: p.version, hash: p.hash, confirmed: true }, 'Повторно проверяем и сохраняем');
    if (result) setState(prev => prev ? { ...prev, ...result } : prev);
  }
  const example = state?.catalog.mode === 'fixture' ? 'DEMO-C16-OUT' : '200300285_';
  function insert(value: string) { setText(value); textarea.current?.focus(); }
  return <div className="app-shell"><Header state={state}/><div className="workspace"><aside className="workspace-nav"><div className="workspace-label">РАБОЧЕЕ ПРОСТРАНСТВО</div><Link href="/" className="side-link active"><Icon name="chat"/>Подбор оборудования<span className="nav-active-dot"/></Link><Link href="/cart" className="side-link"><Icon name="bag"/>Сохранённая корзина</Link><div className="side-divider"/><div className="workspace-label">С ЧЕГО НАЧАТЬ</div><button className="side-link" disabled={!!busy} onClick={() => fileInput.current?.click()}><Icon name="file"/>Загрузить спецификацию</button><button className="side-link" disabled={!!busy} onClick={() => insert('Помоги подобрать аналог. ')}><Icon name="search"/>Найти аналог</button><div className="workspace-bottom"><div className="expert-monogram">e</div><strong>Точность в каждой позиции</strong><p>Сопоставляем требования с фактами каталога. Все решения — за вами.</p><Link href="/embed">Демонстрация виджета <span aria-hidden="true">↗</span></Link></div></aside><main className="assistant-main" id="main"><div className="chat-heading"><div><div className="eyebrow">ПОМОЩНИК ПО ЭЛЕКТРОТЕХНИКЕ</div><h1>От задачи — к точному подбору</h1></div><span className="assistant-symbol"><Icon name="chat" size={22}/></span></div>{state && <StatusBar state={state}/>}<div className="chat-body">{!state && !error && <div className="loading-state" role="status">Подключаем каталог и загружаем сессию…</div>}{state && state.catalog.mode !== 'live' && <div className="mode-notice">{state.catalog.mode === 'fixture' ? 'Демо-режим: ниже используются тестовые товары, цены и остатки.' : 'Используется сохранённый снимок каталога. Актуальность данных будет проверена при подтверждении.'}</div>}{state?.catalog.partial && <div className="mode-notice">Подключена часть каталога. Отсутствие результата не означает отсутствие товара в ekt.kz.</div>}{state?.catalog.error && <p className="warning">{state.catalog.error}</p>}{state && state.messages.length === 0 && lines.length === 0 && <section className="welcome"><div className="welcome-mark"><span/> <Icon name="box" size={32}/></div><h2>Что подберём сегодня?</h2><p>Опишите задачу, укажите артикул или приложите спецификацию. Сопоставим позиции, объясним отличия аналогов и соберём предложение.</p><div className="example-grid"><button disabled={!!busy} onClick={() => insert(`Найди ${example}, нужно 2 штуки`)}><span className="example-icon"><Icon name="search"/></span><strong>Найти по артикулу</strong><span>{example}</span><Icon name="chevron" size={16}/></button><button disabled={!!busy} onClick={() => insert('Нужен автоматический выключатель C16, 1 полюс, 6 штук')}><span className="example-icon"><Icon name="grid"/></span><strong>Подобрать под задачу</strong><span>Автомат C16, 1 полюс</span><Icon name="chevron" size={16}/></button><button disabled={!!busy} onClick={() => fileInput.current?.click()}><span className="example-icon"><Icon name="file"/></span><strong>Разобрать спецификацию</strong><span>Таблица, документ или фото</span><Icon name="chevron" size={16}/></button></div><div className="welcome-foot"><Icon name="shield" size={15}/><span>Уточним неоднозначное. Покажем источники. Спросим подтверждение.</span></div></section>}<div className="messages">{state?.messages.map(message => <article key={message.id} className={`message ${message.role}`}><div className="message-avatar">{message.role === 'assistant' ? 'e' : 'Вы'}</div><div className="message-content"><div className="message-author">{message.role === 'assistant' ? 'EKT Ассистент' : 'Вы'}<time dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</time></div><p className="message-text"><MessageText text={message.text}/></p>{message.products?.map(match => <ProductCard key={match.product.id} match={match} onChoose={choose} onEdit={invalidateProposal} busy={!!busy}/>)}</div></article>)}</div>{warnings.length > 0 && <div className="warning">{warnings.join(' ')}</div>}{lines.length > 0 && <LineEditor lines={lines} setLines={editLines} busy={!!busy} onMatch={async () => { const result = await request<{ lines: RequestedLine[] }>('/api/match', { lines }, 'Сопоставляем позиции'); if (result) setLines(result.lines); }} onPrepare={() => prepare(lines.filter(l => l.selectedId).map(l => ({ productId: l.selectedId!, quantity: l.quantity, requestedUnit: l.unit?.trim() || null, unitConfirmed: !!l.unitConfirmed })), lines.filter(l => !l.selectedId).map(l => l.query))}/>}<div ref={messagesEnd}/></div><div className="composer-area">{state?.proposal && <a className="proposal-jump" href="#proposal">Проверить предложение <strong>{money(state.proposal.totalMinor)}</strong><Icon name="chevron" size={15}/></a>}{error && <div className="error-banner" role="alert"><span>{error}</span><button type="button" aria-label="Закрыть сообщение об ошибке" onClick={() => setError('')}><Icon name="close" size={16}/></button>{!state && <button type="button" onClick={() => refresh().catch(e => setError(e.message))}>Повторить</button>}</div>}<div className="operation-status" role="status" aria-live="polite">{busy && <><span className="loading-dot"/>{busy}…</>}</div><form className={`composer ${drag ? 'drag-active' : ''}`} onSubmit={event => { event.preventDefault(); void send(); }} onDragOver={event => { event.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={event => { event.preventDefault(); setDrag(false); const first = event.dataTransfer.files[0]; if (first) attachFile(first); }}><input ref={fileInput} aria-label="Прикрепить спецификацию или фото" className="sr-only" tabIndex={-1} disabled={!!busy || !state} type="file" accept=".txt,.csv,.xlsx,.pdf,.docx,.png,.jpg,.jpeg,.webp" onChange={event => { attachFile(event.target.files?.[0] || null); event.target.value = ''; }}/>{file && <div className="attachment-chip"><Icon name="file" size={17}/><span>{file.name}</span><button type="button" aria-label="Убрать прикреплённый файл" onClick={() => attachFile(null)}><Icon name="close" size={14}/></button></div>}<label className="sr-only" htmlFor={composerId}>Запрос ассистенту</label><textarea id={composerId} ref={textarea} placeholder="Например: нужен автомат C16 на 1 полюс, 6 штук…" value={text} maxLength={6000} rows={2} disabled={!!busy || !state} onChange={event => setText(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }}/><div className="composer-bottom"><button type="button" className="attach-button" onClick={() => fileInput.current?.click()} disabled={!!busy || !state}><Icon name="attach" size={18}/><span>Прикрепить файл</span></button><span className="file-hint">PDF, DOCX, XLSX, CSV, TXT, фото</span><button className="send-button" type="submit" aria-label={file ? 'Распознать файл' : 'Отправить сообщение'} disabled={!!busy || !state || (!text.trim() && !file)}><Icon name="arrow" size={20}/></button></div>{drag && <div className="drop-label">Отпустите файл для загрузки</div>}</form><p className="composer-disclaimer">Проверяйте характеристики перед закупкой. Корзина сохраняется только с вашего согласия.</p></div></main><ProposalPanel state={state} busy={!!busy} onConfirm={confirm}/></div></div>;
}
