const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
module.exports = function createStaticServer(root, {prefix = '/', transform} = {}) {
    return http.createServer((request, response) => {
        const url = new URL(request.url, 'http://localhost');
        if (!url.pathname.startsWith(prefix)) { response.writeHead(404); return response.end('Not found'); }
        let relative;
        try { relative = decodeURIComponent(url.pathname.slice(prefix.length)); }
        catch { response.writeHead(400); return response.end('Invalid path'); }
        if (!relative) relative = 'index.html';
        if (relative === 'old') relative = 'БухУчет_Тест.html';
        const filename = path.resolve(root, relative);
        if (!filename.startsWith(path.resolve(root) + path.sep)) { response.writeHead(403); return response.end('Forbidden'); }
        try {
            let body = fs.readFileSync(filename);
            const modified = transform?.(relative, body);
            if (modified?.status) { response.writeHead(modified.status); return response.end('Temporarily unavailable'); }
            if (modified?.body) body = modified.body;
            const types = {'.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.webmanifest':'application/manifest+json', '.png':'image/png'};
            response.writeHead(200, {'Content-Type': types[path.extname(filename)] || 'application/octet-stream', 'Cache-Control':'no-store'});
            response.end(body);
        } catch { response.writeHead(404); response.end('Not found'); }
    });
};
