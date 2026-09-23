import { test, expect } from '@playwright/test';

test('EKT-009 fractional cart edits require explicit save and survive reload',async({page,baseURL})=>{
 await page.goto('/');await expect(page.getByLabel('Запрос ассистенту')).toBeEnabled();
 const state=await(await page.request.get('/api/state')).json();const headers={origin:baseURL!,'x-csrf-token':state.csrf};
 const p=(await(await page.request.post('/api/proposal',{headers,data:{lines:[{productId:'DEMO-CABLE',quantity:0.5}]}})).json()).proposal;
 await page.request.post('/api/confirm',{headers,data:{proposalId:p.id,version:p.version,hash:p.hash,confirmed:true}});
 await page.goto('/cart');
 const input=page.getByLabel('Количество DEMO-CABLE',{exact:true});
 await input.fill('0,25');expect((await(await page.request.get('/api/state')).json()).cart.lines[0].quantity).toBe(0.5);
 await page.getByRole('button',{name:'Сохранить количество DEMO-CABLE'}).click();
 await expect(input).toHaveValue('0.25');
 await input.fill('0.75');await page.getByRole('button',{name:'Сохранить количество DEMO-CABLE'}).click();
 await expect(input).toHaveValue('0.75');await page.reload();await expect(input).toHaveValue('0.75');
});
test('EKT-010 conflict synchronizes and disables the rejected proposal',async({page,baseURL})=>{
 await page.goto('/');await expect(page.getByLabel('Запрос ассистенту')).toBeEnabled();
 const state=await(await page.request.get('/api/state')).json();const headers={origin:baseURL!,'x-csrf-token':state.csrf};
 const p=(await(await page.request.post('/api/proposal',{headers,data:{lines:[{productId:'DEMO-C25',quantity:1}]}})).json()).proposal;
 await page.reload();const button=page.getByRole('button',{name:'Подтверждаю состав и сумму'});await expect(button).toBeEnabled();
 await page.request.post('/api/cancel',{headers,data:{proposalId:p.id}});
 await button.click();await expect(page.locator('.error-banner')).toBeVisible();await expect(button).toBeDisabled();
 expect((await(await page.request.get('/api/state')).json()).cart.lines).toHaveLength(0);
});
test('EKT-016 offline preserves a chat draft and offers Russian recovery',async({page,context})=>{
 await page.goto('/');const text=page.getByLabel('Запрос ассистенту');await expect(text).toBeEnabled();await text.fill('DEMO-C25');
 await context.setOffline(true);await page.getByRole('button',{name:'Отправить сообщение'}).click();
 await expect(page.locator('.error-banner')).toContainText('Нет связи');await expect(text).toHaveValue('DEMO-C25');
 await context.setOffline(false);await page.getByRole('button',{name:'Обновить состояние'}).click();
 await page.getByRole('button',{name:'Отправить сообщение'}).click();await expect(page.locator('.product-card')).toBeVisible();
});

test('EKT-016 a lost confirm response is reconciled without a second mutation',async({page,baseURL})=>{
 await page.goto('/');await expect(page.getByLabel('Запрос ассистенту')).toBeEnabled();
 const state=await(await page.request.get('/api/state')).json();const headers={origin:baseURL!,'x-csrf-token':state.csrf};
 const p=(await(await page.request.post('/api/proposal',{headers,data:{lines:[{productId:'DEMO-C25',quantity:2}]}})).json()).proposal;
 await page.reload();await expect(page.getByRole('button',{name:'Подтверждаю состав и сумму'})).toBeEnabled();
 let mutations=0;await page.route('**/api/confirm',async route=>{mutations++;await route.fetch();await route.abort('failed');});
 await page.getByRole('button',{name:'Подтверждаю состав и сумму'}).click();
 await expect(page.getByRole('link',{name:'Открыть корзину',exact:true})).toBeVisible();
 expect(mutations).toBe(1);
 const current=(await(await page.request.get('/api/state')).json());expect(current.cart.lines[0].quantity).toBe(2);expect(current.proposal.id).toBe(p.id);
});

test('EKT-016 timeout before a write preserves the same proposal for a deliberate retry',async({page,baseURL})=>{
 await page.goto('/');await expect(page.getByLabel('Запрос ассистенту')).toBeEnabled();const state=await(await page.request.get('/api/state')).json();const headers={origin:baseURL!,'x-csrf-token':state.csrf};
 const p=(await(await page.request.post('/api/proposal',{headers,data:{lines:[{productId:'DEMO-C25',quantity:2}]}})).json()).proposal;
 await page.reload();await expect(page.getByRole('button',{name:'Подтверждаю состав и сумму'})).toBeEnabled();
 await page.evaluate(()=>{const original=window.fetch.bind(window);window.fetch=(input,init)=>String(input).endsWith('/api/confirm')?Promise.reject(new DOMException('Synthetic timeout','TimeoutError')):original(input,init);});
 await page.getByRole('button',{name:'Подтверждаю состав и сумму'}).click();await expect(page.locator('.error-banner')).toContainText('не ответил вовремя');
 let current=await(await page.request.get('/api/state')).json();expect(current.cart.lines).toHaveLength(0);expect(current.proposal.id).toBe(p.id);
 await page.reload();await page.getByRole('button',{name:'Подтверждаю состав и сумму'}).click();await expect(page.getByRole('link',{name:'Открыть корзину',exact:true})).toBeVisible();
 current=await(await page.request.get('/api/state')).json();expect(current.cart.lines[0].quantity).toBe(2);
});

test('EKT-008 a new specification retains exclusion through edit, rematch, reload and confirmation',async({page})=>{
 await page.goto('/');await expect(page.getByLabel('Запрос ассистенту')).toBeEnabled();
 await page.locator('input[type=file]').setInputFiles({name:'independent-repair-case.csv',mimeType:'text/csv',buffer:Buffer.from('Артикул;Количество;Единица\nDEMO-C16-OUT;3;шт\nDEMO-CABLE;3.75;м\nDEMO-C25;2;шт')});
 await page.getByRole('button',{name:'Распознать файл'}).click();await expect(page.getByLabel('Товар каталога')).toHaveCount(3);
 await page.getByLabel('Товар каталога').nth(0).selectOption('DEMO-C16-IN');await expect(page.getByLabel('Товар каталога').nth(2)).toBeEnabled();
 await page.getByLabel('Товар каталога').nth(2).selectOption('');
 await page.getByRole('button',{name:'Сопоставить заново'}).click();await expect(page.getByLabel('Товар каталога').nth(2)).toHaveValue('');
 await expect.poll(async()=>((await(await page.request.get('/api/state')).json()).requestedLines[2].selection)).toBe('excluded');
 await page.reload();await expect(page.getByLabel('Товар каталога').nth(2)).toHaveValue('');
 await page.getByLabel('Количество (м)',{exact:true}).fill('0.75');await page.getByRole('button',{name:'Сопоставить заново'}).click();
 await page.getByRole('button',{name:/Подготовить предложение/}).click();await expect(page.getByRole('button',{name:'Подтверждаю состав и сумму'})).toBeEnabled();
 expect((await(await page.request.get('/api/state')).json()).cart.lines).toHaveLength(0);
 await page.getByRole('button',{name:'Подтверждаю состав и сумму'}).click();await page.getByRole('link',{name:'Открыть корзину',exact:true}).click();await page.reload();
 const cart=(await(await page.request.get('/api/state')).json()).cart;
 expect(cart.lines.map((line:{product:{id:string}})=>line.product.id)).toEqual(['DEMO-C16-IN','DEMO-CABLE']);expect(cart.lines[1].quantity).toBe(0.75);
});

test('a chat card remains selectable after a specification and retains its excluded row',async({page})=>{
 await page.goto('/');await expect(page.getByLabel('Запрос ассистенту')).toBeEnabled();
 await page.locator('input[type=file]').setInputFiles({name:'prior.csv',mimeType:'text/csv',buffer:Buffer.from('Артикул;Количество;Единица\nDEMO-CABLE;2;м')});await page.getByRole('button',{name:'Распознать файл'}).click();
 await page.getByLabel('Товар каталога').selectOption('');await page.getByRole('button',{name:'Сопоставить заново'}).click();
 await expect.poll(async()=>((await(await page.request.get('/api/state')).json()).requestedLines[0].selection)).toBe('excluded');
 await page.getByLabel('Запрос ассистенту').fill('DEMO-C25');await page.getByRole('button',{name:'Отправить сообщение'}).click();
 await page.locator('.product-card').getByRole('button',{name:/предложение/i}).click();
 await expect(page.getByRole('button',{name:'Подтверждаю состав и сумму'})).toBeEnabled();
 const state=await(await page.request.get('/api/state')).json();expect(state.requestedLines[0].selection).toBe('excluded');expect(state.proposal.lines.map((l:{product:{id:string}})=>l.product.id)).toEqual(['DEMO-C25']);
});

test('cart quantity changes require a new explicit source-unit review',async({page,baseURL})=>{
 await page.goto('/');await expect(page.getByLabel('Запрос ассистенту')).toBeEnabled();const state=await(await page.request.get('/api/state')).json();const headers={origin:baseURL!,'x-csrf-token':state.csrf};
 const p=(await(await page.request.post('/api/proposal',{headers,data:{lines:[{productId:'DEMO-CABLE',quantity:2,requestedUnit:'упак',unitConfirmed:true}]}})).json()).proposal;
 await page.request.post('/api/confirm',{headers,data:{proposalId:p.id,version:p.version,hash:p.hash,confirmed:true}});await page.goto('/cart');
 const input=page.getByLabel('Количество DEMO-CABLE',{exact:true});const save=page.getByRole('button',{name:'Сохранить количество DEMO-CABLE'});const review=page.getByRole('checkbox',{name:/Проверил: новое количество/});
 await input.fill('3');await expect(save).toBeDisabled();await review.check();
 const current=await(await page.request.get('/api/state')).json();await page.request.post('/api/cart',{headers,data:{productId:'DEMO-CABLE',quantity:2,revision:current.cart.revision}});
 await save.click();await expect(page.locator('.error-banner')).toBeVisible();await expect(review).not.toBeChecked();await expect(input).toHaveValue('2');
 await input.fill('3');await review.check();await input.fill('4');await expect(review).not.toBeChecked();await review.check();await save.click();await expect(input).toHaveValue('4');await page.reload();await expect(input).toHaveValue('4');
});
