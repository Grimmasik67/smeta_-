'use strict';
const BASE = new URL('./', self.location.href);
const PREFIX = 'smeta-ledger-shell:' + BASE.pathname + ':';
const CACHE = PREFIX + '8.1.0';
const SHELL = new URL('index.html', BASE).href;
const ASSETS = ['index.html', 'pwa.js', 'manifest.webmanifest',
    'icons/apple-touch-icon.png', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png']
    .map(path => new URL(path, BASE).href);
const NAVIGATIONS = new Set([BASE.href, SHELL, new URL('БухУчет_Тест.html', BASE).href]);

self.addEventListener('install', event => {
    event.waitUntil((async () => {
        const cache = await caches.open(CACHE);
        // All-or-nothing install: never advertise offline mode with missing files.
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 12000);
        try { await cache.addAll(ASSETS.map(url => new Request(url, {cache: 'reload', signal: controller.signal}))); }
        finally { clearTimeout(timer); }
        await self.skipWaiting();
    })());
});
self.addEventListener('activate', event => {
    event.waitUntil((async () => {
        const keys = await caches.keys();
        await Promise.all(keys.filter(key => key.startsWith(PREFIX) && key !== CACHE).map(key => caches.delete(key)));
        await self.clients.claim();
    })());
});

async function networkFirst(request, key) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    try {
        const response = await fetch(request, {signal: controller.signal, cache: 'no-store'});
        if (!response.ok) throw new Error('Unsuccessful response');
        // Never replace the app shell with a host error page or a different resource.
        if (key === SHELL && !response.headers.get('content-type')?.includes('text/html')) throw new Error('Not an app page');
        const cache = await caches.open(CACHE);
        try { await cache.put(key, response.clone()); } catch (error) { /* Still return a valid online response if storage is full. */ }
        return response;
    } catch (error) {
        const cached = await caches.match(key, {cacheName: CACHE});
        if (cached) return cached;
        return new Response('Для первого запуска подключись к интернету и открой приложение ещё раз.', {
            status: 503, headers: {'Content-Type': 'text/plain; charset=utf-8'}
        });
    } finally { clearTimeout(timer); }
}

self.addEventListener('fetch', event => {
    const request = event.request;
    if (request.method !== 'GET') return;
    const url = new URL(request.url);
    if (url.origin !== BASE.origin) return;
    url.search = ''; url.hash = '';
    if (request.mode === 'navigate' && NAVIGATIONS.has(url.href)) {
        event.respondWith(networkFirst(request, SHELL));
    } else if (ASSETS.includes(url.href)) {
        event.respondWith(networkFirst(request, url.href));
    }
    // JSON exports, local records, other repositories and arbitrary URLs are never cached here.
});
