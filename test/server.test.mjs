import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as pause } from 'node:timers/promises';

let mock, child, origin, base, cookie, authorization, sends = 0;
const reads = [];
before(async () => {
  mock = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/v1/info') return res.end(JSON.stringify({ app: { version: 'mock' } }));
    if (req.url === '/oauth/register') {
      const input = JSON.parse(raw); assert.equal(input.client_name, 'MSN Revival'); assert.equal(input.token_endpoint_auth_method, 'none');
      return res.end(JSON.stringify({ client_id: 'test-client' }));
    }
    if (req.url === '/oauth/token') {
      const input = new URLSearchParams(raw); assert.equal(input.get('code'), 'approved'); assert.ok(input.get('code_verifier').length >= 43);
      return res.end(JSON.stringify({ access_token: 'secret-test-token' }));
    }
    if (req.headers.authorization !== 'Bearer secret-test-token') { res.statusCode = 401; return res.end('{}'); }
    if (req.url.split('?')[0] === '/v1/chats/chat-1/read' && req.method === 'POST') {
      reads.push(JSON.parse(raw)); return res.end(JSON.stringify({ id: 'chat-1', unreadCount: 0, isMarkedUnread: false }));
    }
    if (req.url.split('?')[0] === '/v1/accounts') return res.end(JSON.stringify([{ accountID: 'a', user: { imgURL: 'mxc://me' } }]));
    if (req.url === '/v1/assets/upload') { assert.match(req.headers['content-type'], /multipart\/form-data/); assert.match(raw, /name="file"/); return res.end(JSON.stringify({ uploadID: 'upload-test' })); }
    if (req.url.split('?')[0] === '/v1/chats/chat-1/messages' && req.method === 'GET') return res.end(JSON.stringify({ items: [{ id: 'msg-media', attachments: [{ id: 'mxc://video', type: 'video', mimeType: 'video/mp4', fileName: 'vidéo.mp4' }, { id: 'mxc://html', type: 'unknown', fileName: 'document.html' }], links: [{ url: 'https://www.instagram.com/reel/demo/', title: 'Reel', img: 'mxc://preview' }] }], hasMore: false }));
    if (req.url.startsWith('/v1/assets/serve?')) {
      const asset = new URL(req.url, 'http://test').searchParams.get('url');
      if (asset === 'mxc://video') {
        const bytes = Buffer.from('0123456789'); res.setHeader('Content-Type', 'video/mp4'); res.setHeader('Accept-Ranges', 'bytes');
        if (req.headers.range === 'bytes=3-6') { res.writeHead(206, { 'Content-Range': 'bytes 3-6/10', 'Content-Length': '4' }); return res.end(bytes.subarray(3, 7)); }
        if (req.headers.range) { res.writeHead(416, { 'Content-Range': 'bytes */10' }); return res.end(); }
        res.setHeader('Content-Length', '10'); return res.end(bytes);
      }
      if (asset === 'mxc://html') { res.setHeader('Content-Type', 'text/html'); return res.end('<script>alert(1)</script>'); }
      res.setHeader('Content-Type', 'application/octet-stream'); return res.end(Buffer.from([255, 216, 255, 224]));
    }
    if (req.method === 'POST') { const input = JSON.parse(raw); if (input.attachment) assert.equal(input.attachment.uploadID, 'upload-test'); else assert.equal(input.text, 'Test simulé'); sends++; return res.end(JSON.stringify({ pendingMessageID: 'pending-1' })); }
    res.end(JSON.stringify({ items: [{ id: 'chat-1', title: 'Simulation' }], hasMore: false }));
  });
  mock.listen(0, '127.0.0.1'); await once(mock, 'listening'); base = `http://127.0.0.1:${mock.address().port}`;
  const reservation = http.createServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening'); const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
  origin = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ['server.mjs'], { cwd: new URL('..', import.meta.url), env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
  for (let i = 0; i < 100; i++) { try { const response = await fetch(origin); cookie = response.headers.get('set-cookie').split(';')[0]; return; } catch { await pause(50); } }
  throw new Error('Serveur de test inaccessible');
});
after(async () => { child?.kill(); if (mock) await new Promise(resolve => mock.close(resolve)); });
function call(path, options = {}) { return fetch(origin + path, { ...options, headers: { cookie, ...(options.body ? { 'Content-Type': 'application/json', Origin: origin } : {}), ...options.headers }, redirect: 'manual' }); }
test('refuse une page externe et les hôtes non attendus', async () => {
  assert.equal((await call('/api/auth/start', { method: 'POST', body: '{}', headers: { Origin: 'https://evil.example' } })).status, 403);
  const hostStatus = await new Promise((resolve, reject) => { const req = http.get(origin + '/api/status', { headers: { Host: 'evil.example' } }, res => { res.resume(); resolve(res.statusCode); }); req.on('error', reject); });
  assert.equal(hostStatus, 403);
});
test('refuse les messages sans autorisation', async () => {
  assert.equal((await call('/api/beeper/chats/chat-1/messages', { method: 'POST', body: JSON.stringify({ text: 'Test simulé' }) })).status, 401);
  assert.equal((await call('/api/beeper/chats/chat-1/read', { method: 'POST', body: '{}' })).status, 401);
  assert.equal(sends, 0);
});
test('refuse les adresses API distantes', async () => {
  const response = await call('/api/auth/start', { method: 'POST', body: JSON.stringify({ base: 'https://example.com' }) });
  assert.equal(response.status, 400);
});
test('démarre OAuth PKCE avec une redirection locale', async () => {
  const result = await (await call('/api/auth/start', { method: 'POST', body: JSON.stringify({ base }) })).json();
  authorization = new URL(result.url);
  assert.equal(authorization.origin, base); assert.equal(authorization.searchParams.get('code_challenge_method'), 'S256'); assert.ok(authorization.searchParams.get('state')); assert.ok(authorization.searchParams.get('code_challenge'));
});
test('échange le code une seule fois et garde la clé côté serveur', async () => {
  const callback = '/oauth/callback?' + new URLSearchParams({ state: authorization.searchParams.get('state'), code: 'approved' });
  const response = await call(callback); assert.equal(response.status, 303); assert.equal(response.headers.get('location'), '/?connected=1');
  cookie = response.headers.get('set-cookie').split(';')[0];
  const statusText = await (await call('/api/status')).text(); assert.ok(!statusText.includes('secret-test-token')); assert.equal(JSON.parse(statusText).connected, true);
  assert.match((await call(callback)).headers.get('location'), /authError=/);
});
test('charge les chats et transmet un envoi uniquement au serveur simulé', async () => {
  const chats = await (await call('/api/beeper/chats?limit=100')).json(); assert.equal(chats.items[0].id, 'chat-1');
  const response = await call('/api/beeper/chats/chat-1/messages', { method: 'POST', body: JSON.stringify({ text: 'Test simulé' }) });
  assert.equal(response.status, 200); assert.equal(sends, 1);
});
test('ne permet ni accès aux fichiers de travail ni actions de suppression', async () => {
  assert.equal((await call('/server.mjs')).status, 404);
  assert.equal((await call('/api/avatar?url=file:///C:/Windows/win.ini')).status, 404);
  assert.equal((await call('/api/beeper/chats/chat-1', { method: 'DELETE' })).status, 404);
});

test('synchronise la lecture jusqu’au message affiché et garde les autres opérations fermées', async () => {
  const response = await call('/api/beeper/chats/chat-1/read', { method: 'POST', body: JSON.stringify({ messageID: 'last-visible', ignored: 'not forwarded' }) });
  assert.equal(response.status, 200); assert.equal((await response.json()).unreadCount, 0);
  assert.deepEqual(reads, [{ messageID: 'last-visible' }]);
  assert.equal((await call('/api/beeper/chats/chat-1/read', { method: 'POST', body: '{"messageID":42}' })).status, 400);
  assert.equal((await call('/api/beeper/chats/chat-1/read')).status, 404);
  assert.equal((await call('/api/beeper/chats/chat-1/unread', { method: 'POST', body: '{}' })).status, 404);
  assert.equal((await call('/api/beeper/chats/chat-1/read', { method: 'POST', body: '{}', headers: { Origin: 'https://evil.example' } })).status, 403);
  assert.equal(reads.length, 1);
});
test('sert ma photo fournie par les comptes, même si Beeper utilise octet-stream', async () => {
  const accounts = await (await call('/api/beeper/accounts')).json(); assert.equal(accounts[0].accountID, 'a');
  const photo = await call('/api/avatar?url=' + encodeURIComponent('mxc://me'));
  assert.equal(photo.status, 200); assert.equal(photo.headers.get('content-type'), 'image/jpeg');
});
test('transmet les lectures partielles et les en-têtes nécessaires à la recherche vidéo', async () => {
  await call('/api/beeper/chats/chat-1/messages');
  const response = await call('/api/media?url=' + encodeURIComponent('mxc://video'), { headers: { Range: 'bytes=3-6' } });
  assert.equal(response.status, 206); assert.equal(response.headers.get('content-range'), 'bytes 3-6/10'); assert.equal(response.headers.get('accept-ranges'), 'bytes'); assert.equal(response.headers.get('content-length'), '4'); assert.equal(await response.text(), '3456');
});
test('sert les aperçus enregistrés et force le téléchargement des documents actifs', async () => {
  const preview = await call('/api/media?url=' + encodeURIComponent('mxc://preview')); assert.equal(preview.status, 200); assert.equal(preview.headers.get('content-type'), 'image/jpeg');
  const document = await call('/api/media?url=' + encodeURIComponent('mxc://html')); assert.equal(document.headers.get('content-type'), 'application/octet-stream'); assert.match(document.headers.get('content-disposition'), /^attachment;/);
  assert.equal((await call('/api/media?url=file:///C:/Windows/win.ini')).status, 404);
});
test('gère HEAD et les plages invalides sans transférer toute la vidéo', async () => {
  const head = await call('/api/media?url=' + encodeURIComponent('mxc://video'), { method: 'HEAD' }); assert.equal(head.status, 200); assert.equal(head.headers.get('content-length'), '10'); assert.equal(await head.text(), '');
  const bad = await call('/api/media?url=' + encodeURIComponent('mxc://video'), { headers: { Range: 'bytes=300-600' } }); assert.equal(bad.status, 416); assert.equal(bad.headers.get('content-range'), 'bytes */10');
  assert.equal((await call('/api/media?url=' + encodeURIComponent('mxc://video'), { headers: { Range: 'bytes=0-1,3-4' } })).status, 416);
});
test('prépare un fichier sans l’envoyer, puis permet un envoi explicite', async () => {
  const before = sends, form = new FormData(); form.append('file', new Blob(['simulation'], { type: 'image/png' }), 'photo.png');
  const upload = await fetch(origin + '/api/upload', { method: 'POST', headers: { cookie, Origin: origin }, body: form });
  assert.equal(upload.status, 200); assert.equal(sends, before);
  const response = await call('/api/beeper/chats/chat-1/messages', { method: 'POST', body: JSON.stringify({ attachment: { uploadID: 'upload-test' } }) }); assert.equal(response.status, 200); assert.equal(sends, before + 1);
  const denied = await call('/api/beeper/chats/chat-1/messages', { method: 'POST', body: JSON.stringify({ attachment: { uploadID: 'not-my-upload' } }) }); assert.equal(denied.status, 400);
});
test('la déconnexion retire l’accès', async () => {
  assert.equal((await call('/api/logout', { method: 'POST', body: '{}' })).status, 200);
  assert.equal((await call('/api/beeper/chats')).status, 401);
});
