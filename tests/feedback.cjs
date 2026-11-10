const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const createServer=require('./server.cjs');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const root=path.resolve(__dirname,'..');const server=createServer(root);await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base=`http://127.0.0.1:${server.address().port}/`;let browser;
 const results=[];const test=async(name,fn)=>{await fn();results.push(name);console.log('PASS',name)};
 try{
  browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{})});
  const context=await browser.newContext({acceptDownloads:true});const page=await context.newPage();let promptText='';const errors=[];
  page.on('dialog',d=>d.type()==='prompt'?d.accept(promptText):d.accept());page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base);await page.locator('#projectName').fill('Тест новой формы');let row=page.locator('#expenseBody tr').first();
  await test('Комплектующие сохраняются только по сумме без описания',async()=>{
   assert.equal(await row.locator('.exp-comment').isVisible(),false);await row.locator('.exp-amount').fill('100,50');
   assert.equal(await page.evaluate(()=>App.validateAllRows()),true);assert.equal(await page.evaluate(()=>App.saveProject(true)),true);
   const e=await page.evaluate(()=>App.readProjects()[App.currentProjectId].expenses[0]);assert.equal(e.amount,100.5);assert.equal(e.comment,'');
  });
  await test('Кнопка средней суммы убрана',async()=>assert.equal(await page.getByRole('button',{name:'Подставить среднюю',exact:false}).count(),0));
  await test('Часы спецтехники автоматически считают сумму',async()=>{
   await row.locator('.exp-category').selectOption('equipment');assert.equal(await row.locator('.exp-comment').isVisible(),false);
   await row.locator('.equipment-quantity').fill('6,5');await row.locator('.equipment-rate').fill('1 500,50');
   assert.equal(await row.locator('.exp-amount').inputValue(),'9 753,25');assert.equal(await row.locator('.exp-amount').getAttribute('readonly'),'');
   assert.equal(await page.evaluate(()=>App.validateAllRows()),true);
  });
  await test('Смены и длительность смены сохраняются и восстанавливаются',async()=>{
   await row.locator('.equipment-unit').selectOption('shift');await row.locator('.equipment-quantity').fill('2');await row.locator('.equipment-rate').fill('4500');await row.locator('.equipment-hours').fill('8');
   assert.equal(await row.locator('.exp-amount').inputValue(),'9 000');await page.reload();row=page.locator('#expenseBody tr').first();
   assert.equal(await row.locator('.equipment-unit').inputValue(),'shift');assert.equal(await row.locator('.equipment-hours').inputValue(),'8');assert.equal(await row.locator('.exp-amount').inputValue(),'9 000');
  });
  await test('Копирование спецтехники сохраняет расчёт с новым ID',async()=>{
   await row.getByRole('button',{name:'Копия',exact:false}).click();const e=await page.evaluate(()=>App.readProjects()[App.currentProjectId].expenses);
   assert.equal(e.length,2);assert.notEqual(e[0].uuid,e[1].uuid);assert.deepEqual(e[0].equipment,e[1].equipment);
  });
  await test('Логистика — отдельная категория без полей спецтехники',async()=>{
   const second=page.locator('#expenseBody tr').nth(1);await second.locator('.exp-category').selectOption('logistics');assert.equal(await second.locator('.equipment-fields').isVisible(),false);assert.equal(await second.locator('.exp-comment').isVisible(),true);
   await second.locator('.exp-comment').fill('Доставка на объект');await second.locator('.exp-amount').fill('1500');
   await page.locator('#categoryFilter').selectOption('equipment');assert.equal(await second.isVisible(),false);await page.locator('#categoryFilter').selectOption('logistics');assert.equal(await row.isVisible(),false);await page.locator('#categoryFilter').selectOption('all');
   assert.equal(await row.locator('.exp-category option[value=logistic]').count(),0);
  });
  await test('Частично введённая спецтехника не теряет количество при перезапуске',async()=>{
   await page.evaluate(()=>{App.addExpenseRow();App.autoSave()});const third=page.locator('#expenseBody tr').nth(2);await third.locator('.exp-category').selectOption('equipment');await third.locator('.equipment-quantity').fill('3');await page.reload();
   assert.equal(await page.locator('#expenseBody tr').nth(2).locator('.equipment-quantity').inputValue(),'3');
   await page.locator('#expenseBody tr').nth(2).locator('.equipment-rate').fill('100');
  });
  await test('Недопустимая длительность смены блокирует сохранение, а скрытые поля не мешают другой категории',async()=>{
   const third=page.locator('#expenseBody tr').nth(2);await third.locator('.equipment-unit').selectOption('shift');await third.locator('.equipment-hours').fill('25');assert.equal(await page.evaluate(()=>App.validateMoneyFields()),false);
   await third.locator('.exp-category').selectOption('components');assert.equal(await page.evaluate(()=>App.validateMoneyFields()),true);await third.locator('.exp-amount').fill('300');
  });
  await test('Новые функции подсобника сохраняются в ФОТ',async()=>{
   const third=page.locator('#expenseBody tr').nth(2);await third.locator('.exp-category').selectOption('fot');promptText='Тестовый помощник';await third.getByRole('button',{name:'Добавить сотрудника',exact:true}).click();
   await third.getByText('Подсобные работы',{exact:true}).click();await third.getByText('Погрузка/разгрузка',{exact:true}).click();await third.locator('.exp-amount').fill('2500');
   const e=await page.evaluate(()=>App.readProjects()[App.currentProjectId].expenses[2]);assert.equal(e.comment,'Тестовый помощник');assert.deepEqual(e.tasks,['Подсобные работы','Погрузка/разгрузка']);
  });
  const oldTeamBackup=await page.evaluate(()=>({schemaVersion:3,projects:App.readProjects(),...App.teamBackup()}));
  await test('Удаление сотрудника убирает его из новых списков и сохраняет записанную выплату',async()=>{
   const third=page.locator('#expenseBody tr').nth(2);await third.getByRole('button',{name:'Удалить сотрудника из списка',exact:true}).click();
   assert.equal(await page.evaluate(()=>App.getTeamList().includes('Тестовый помощник')),false);assert.equal(await third.locator('.fot-select').inputValue(),'Тестовый помощник');assert.ok((await third.locator('.fot-select option:checked').innerText()).includes('удалён'));
   assert.equal(await page.evaluate(()=>App.readProjects()[App.currentProjectId].expenses[2].amount),2500);
   await page.evaluate(()=>{App.addExpenseRow();App.autoSave()});const fourth=page.locator('#expenseBody tr').nth(3);await fourth.locator('.exp-category').selectOption('fot');assert.equal(await fourth.locator('.fot-select option[value="Тестовый помощник"]').count(),0);
  });
  await test('Старый JSON не возвращает удалённого сотрудника',async()=>{
   await page.locator('#importFile').setInputFiles({name:'old-team.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(oldTeamBackup))});await page.waitForTimeout(100);assert.equal(await page.evaluate(()=>App.getTeamList().includes('Тестовый помощник')),false);
  });
  await test('Удаление сотрудника передаётся на другое устройство через JSON',async()=>{
   const backup=await page.evaluate(()=>({schemaVersion:3,projects:App.readProjects(),...App.teamBackup()}));const other=await context.newPage();other.on('dialog',d=>d.accept());await other.goto(base);
   const otherContext=await browser.newContext();const fresh=await otherContext.newPage();fresh.on('dialog',d=>d.accept());await fresh.goto(base);await fresh.locator('#importFile').setInputFiles({name:'team.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))});await fresh.waitForTimeout(100);
   assert.equal(await fresh.evaluate(()=>App.getTeamList().includes('Тестовый помощник')),false);await otherContext.close();await other.close();
  });
  await test('Сотрудника можно явно добавить обратно',async()=>{
   const first=page.locator('#expenseBody tr').first();await first.locator('.exp-category').selectOption('fot');promptText='Тестовый помощник';await first.getByRole('button',{name:'Добавить сотрудника',exact:true}).click();assert.equal(await page.evaluate(()=>App.getTeamList().includes('Тестовый помощник')),true);
   await first.locator('.exp-category').selectOption('equipment');
  });
  await test('Дополнительный резерв свёрнут и не меняет остаток денег',async()=>{
   assert.equal(await page.locator('#commissionSettings').getAttribute('open'),null);await page.locator('#commissionSettings summary').click();await page.locator('#cashFee').fill('2');
   const first=page.locator('#expenseBody tr').first();await first.locator('.exp-pay').selectOption('nal');await page.locator('#revenueFact').fill('50000');
   const cash=await page.locator('#realCash').innerText();const profit=await page.locator('#netProfit').innerText();await page.locator('#cashFee').fill('0');assert.equal(await page.locator('#realCash').innerText(),cash);assert.notEqual(await page.locator('#netProfit').innerText(),profit);
  });
  await test('Новый JSON сохраняет расчёт спецтехники и отклоняет неверную сумму',async()=>{
   const result=await page.evaluate(()=>{const data={schemaVersion:3,projects:App.readProjects(),...App.teamBackup()};const ok=App.normalizeBackup(data);const first=Object.values(data.projects)[0].expenses.find(e=>e.category==='equipment');first.amount+=1;let rejected=false;try{App.normalizeBackup(data)}catch(e){rejected=true}return {ok:Object.values(ok.projects)[0].expenses.find(e=>e.category==='equipment').equipment,rejected}});
   assert.equal(result.ok.unit,'shift');assert.equal(result.rejected,true);
  });
  await test('CSV содержит часы, смены и ставки',async()=>{
   const promise=page.waitForEvent('download');await page.evaluate(()=>App.exportCSV());const file=await promise;const text=fs.readFileSync(await file.path(),'utf8');assert.ok(text.includes('Часов в смене'));assert.ok(text.includes('"смена";"2";"4500,00";"8"'));
  });
  await test('Новая форма помещается на экран телефона',async()=>{
   await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:path.join(root,'.test-results/feedback-mobile.png'),fullPage:true});
   await page.setViewportSize({width:1280,height:900});await page.screenshot({path:path.join(root,'.test-results/feedback-desktop.png'),fullPage:true});
  });
  await test('Нет ошибок выполнения',async()=>assert.deepEqual(errors,[]));
  fs.writeFileSync(path.join(root,'.test-results/feedback-results.json'),JSON.stringify({passed:results.length,tests:results},null,2));await context.close();
 }finally{await browser?.close();server.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
