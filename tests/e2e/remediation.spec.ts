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
