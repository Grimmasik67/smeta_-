const assert = require('node:assert/strict');
const fs = require('node:fs');
const createStaticServer = require('./server.cjs');
const path = require('node:path');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
 const root = path.resolve(__dirname, '..');
 const server = createStaticServer(root);
 await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
 const base = `http://127.0.0.1:${server.address().port}`;
 const results = [];
 const artifacts = path.join(root, '.test-results'); fs.mkdirSync(artifacts, {recursive:true});
 let browser;
 try {
 browser = await chromium.launch({headless:true, ...(process.env.CHROME_EXECUTABLE ? {executablePath:process.env.CHROME_EXECUTABLE} : {})});
 const context = await browser.newContext({acceptDownloads:true});
 const page = await context.newPage();
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 page.on('dialog',dialog=>dialog.accept());
 await page.goto(base);
 await page.waitForFunction(()=>typeof App !== 'undefined' && !App.loading);
 const test = async (name, fn) => {await fn();results.push(name);console.log('PASS',name)};
 const evalApp = fn=>page.evaluate(fn);
 await test('Чистый запуск без ошибок',async()=>{assert.deepEqual(errors,[]);assert.equal(await page.locator('#expenseBody tr').count(),1);assert.equal(await page.locator('#revenueFact').inputValue(),'0')});
 await test('Денежный ввод сохраняет копейки',async()=>{
  await page.locator('#projectName').fill('Объект «А»');
  await page.locator('.exp-category').selectOption('cables');await page.locator('.exp-comment').fill('Кабель "ВВГ" <50 м>');
  await page.locator('.exp-amount').fill('1 234,56');
  assert.equal(await evalApp(()=>App.getNumber(document.querySelector('.exp-amount').value)),1234.56);
  assert.equal(await evalApp(()=>Object.values(App.readProjects())[0].expenses[0].amount),1234.56);
 });
 let projectId=await evalApp(()=>App.currentProjectId);
 await test('Перезагрузка сохраняет объект, название и описание с кавычками',async()=>{
  await page.reload();assert.equal(await evalApp(()=>App.currentProjectId),projectId);
  assert.equal(await page.locator('#projectName').inputValue(),'Объект «А»');
  assert.equal(await page.locator('.exp-comment').inputValue(),'Кабель "ВВГ" <50 м>');
  await page.reload();assert.equal(await evalApp(()=>App.currentProjectId),projectId);
  assert.equal(await page.locator('#projectName').inputValue(),'Объект «А»');
 });
 await test('Изменение суммы не теряет фокус и не перерисовывает строку',async()=>{
  await page.locator('.exp-amount').fill('200,75');
  assert.equal(await page.locator('.exp-amount').evaluate(el=>el===document.activeElement),true);
  assert.equal(await evalApp(()=>App.readProjects()[App.currentProjectId].expenses[0].amount),200.75);
 });
 await test('Неверная сумма не перезаписывает сохранённую',async()=>{
  await page.locator('.exp-amount').fill('12,345');
  assert.equal(await page.locator('.exp-amount').evaluate(el=>el.checkValidity()),false);
  assert.equal(await evalApp(()=>App.readProjects()[App.currentProjectId].expenses[0].amount),200.75);
  await page.locator('.exp-amount').fill('200,75');
 });
 await test('Фактический остаток и категории совпадают с платежами',async()=>{
  await page.locator('#revenueFact').fill('1 000,50');
  await page.locator('.exp-pay').selectOption('npd');
  assert.equal(await page.locator('#realCash').innerText(),'799,75 ₽');
  await evalApp(()=>App.showDashboard());
  assert.equal((await page.locator('#dashBody tr td').nth(5).innerText()).replace(/\s/g,''),'200,75₽');
  await evalApp(()=>App.closeDashboard());
 });
 await test('Аванс рассчитывается с копейками',async()=>{
  await page.locator('#revenuePlan').fill('100,01');await page.locator('#advancePercent').fill('50');
  assert.equal(await page.locator('#revenueFact').inputValue(),'50,01');
 });
 await test('Нулевой лимит сбрасывает индикатор бюджета',async()=>{
  await page.locator('#expensePlan').fill('100');await page.locator('#expensePlan').fill('0');
  assert.equal(await page.locator('#budgetPercentText').innerText(),'0.0%');
 });
 await test('Средняя сумма не дублирует расходы при сохранениях',async()=>{
  await evalApp(()=>{App.saveProject(true);App.saveProject(true)});
  assert.deepEqual(await evalApp(()=>App.getAmountHistory().cables),[200.75]);
 });
 await test('Новая пустая строка не попадает в базу',async()=>{
  await evalApp(()=>{App.addExpenseRow();App.autoSave()});
  assert.equal(await evalApp(()=>App.readProjects()[App.currentProjectId].expenses.length),1);
 });
 await test('Редактирование и удаление через импорт v8, повторный импорт',async()=>{
  await evalApp(()=>{window.savedBackup={schemaVersion:2,projects:structuredClone(App.readProjects())};window.edited=structuredClone(savedBackup);const p=edited.projects[App.currentProjectId];p.expenses[0].amount=333.33;p.expenses[0].updatedAt=App.stamp()+100;p.revenueFact='30';p.fieldTimes.revenueFact=App.stamp()+100;});
  const backup=await evalApp(()=>JSON.stringify(edited));
  await page.locator('#importFile').setInputFiles({name:'updated.json',mimeType:'application/json',buffer:Buffer.from(backup)});
  await page.waitForFunction(()=>App.readProjects()[App.currentProjectId]?.expenses[0]?.amount===333.33);
  assert.equal(await page.locator('#revenueFact').inputValue(),'30');
  const deleted=await evalApp(()=>{const b=structuredClone(edited);const p=b.projects[App.currentProjectId];p.deletedExpenses={[p.expenses[0].uuid]:App.stamp()+200};p.expenses=[];return JSON.stringify(b)});
  await page.locator('#importFile').setInputFiles({name:'deleted.json',mimeType:'application/json',buffer:Buffer.from(deleted)});
  await page.waitForFunction(()=>App.readProjects()[App.currentProjectId].expenses.length===0);
  await page.locator('#importFile').setInputFiles({name:'old.json',mimeType:'application/json',buffer:Buffer.from(backup)});
  await page.waitForTimeout(100);
  assert.equal(await evalApp(()=>App.readProjects()[App.currentProjectId].expenses.length),0);
 });
 await test('Импорт старого файла переносит исправления, не теряет сотрудников',async()=>{
  const legacy=await evalApp(()=>{const b=structuredClone(savedBackup);delete b.schemaVersion;const p=b.projects[App.currentProjectId];p.expenses[0].uuid='legacy_new';delete p.expenses[0].updatedAt;p.expenses[0].amount=12.34;delete p.fieldTimes;p.revenueFact='10';b.team=['Новый сотрудник'];return JSON.stringify(b)});
  await page.locator('#importFile').setInputFiles({name:'legacy.json',mimeType:'application/json',buffer:Buffer.from(legacy)});
  await page.waitForFunction(()=>App.readProjects()[App.currentProjectId].expenses.some(e=>e.uuid==='legacy_new'));
  assert.equal(await page.locator('#revenueFact').inputValue(),'10');
  assert.equal(await evalApp(()=>App.getTeamList().includes('Новый сотрудник')),true);
  assert.equal(await evalApp(()=>App.getTeamList().includes(App.defaultTeam[0])),true);
 });
 await test('Плохой файл и повтор UUID не меняют базу',async()=>{
  const original=await evalApp(()=>localStorage.getItem('ledProjects'));
  for(const bad of [{projects:[]},{projects:{a:{expenses:[{uuid:'a',amount:1,category:'other',pay:'nal',comment:'x'},{uuid:'a',amount:2,category:'other',pay:'nal',comment:'y'}]}}},JSON.parse('{"projects":{"__proto__":{"expenses":[]}}}')]){
   await page.locator('#importFile').setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(bad))});await page.waitForTimeout(50);
   assert.equal(await evalApp(()=>localStorage.getItem('ledProjects')),original);
  }
 });
 await test('Описание HTML не выполняется; CSV экранирует формулы',async()=>{
  await page.locator('.exp-comment').first().fill('"><img src=x onerror="window.injected=true">');
  await page.reload();assert.equal(await evalApp(()=>window.injected===true),false);
  assert.equal(await page.locator('#expenseBody img').count(),0);
  assert.equal(await evalApp(()=>App.csvCell('=1+1')),'"\'=1+1"');
  assert.equal(await evalApp(()=>App.csvCell('a"b')),'"a""b"');
 });
 await test('Копирование зарплаты сохраняет выбранного сотрудника',async()=>{
  await page.locator('.exp-category').first().selectOption('fot');
  await page.locator('.fot-select').first().selectOption('Новый сотрудник');
  await evalApp(()=>App.duplicateRow(document.querySelector('#expenseBody tr button')));
  assert.equal(await page.locator('.fot-select').nth(1).inputValue(),'Новый сотрудник');
 });
 await test('Ошибка записи видна, новая запись доступна для выгрузки',async()=>{
  await evalApp(()=>{window.originalSet=Storage.prototype.setItem;Storage.prototype.setItem=function(){throw new Error('QuotaExceededError')}});
  await page.locator('#projectName').fill('Не потерять');
  assert.equal(await page.locator('#saveIndicator').innerText(),'Не сохранено — выгрузи базу');
  assert.equal(await evalApp(()=>JSON.parse(StorageService.get('ledProjects'))[App.currentProjectId].name),'Не потерять');
  const downloadPromise=page.waitForEvent('download');await evalApp(()=>App.exportBackup());const download=await downloadPromise;
  const exported=JSON.parse(fs.readFileSync(await download.path(),'utf8'));assert.equal(exported.projects[projectId].name,'Не потерять');
  await evalApp(()=>{Storage.prototype.setItem=originalSet;App.saveProject(true)});
 });
 await test('Две вкладки сохраняют независимые изменения',async()=>{
  const other=await context.newPage();other.on('dialog',d=>d.accept());await other.goto(base);
  await page.locator('#revenuePlan').fill('2222,22');
  await other.locator('.exp-amount').first().fill('99,99');
  assert.equal(await evalApp(()=>App.getNumber(App.readProjects()[App.currentProjectId].revenuePlan)),2222.22);
  assert.equal(await evalApp(()=>App.readProjects()[App.currentProjectId].expenses[0].amount),99.99);
  await other.close();
 });
 await test('Экспорт CSV включает актуальные копейки',async()=>{
  const downloadPromise=page.waitForEvent('download');await evalApp(()=>App.exportCSV());const download=await downloadPromise;
  const csv=fs.readFileSync(await download.path(),'utf8');assert.ok(csv.includes('"12,34"')||csv.includes('"99,99"'));
 });
 await test('Черновик без названия восстанавливается после перезапуска',async()=>{
  await evalApp(()=>{App.isDirty=false;App.clearProject()});await page.locator('.exp-category').selectOption('cables');await page.locator('.exp-comment').fill('Черновой расход');await page.locator('.exp-amount').fill('45,67');
  await page.reload();assert.equal(await page.locator('.exp-comment').inputValue(),'Черновой расход');assert.equal(await evalApp(()=>App.getNumber(document.querySelector('.exp-amount').value)),45.67);
 });
 await test('Старая ссылка открывает исправленную версию',async()=>{
  await page.goto(base+'/old');await page.waitForURL(base+'/index.html');assert.ok((await page.title()).includes('v8.2'));
 });
 await test('Мобильная ширина без горизонтального выхода страницы',async()=>{
  await page.setViewportSize({width:390,height:844});assert.equal(await evalApp(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:path.join(artifacts,'mobile-v8.png'),fullPage:true});
  await page.setViewportSize({width:1280,height:900});await page.screenshot({path:path.join(artifacts,'desktop-v8.png'),fullPage:true});
 });
 await test('Старые случайные ID и названия не мигрируют повторно',async()=>{
  await evalApp(()=>{App.isDirty=false;localStorage.removeItem('ledDraft');localStorage.setItem('ledLastProject','randomold');localStorage.setItem('ledProjects',JSON.stringify({randomold:{name:'Старый объект',revenuePlan:'100',revenueFact:'50',expensePlan:'70',tax_system:'usn6',cashFee:'0',targetMargin:'35',expenses:[{category:'other',comment:'Старый чек',pay:'nal',amount:10.25,docs:false}]}}))});
  await page.reload();assert.equal(await page.locator('#projectName').inputValue(),'Старый объект');
  const id=await evalApp(()=>App.readProjects().randomold.expenses[0].uuid);
  await page.reload();assert.equal(await page.locator('#projectName').inputValue(),'Старый объект');assert.equal(await evalApp(()=>App.readProjects().randomold.expenses[0].uuid),id);
 });
 await test('Пустая сумма контракта экспортируется и импортируется',async()=>{
  await page.locator('#revenuePlan').fill('');
  const result=await evalApp(()=>{const backup={schemaVersion:2,projects:App.readProjects()};return App.normalizeBackup(backup).projects[App.currentProjectId].revenuePlan});assert.equal(result,'0');
 });
 await test('Удаление объекта сохраняет его резервную копию и отметку',async()=>{
  await evalApp(()=>App.deleteProject());
  assert.ok(await evalApp(()=>App.readProjects().randomold.deletedAt>0));
  assert.equal(await page.locator('#savedProjects option[value="randomold"]').count(),0);
  assert.equal(await page.locator('#undoChange').isVisible(),true);
 });
 await test('Возврат прежней базы восстанавливает удалённый объект',async()=>{
  const downloadPromise=page.waitForEvent('download');await evalApp(()=>App.restoreRecovery());await downloadPromise;
  assert.equal(await evalApp(()=>App.readProjects().randomold.name),'Старый объект');
  assert.equal(await page.locator('#savedProjects option[value="randomold"]').count(),1);
 });
 await test('Новый объект не стирает неназванный черновик',async()=>{
  await page.locator('.exp-category').selectOption('cables');await page.locator('.exp-comment').fill('Не потерять черновик');await page.locator('.exp-amount').fill('0,01');
  await evalApp(()=>App.clearProject());
  assert.ok(await evalApp(()=>Object.values(App.readProjects()).some(p=>p.expenses.some(e=>e.comment==='Не потерять черновик'&&e.amount===0.01))));
 });
 await test('Сбой доступа при запуске не ломает интерфейс',async()=>{
  const restricted=await browser.newContext();await restricted.addInitScript(()=>{Storage.prototype.setItem=function(){throw new Error('SecurityError')}});
  const p=await restricted.newPage();const crash=[];p.on('pageerror',e=>crash.push(e.message));p.on('dialog',d=>d.accept());await p.goto(base);assert.deepEqual(crash,[]);assert.equal(await p.locator('#iosWarning').isVisible(),true);await restricted.close();
 });
 await test('Нет ошибок выполнения JavaScript',async()=>assert.deepEqual(errors,[]));
 await context.close();
 fs.writeFileSync(path.join(artifacts,'test-results.json'),JSON.stringify({passed:results.length,tests:results},null,2));
 } finally {await browser?.close();server.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
