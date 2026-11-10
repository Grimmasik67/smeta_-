// Browser-side bridge tests. These do not replace a test on a physical Android device.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const createServer=require('./server.cjs');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const root=path.resolve(__dirname,'..');const assets=path.join(root,'native/android/build/assets');
 const server=createServer(assets);await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base=`http://127.0.0.1:${server.address().port}/`;const tests=[];let browser;
 try{
  browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{})});
  const context=await browser.newContext();await context.addInitScript(()=>{window.nativeFiles=[];window.NativeFiles={saveText(content,type,name){window.nativeFiles.push({content,type,name})}}});
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  const test=async(name,fn)=>{await fn();tests.push(name);console.log('PASS',name)};
  await page.goto(base);
  await test('Встроенная версия запускается без веб-установки',async()=>{assert.equal(await page.locator('#installHelp').isVisible(),false);assert.ok((await page.locator('#appConnectionStatus').innerText()).includes('Работает без интернета'));assert.equal(await page.locator('script[src="./pwa.js"]').count(),0)});
  await page.locator('#projectName').fill('Android тест');await page.locator('.exp-category').selectOption('cables');await page.locator('.exp-comment').fill('Кабель «ВВГ»');await page.locator('.exp-amount').fill('123,45');
  await test('JSON передаётся системному сохранению без потери кириллицы и копеек',async()=>{
   await page.evaluate(()=>App.exportBackup());const file=await page.evaluate(()=>nativeFiles[0]);const data=JSON.parse(file.content);assert.equal(file.type,'application/json');assert.ok(Object.values(data.projects).some(p=>p.expenses[0]?.comment==='Кабель «ВВГ»'&&p.expenses[0].amount===123.45));await page.evaluate(()=>NativeExportFinished(true));
  });
  await test('CSV передаётся системному сохранению с копейками',async()=>{await page.evaluate(()=>App.exportCSV());assert.ok((await page.evaluate(()=>nativeFiles[1].content)).includes('123,45'));await page.evaluate(()=>NativeExportFinished(true))});
  const backup=await page.evaluate(()=>localStorage.getItem('ledProjects'));
  await test('Отмена сохранения не очищает базу',async()=>{
   await page.evaluate(()=>{window.operation=App.hardReset()});await page.waitForFunction(()=>nativeFiles.length===3);assert.equal(await page.evaluate(()=>localStorage.getItem('ledProjects')),backup);await page.evaluate(async()=>{NativeExportFinished(false);await operation});assert.equal(await page.evaluate(()=>localStorage.getItem('ledProjects')),backup);
  });
  await test('Очистка происходит только после подтверждённого сохранения',async()=>{
   await page.evaluate(()=>{window.operation=App.hardReset()});await page.waitForFunction(()=>nativeFiles.length===4);await page.evaluate(async()=>{NativeExportFinished(true);await operation});assert.equal(await page.evaluate(()=>localStorage.getItem('ledProjects')),'{}');assert.equal(await page.evaluate(()=>localStorage.getItem('ledRecovery')),backup);
  });
  await page.locator('#projectName').fill('Новый объект');await page.locator('.exp-category').selectOption('cables');await page.locator('.exp-comment').fill('Новая запись');await page.locator('.exp-amount').fill('200');
  const current=await page.evaluate(()=>localStorage.getItem('ledProjects'));
  await test('Отмена выгрузки перед восстановлением сохраняет текущую базу',async()=>{
   await page.evaluate(()=>{window.operation=App.restoreRecovery()});await page.waitForFunction(()=>nativeFiles.length===5);await page.evaluate(async()=>{NativeExportFinished(false);await operation});assert.equal(await page.evaluate(()=>localStorage.getItem('ledProjects')),current);
  });
  await test('Восстановление меняет базу после сохранения текущей копии',async()=>{
   await page.evaluate(()=>{window.operation=App.restoreRecovery()});await page.waitForFunction(()=>nativeFiles.length===6);await page.evaluate(async()=>{NativeExportFinished(true);await operation});assert.equal(await page.evaluate(()=>localStorage.getItem('ledProjects')),backup);
  });
  await test('Импорт JSON остаётся совместимым с браузерной версией',async()=>{
   await page.locator('#importFile').setInputFiles({name:'from-browser.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({schemaVersion:2,projects:JSON.parse(backup),team:[]}))});await page.waitForFunction(()=>document.querySelector('#undoChange').style.display!=='none');assert.ok(await page.evaluate(()=>Object.values(App.readProjects()).some(p=>p.name==='Android тест')));
  });
  await test('Нет ошибок выполнения JavaScript',async()=>assert.deepEqual(errors,[]));
  fs.writeFileSync(path.join(root,'.test-results/android-results.json'),JSON.stringify({passed:tests.length,tests},null,2));await context.close();
 }finally{await browser?.close();server.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
