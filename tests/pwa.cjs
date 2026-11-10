const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const createStaticServer = require('./server.cjs');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
    const root = path.resolve(__dirname, '..');
    const artifacts = path.join(root, '.test-results'); fs.mkdirSync(artifacts, {recursive:true});
    let release = '8.2.0';
    let failAsset = false;
    let failNavigation = false;
    const server = createStaticServer(root, {prefix:'/smeta_-/', transform(relative, body) {
        if (relative === 'icons/icon-512.png' && failAsset) return {status:503};
        if (relative === 'index.html' && failNavigation) return {status:503};
        if (relative === 'sw.js') return {body:Buffer.from(body.toString().replace("'8.2.0'", "'" + release + "'"))};
        if (relative === 'index.html' && release !== '8.2.0') return {body:Buffer.from(body.toString().replace(/v8.2/g,'v8.3'))};
    }});
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const base = `http://127.0.0.1:${server.address().port}/smeta_-/`;
    const results=[];
    const test=async(name,fn)=>{await fn();results.push(name);console.log('PASS',name)};
    let browser;
    try {
        browser = await chromium.launch({headless:true, ...(process.env.CHROME_EXECUTABLE ? {executablePath:process.env.CHROME_EXECUTABLE} : {})});
        const context = await browser.newContext({acceptDownloads:true,viewport:{width:390,height:844}});
        const page=await context.newPage(); const errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
        await page.goto(base+'?v=8.1');
        await page.waitForFunction(()=>navigator.serviceWorker.controller && document.querySelector('#appConnectionStatus').textContent.includes('Готово'));
        await test('Манифест запускает приложение отдельно в правильной подпапке',async()=>{
            const manifest=await page.evaluate(async()=>await (await fetch(document.querySelector('link[rel=manifest]').href)).json());
            assert.equal(manifest.display,'standalone');assert.equal(new URL(manifest.start_url,base).href,base);assert.equal(new URL(manifest.scope,base).href,base);
            assert.equal(manifest.short_name,'Затраты');assert.equal(await page.locator('meta[name=apple-mobile-web-app-capable]').getAttribute('content'),'yes');
        });
        await test('Значки iPhone и Android доступны в правильных размерах',async()=>{
            for (const [file,size] of [['apple-touch-icon.png',180],['icon-192.png',192],['icon-512.png',512],['icon-maskable-512.png',512]]) {
                const response=await context.request.get(base+'icons/'+file);const png=await response.body();assert.equal(response.status(),200);assert.equal(png.subarray(1,4).toString(),'PNG');assert.equal(png.readUInt32BE(16),size);assert.equal(png.readUInt32BE(20),size);
            }
        });
        await test('Офлайн-копия содержит только файлы приложения',async()=>{
            const keys=await page.evaluate(async()=>{const names=await caches.keys();const cache=await caches.open(names.find(n=>n.startsWith('smeta-ledger-shell:')));return (await cache.keys()).map(r=>new URL(r.url).pathname)});
            assert.equal(keys.length,7);assert.ok(keys.every(p=>p.startsWith('/smeta_-/')));assert.ok(keys.includes('/smeta_-/index.html'));
        });
        await test('Запуск и ввод расходов без интернета',async()=>{
            await page.locator('#projectName').fill('Офлайн объект');await page.locator('.exp-category').selectOption('cables');await page.locator('.exp-comment').fill('Кабель');await page.locator('.exp-amount').fill('123,45');
            await context.setOffline(true);await page.reload();await page.waitForFunction(()=>document.querySelector('#appConnectionStatus').textContent.includes('Без интернета'));
            assert.equal(await page.locator('#projectName').inputValue(),'Офлайн объект');assert.equal(await page.locator('.exp-amount').inputValue(),'123,45');
            await page.locator('.exp-amount').fill('456,78');assert.equal(await page.evaluate(()=>App.readProjects()[App.currentProjectId].expenses[0].amount),456.78);
        });
        await test('Новый запуск с ярлыка без сети восстанавливает базу',async()=>{
            const reopened=await context.newPage();reopened.on('dialog',d=>d.accept());await reopened.goto(base);
            assert.equal(await reopened.locator('#projectName').inputValue(),'Офлайн объект');assert.equal(await reopened.locator('.exp-amount').inputValue(),'456,78');await reopened.close();
        });
        await test('Старая ссылка и ссылка с параметрами работают без сети',async()=>{
            await page.goto(base+'%D0%91%D1%83%D1%85%D0%A3%D1%87%D0%B5%D1%82_%D0%A2%D0%B5%D1%81%D1%82.html?v=8.0');assert.equal(await page.locator('#projectName').inputValue(),'Офлайн объект');
            await page.goto(base+'index.html?v=8.1');assert.equal(await page.locator('.exp-amount').inputValue(),'456,78');
        });
        await test('Выгрузка JSON работает без сети',async()=>{
            const waiting=page.waitForEvent('download');await page.evaluate(()=>App.exportBackup());const file=await waiting;
            const backup=JSON.parse(fs.readFileSync(await file.path(),'utf8'));assert.ok(Object.values(backup.projects).some(p=>p.expenses[0]?.amount===456.78));
        });
        await context.setOffline(false);
        await test('Ошибка сервера не заменяет рабочую офлайн-копию',async()=>{
            failNavigation=true;await page.reload();assert.ok((await page.title()).includes('v8.2'));failNavigation=false;
        });
        await test('Обновление не перезагружает открытый объект и не стирает базу',async()=>{
            await page.evaluate(async()=>{await caches.open('other-app:cache');await caches.open('smeta-ledger-shell:/another/:1')});
            const storage=await page.evaluate(()=>localStorage.getItem('ledProjects'));
            release='8.3.0';await page.evaluate(async()=>{const registration=await navigator.serviceWorker.getRegistration();await registration.update()});
            await page.waitForFunction(async()=>(await caches.keys()).some(key=>key.endsWith(':8.3.0')) && !(await caches.keys()).some(key=>key.endsWith(':8.2.0')));
            assert.ok((await page.title()).includes('v8.2'));assert.equal(await page.locator('#projectName').inputValue(),'Офлайн объект');assert.equal(await page.evaluate(()=>localStorage.getItem('ledProjects')),storage);
            const keys=await page.evaluate(()=>caches.keys());assert.ok(keys.includes('other-app:cache'));assert.ok(keys.includes('smeta-ledger-shell:/another/:1'));
            await page.reload();assert.ok((await page.title()).includes('v8.3'));assert.equal(await page.locator('.exp-amount').inputValue(),'456,78');
        });
        await test('Чужие адреса и JSON не подменяются страницей приложения',async()=>{
            for (const url of [new URL('/another/',base).href,base+'unknown.json']) {
                const status=await page.evaluate(async(url)=>(await fetch(url)).status,url);assert.equal(status,404);
            }
        });
        await test('Установленный режим скрывает инструкцию, оставляя доступ к базе',async()=>{
            const standalone=await browser.newContext();await standalone.addInitScript(()=>Object.defineProperty(navigator,'standalone',{value:true}));
            const p=await standalone.newPage();await p.goto(base);await p.waitForFunction(()=>document.querySelector('#installHelp').hidden);
            assert.equal(await p.locator('#installHelp').isVisible(),false);assert.equal(await p.locator('#projectName').isVisible(),true);await standalone.close();
        });
        await test('Сбой подготовки офлайна показан честно',async()=>{
            failAsset=true;const broken=await browser.newContext();const p=await broken.newPage();await p.goto(base);
            await p.waitForFunction(()=>document.querySelector('#appConnectionStatus').textContent.includes('онлайн-версия'),{timeout:20000});
            assert.equal((await p.locator('#appConnectionStatus').innerText()).includes('Готово'),false);await broken.close();failAsset=false;
        });
        await test('Мобильная инструкция помещается на экран',async()=>{
            await page.locator('#installHelp').evaluate(el=>el.open=true);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
            await page.screenshot({path:path.join(artifacts,'pwa-install-mobile.png'),fullPage:true});
        });
        await test('Нет ошибок выполнения JavaScript',async()=>assert.deepEqual(errors,[]));
        await context.close();
        fs.writeFileSync(path.join(artifacts,'pwa-results.json'),JSON.stringify({passed:results.length,tests:results},null,2));
    } finally {await browser?.close();server.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
