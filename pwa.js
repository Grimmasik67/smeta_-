/* Installation and offline availability are independent of the expense database. */
(() => {
    'use strict';
    const standalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
    const status = document.getElementById('appConnectionStatus');
    const help = document.getElementById('installHelp');
    const button = document.getElementById('installApp');
    let installEvent = null;
    let offlineReady = false;
    const render = () => {
        if (help) help.hidden = standalone();
        if (button) button.hidden = standalone() || !installEvent;
        if (status) status.textContent = offlineReady
            ? (navigator.onLine ? 'Готово к работе без интернета' : 'Без интернета · записи сохраняются на устройстве')
            : (navigator.onLine ? 'Подготавливаю работу без интернета…' : 'Для первого запуска нужен интернет');
    };
    window.addEventListener('beforeinstallprompt', event => {
        event.preventDefault(); installEvent = event; render();
    });
    window.addEventListener('appinstalled', () => { installEvent = null; render(); });
    button?.addEventListener('click', async () => {
        if (!installEvent) return;
        const event = installEvent; installEvent = null; render();
        try { await event.prompt(); await event.userChoice; }
        catch (error) { console.info('Installation was not completed.', error); }
    });
    window.addEventListener('online', render);
    window.addEventListener('offline', render);
    async function setup() {
        if (!/^https?:$/.test(location.protocol) || !('serviceWorker' in navigator) || !window.isSecureContext) {
            if (status) status.textContent = 'Установка доступна по ссылке на сайт приложения';
            return;
        }
        render();
        try {
            const base = new URL('./', location.href);
            const registration = await navigator.serviceWorker.register(new URL('sw.js', base), {scope: base.pathname, updateViaCache: 'none'});
            // ready resolves only after all required files have been saved by the worker.
            await new Promise((resolve, reject) => {
                const installing = registration.installing;
                const changed = () => { if (installing?.state === 'redundant') finish(new Error('Offline files were not saved.')); };
                const timer = setTimeout(() => finish(new Error('Offline preparation timed out.')), 16000);
                function finish(error) {
                    clearTimeout(timer); installing?.removeEventListener('statechange', changed);
                    error ? reject(error) : resolve();
                }
                installing?.addEventListener('statechange', changed);
                changed();
                navigator.serviceWorker.ready.then(() => finish(), finish);
            });
            offlineReady = true; render();
            if (standalone() && navigator.storage?.persist) {
                try { await navigator.storage.persist(); } catch (error) { /* Storage remains best effort. */ }
            }
        } catch (error) {
            if (status) status.textContent = 'Сейчас доступна онлайн-версия. Для подготовки работы без интернета открой приложение позже.';
            console.info('Offline preparation was not completed.', error);
        }
    }
    if (document.readyState === 'complete') setup();
    else window.addEventListener('load', setup, {once: true});
})();
