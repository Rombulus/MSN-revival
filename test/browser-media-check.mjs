// Isolated browser check: all conversations and media come from a mock API.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as pause } from 'node:timers/promises';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const root = fileURLToPath(new URL('..', import.meta.url));
async function freePort() { const temp = http.createServer(); temp.listen(0, '127.0.0.1'); await once(temp, 'listening'); const port = temp.address().port; await new Promise(resolve => temp.close(resolve)); return port; }
async function eventually(fn, timeout = 10_000) { const end = Date.now() + timeout; let last; while (Date.now() < end) { try { const result = await fn(); if (result) return result; } catch (error) { last = error; } await pause(100); } throw last || new Error('Browser condition timed out'); }
function wave() {
  const samples = 8000 * 15, bytes = Buffer.alloc(44 + samples * 2);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(8000, 24); bytes.writeUInt32LE(16000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(samples * 2, 40);
  return bytes;
}
test('sidebar stable, collage, messages groupés et médias dans un navigateur isolé', { skip: !existsSync(edge), timeout: 40_000 }, async () => {
  let proxy, browser, socket, messages = 0, sends = 0, videoBytes = Buffer.alloc(0), matrixError = true, failSourceB = true;
  const olderSources = [];
  const sentBodies = [], uploads = [];
  const reads = []; let adamUnread = 2;
  const readFixtures = Array.from({ length: 45 }, (_, index) => ({ id: 'reading-' + index, senderID: 'contact', senderName: 'Contact', text: 'Message à lire ' + index, timestamp: new Date(1_700_000_000_000 + index * 1000).toISOString() }));
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6V00AAAAASUVORK5CYII=', 'base64'), wav = wave();
  const fixtures = [
    { id: 'photo', text: 'Une photo reçue', attachments: [{ id: 'mxc://photo', type: 'img', mimeType: 'image/png', fileName: 'photo.png' }] },
    { id: 'audio', attachments: [{ id: 'mxc://sound', type: 'audio', mimeType: 'audio/wav', fileName: 'message.wav', duration: 15 }] },
    { id: 'video', attachments: [{ id: 'mxc://video', type: 'video', mimeType: 'video/webm', fileName: 'clip.webm' }] },
    { id: 'link', text: '<p>Regarde <a href="https://www.instagram.com/reel/fixture/">ce Reel</a></p>', links: [{ url: 'https://www.instagram.com/reel/fixture/', title: 'Un Reel de démonstration', img: 'mxc://photo', summary: 'Aperçu fourni par le serveur simulé.' }] },
    { id: 'another-sender', text: 'Un homonyme dans le groupe', senderID: 'another-contact' },
    { id: 'my-message', text: 'Ma première réponse', isSender: true },
    { id: 'my-next-message', text: 'Ma deuxième réponse', isSender: true },
    { id: 'next-day', text: 'Le lendemain', timestamp: new Date(1_700_086_400_000).toISOString() },
  ].map((message, index) => ({ senderID: 'contact', ...message, timestamp: message.timestamp || new Date(1_700_000_000_000 + index * 1000).toISOString(), senderName: 'Contact de démonstration' }));
  const mock = http.createServer(async (req, res) => {
    const path = new URL(req.url, 'http://fixture').pathname;
    res.setHeader('Content-Type', 'application/json');
    if (path === '/v1/info') return res.end(JSON.stringify({ app: { version: 'fixture' } }));
    if (req.headers.authorization !== 'Bearer browser-fixture') { res.statusCode = 401; return res.end('{}'); }
    if (path.endsWith('/read')) {
      const id = path.split('/')[3], chunks = []; for await (const chunk of req) chunks.push(chunk);
      reads.push({ id, ...JSON.parse(Buffer.concat(chunks).toString()) });
      if (id === 'fixture-julie') { res.writeHead(503); return res.end('{}'); }
      if (id === 'fixture-adam') {
        if (reads.at(-1).messageID === 'reading-44') {
          adamUnread = 1;
          readFixtures.push({ ...readFixtures.at(-1), id: 'reading-45', text: 'Nouveau message arrivé pendant la lecture', timestamp: new Date(1_700_000_045_000).toISOString() });
        } else adamUnread = 0;
        return res.end(JSON.stringify({ id, unreadCount: adamUnread, isMarkedUnread: false }));
      }
      return res.end(JSON.stringify({ id, unreadCount: 0, isMarkedUnread: false }));
    }
    if (path === '/v1/assets/upload') {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      uploads.push(Buffer.concat(chunks)); return res.end(JSON.stringify({ uploadID: 'pasted-image' }));
    }
    if (path === '/v1/accounts') return res.end(JSON.stringify([{ accountID: 'fixture', user: { fullName: 'Moi', imgURL: 'mxc://photo' } }]));
    if (path === '/v1/chats') return res.end(JSON.stringify({ items: [
      { id: 'fixture-chat', accountID: 'fixture', type: 'single', title: 'Contact de démonstration', network: 'WhatsApp', imgURL: 'mxc://photo', labels: [{ id: 'friends', name: 'Amis' }], participants: { items: [] }, lastActivity: new Date(Date.now() - 300_000).toISOString(), preview: { text: 'À tout à l’heure !', isSender: true, timestamp: new Date(Date.now() - 300_000).toISOString() } },
      { id: 'fixture-lea', title: 'Léa', network: 'Instagram', labels: [{ id: 'family', name: 'Famille' }], lastActivity: new Date(Date.now() - 60_000).toISOString(), preview: { attachments: [{ type: 'img' }], timestamp: new Date(Date.now() - 60_000).toISOString() } },
      { id: 'fixture-adam', title: 'Adam', network: 'Telegram', labels: [{ id: 'friends', name: 'Amis' }], unreadCount: adamUnread, lastActivity: new Date(Date.now() - 7_200_000).toISOString(), preview: { text: 'On se retrouve demain ?', timestamp: new Date(Date.now() - 7_200_000).toISOString() } },
      { id: 'fixture-nina', title: 'Nina', network: 'Beeper / Matrix', labels: [{ id: 'friends', name: 'Amis' }] },
      { id: 'fixture-julie', title: 'Julie', network: 'Messenger', isMarkedUnread: true, labels: [{ id: 'family', name: 'Famille' }] },
      { id: 'fixture-group', title: 'La bande', network: 'Beeper / Matrix', type: 'group', merge: { chatIDs: ['member-a', 'member-b'] } },
    ], hasMore: false }));
    if (path === '/v1/assets/serve') {
      const source = new URL(req.url, 'http://fixture').searchParams.get('url'), bytes = source === 'mxc://sound' ? wav : source === 'mxc://video' ? videoBytes : png;
      res.setHeader('Content-Type', source === 'mxc://sound' ? 'audio/wav' : source === 'mxc://video' ? 'video/webm' : 'image/png'); res.setHeader('Accept-Ranges', 'bytes');
      const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
      if (range) { const start = Number(range[1]), end = range[2] ? Math.min(bytes.length - 1, Number(range[2])) : bytes.length - 1; res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${bytes.length}`, 'Content-Length': String(end - start + 1) }); return res.end(bytes.subarray(start, end + 1)); }
      res.setHeader('Content-Length', String(bytes.length)); return res.end(bytes);
    }
    if (path.endsWith('/messages')) {
      const id = path.split('/')[3], query = new URL(req.url, 'http://fixture').searchParams;
      if (id === 'fixture-adam' || id === 'fixture-julie') return res.end(JSON.stringify({ items: readFixtures, hasMore: false }));
      if (id === 'fixture-nina') { if (matrixError) { res.writeHead(503); return res.end('{}'); } return res.end(JSON.stringify({ items: [], hasMore: false })); }
      if (id === 'fixture-group') { res.writeHead(500); return res.end('{}'); }
      if (id === 'member-a' || id === 'member-b') {
        if (id === 'member-b' && failSourceB) { res.writeHead(503); return res.end('{}'); }
        if (query.has('cursor')) olderSources.push(id);
        const older = query.has('cursor');
        return res.end(JSON.stringify({ items: [{ id: older ? 'old' : 'shared-id', chatID: id, text: older ? 'Ancien message A' : id === 'member-a' ? 'Message source A' : 'Message source B', timestamp: new Date(1_700_000_000_000 + (older ? -1000 : id === 'member-a' ? 0 : 1000)).toISOString() }], hasMore: id === 'member-a' && !older, oldestCursor: id === 'member-a' && !older ? 'older-a' : undefined }));
      }
      if (req.method === 'POST') {
        sends++; const chunks = []; for await (const chunk of req) chunks.push(chunk);
        const input = JSON.parse(Buffer.concat(chunks).toString()); sentBodies.push(input);
        fixtures.push({ id: 'sent-' + sends, text: input.text, isSender: true, timestamp: new Date().toISOString(), ...(input.attachment ? { attachments: [{ type: 'img', id: 'mxc://photo', mimeType: 'image/png', fileName: 'clipboard.png' }] } : {}) });
        return res.end(JSON.stringify({ pendingMessageID: 'sent-' + sends, chatID: id }));
      }
      messages++; return res.end(JSON.stringify({ items: fixtures, hasMore: false }));
    }
    res.writeHead(404); res.end('{}');
  });
  mock.listen(0, '127.0.0.1'); await once(mock, 'listening');
  const port = await freePort(), debugPort = await freePort(), base = `http://127.0.0.1:${mock.address().port}`, origin = `http://127.0.0.1:${port}`;
  try {
    proxy = spawn(process.execPath, ['server.mjs'], { cwd: root, env: { ...process.env, PORT: String(port) }, stdio: 'ignore', windowsHide: true });
    await eventually(async () => (await fetch(origin)).ok);
    const artifacts = join(root, '.local'); await mkdir(artifacts, { recursive: true });
    browser = spawn(edge, ['--headless=new', '--disable-gpu', '--no-first-run', '--mute-audio', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${join(artifacts, 'browser-media-' + Date.now())}`, origin], { stdio: 'ignore', windowsHide: true });
    const targets = await eventually(async () => { const list = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json(); return list.find(item => item.type === 'page' && item.url.startsWith(origin)); });
    socket = new WebSocket(targets.webSocketDebuggerUrl); await once(socket, 'open');
    let id = 0; const pending = new Map(), exceptions = [];
    socket.addEventListener('message', event => { const message = JSON.parse(event.data); if (message.id && pending.has(message.id)) { const task = pending.get(message.id); pending.delete(message.id); message.error ? task.reject(new Error(message.error.message)) : task.resolve(message.result); } if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails.text); });
    function command(method, params = {}) { return new Promise((resolve, reject) => { const requestId = ++id; pending.set(requestId, { resolve, reject }); socket.send(JSON.stringify({ id: requestId, method, params })); }); }
    async function evaluate(expression) { const result = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text); return result.result.value; }
    await command('Runtime.enable'); await command('Page.enable'); await command('Emulation.setDeviceMetricsOverride', { width: 1050, height: 900, deviceScaleFactor: 1, mobile: false });
    await eventually(() => evaluate('!!document.querySelector("#authorize-button")'));
    // Generate a real clip locally: no fixture download and no third-party media.
    const clip = await evaluate(`(async()=>{const canvas=document.createElement('canvas');canvas.width=160;canvas.height=90;const ctx=canvas.getContext('2d');const stream=canvas.captureStream(12);const recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp8'});const chunks=[];recorder.ondataavailable=e=>chunks.push(e.data);const stopped=new Promise(resolve=>recorder.onstop=resolve);recorder.start();let frame=0;const timer=setInterval(()=>{ctx.fillStyle=frame++%2?'#499fe0':'#b7d9ef';ctx.fillRect(0,0,160,90);},80);await new Promise(resolve=>setTimeout(resolve,1800));recorder.stop();await stopped;clearInterval(timer);stream.getTracks().forEach(track=>track.stop());const bytes=new Uint8Array(await new Blob(chunks).arrayBuffer());return btoa(String.fromCharCode(...bytes));})()`);
    videoBytes = Buffer.from(clip, 'base64'); assert.ok(videoBytes.length > 100);
    await evaluate(`fetch('/api/auth/token',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({base:${JSON.stringify(base)},token:'browser-fixture'})}).then(r=>r.json())`);
    await command('Page.reload');
    await eventually(() => evaluate('document.querySelectorAll(".message-photo").length===1 && document.querySelector(".message-photo").naturalWidth>0'));
    assert.equal(await evaluate('document.querySelectorAll(".link-preview").length'), 1);
    assert.equal(await evaluate('document.querySelector(".bubble a").href'), 'https://www.instagram.com/reel/fixture/');
    assert.equal(await evaluate('document.querySelectorAll(".message-meta:not([hidden])").length'), 4, 'un en-tête par série, expéditeur et journée');
    assert.deepEqual(await evaluate('[...document.querySelectorAll(".message-row")].map(row=>row.classList.contains("message-continuation"))'), [false, true, true, true, false, false, true, false]);
    assert.equal(await evaluate('[...document.querySelectorAll(".legacy-right .classic-frame")].every(node=>{const r=node.getBoundingClientRect();return Math.abs(r.width-r.height)<1})'), true);
    assert.equal(await evaluate('document.querySelector(".legacy-menu")'), null);
    assert.equal(await evaluate('document.querySelectorAll(".compose-tools > button").length'), 2);
    assert.equal(await evaluate('!!document.querySelector("#video-btn,#call-btn,#activities-btn,#games-btn,#sound-toggle")'), false);
    assert.equal(await evaluate('document.querySelector(".history-chat").dataset.historyId'), 'fixture-lea');
    assert.equal(await evaluate('document.querySelector(".history-chat .history-snippet").textContent'), 'Photo');
    assert.equal(await evaluate(`document.querySelector('[data-history-id="fixture-chat"] .history-snippet').textContent`), 'Vous : À tout à l’heure !');
    await evaluate('document.querySelector("#history-unread").click()');
    assert.equal(await evaluate('document.querySelectorAll(".history-chat").length'), 2);
    assert.equal(await evaluate('document.querySelector(".history-chat").dataset.historyId'), 'fixture-adam');
    await evaluate('document.querySelector("#history-all").click();document.querySelector("#history-search").value="lea";document.querySelector("#history-search").dispatchEvent(new Event("input"))');
    assert.equal(await evaluate('document.querySelectorAll(".history-chat").length'), 1);
    await evaluate('document.querySelector("#history-search").value="";document.querySelector("#history-search").dispatchEvent(new Event("input"));document.querySelector("#message-input").value="Brouillon conservé";document.querySelector("#message-input").dispatchEvent(new Event("input"))');
    await evaluate(`document.querySelector('[data-history-id="fixture-lea"]').click()`);
    assert.equal(await evaluate(`document.querySelector('[data-history-id="fixture-chat"] .history-snippet').textContent`), 'Brouillon : Brouillon conservé');
    await evaluate(`document.querySelector('[data-history-id="fixture-chat"]').click()`);
    assert.equal(await evaluate('document.querySelector("#message-input").value'), 'Brouillon conservé');
    await evaluate(`window.historyNodes=[...document.querySelector('#conversation-list').children];window.historyIcons=[...document.querySelectorAll('.history-chat use')];document.querySelector('#message-input').focus()`);
    await command('Input.insertText', { text: ' avec des caractères' });
    assert.equal(await evaluate(`window.historyNodes.every((node,index)=>node===document.querySelector('#conversation-list').children[index]) && window.historyIcons.every((node,index)=>node===document.querySelectorAll('.history-chat use')[index])`), true, 'la frappe conserve les lignes et les logos de la sidebar');
    assert.equal(await evaluate('document.activeElement.id'), 'message-input');
    await evaluate('document.querySelector("#message-input").value="";document.querySelector("#message-input").dispatchEvent(new Event("input"));document.querySelector("#history-collapse").click()');
    assert.equal(await evaluate('getComputedStyle(document.querySelector("#conversation-sidebar")).display'), 'none');
    await evaluate('document.querySelector("#history-toggle").click()');
    await evaluate(`document.querySelector('[data-history-id="fixture-nina"]').click()`);
    await eventually(() => evaluate('!!document.querySelector("[data-retry-history]")'));
    assert.ok(await evaluate('document.querySelector("#messages").textContent.includes("Impossible de charger")'));
    matrixError = false;
    await evaluate('document.querySelector("[data-retry-history]").click()');
    await eventually(() => evaluate('document.querySelector("#messages").textContent.includes("Beeper ne fournit aucun message visible")'));
    await evaluate(`document.querySelector('[data-history-id="fixture-group"]').click()`);
    await eventually(() => evaluate('document.querySelector("#messages").textContent.includes("Message source A") && !!document.querySelector("[data-retry-history]")'));
    assert.ok(await evaluate('document.querySelector("#messages").textContent.includes("Une partie de l’historique")'));
    failSourceB = false;
    await evaluate('document.querySelector("[data-retry-history]").click()');
    await eventually(() => evaluate('document.querySelectorAll(".message-row").length===2 && document.querySelector("#messages").textContent.includes("Message source B")'));
    await evaluate('document.querySelector("#history-more").click()');
    await eventually(() => evaluate('document.querySelectorAll(".message-row").length===3'));
    assert.deepEqual(olderSources, ['member-a']);
    await eventually(() => reads.some(read => read.id === 'member-a') && reads.some(read => read.id === 'member-b'));
    assert.ok(reads.filter(read => read.id.startsWith('member-')).every(read => read.messageID === 'shared-id'), 'chaque source fusionnée reçoit son propre dernier ID');
    assert.equal(reads.some(read => read.id === 'fixture-group'), false);
    await evaluate(`document.querySelector('[data-history-id="fixture-chat"]').click()`);
    await eventually(() => evaluate('document.querySelectorAll(".message-photo").length===1'));
    await evaluate('document.querySelector("#invite-btn").click()');
    assert.equal(await evaluate('document.querySelectorAll(".roster-group").length'), 3);
    assert.equal(await evaluate(`document.querySelector('.roster-contact[data-id="fixture-chat"] use').getAttribute('href')`), 'assets/legacy-icons.svg#app-whatsapp');
    assert.equal(await evaluate('document.querySelectorAll(".classic-person").length'), 0);
    await evaluate(`document.querySelector('[data-group="label:friends"] summary').click()`);
    await pause(120);
    await evaluate('document.querySelector("#contact-search").value="lea";document.querySelector("#contact-search").dispatchEvent(new Event("input"))');
    assert.equal(await evaluate('document.querySelectorAll(".roster-contact").length'), 1);
    assert.equal(await evaluate('document.querySelector(".roster-name").textContent'), 'Léa');
    await evaluate('document.querySelector("#contact-search").value="";document.querySelector("#contact-search").dispatchEvent(new Event("input"))');
    assert.equal(await evaluate(`document.querySelector('[data-group="label:friends"]').open`), false);
    await evaluate(`document.querySelector('[data-group="label:friends"] summary').click()`);
    const rosterShot = await command('Page.captureScreenshot', { format: 'png' }); await writeFile(join(artifacts, 'roster-check.png'), Buffer.from(rosterShot.data, 'base64'));
    await evaluate('document.querySelector("#contacts-close").click()');
    // Reading requires the loaded end of the active conversation and an active window.
    await evaluate(`Object.defineProperty(document,'hasFocus',{configurable:true,value:()=>false});document.querySelector('[data-history-id="fixture-adam"]').click()`);
    await eventually(() => evaluate('document.querySelectorAll(".message-row").length===45'));
    await evaluate(`{const box=document.querySelector('#messages');box.style.scrollBehavior='auto';box.scrollTop=box.scrollHeight;box.dispatchEvent(new Event('scroll'));}`);
    await pause(350);
    assert.equal(reads.some(read => read.id === 'fixture-adam'), false, 'une fenêtre inactive ne marque pas comme lu');
    await evaluate(`{const box=document.querySelector('#messages');box.scrollTop=0;box.dispatchEvent(new Event('scroll'));delete document.hasFocus;window.dispatchEvent(new Event('focus'));}`);
    await pause(350);
    assert.equal(reads.some(read => read.id === 'fixture-adam'), false, 'lire un ancien passage ne marque pas les nouveaux messages comme lus');
    assert.equal(await evaluate(`document.querySelector('[data-history-id="fixture-adam"] .history-badge').textContent`), '2');
    await evaluate(`{const box=document.querySelector('#messages');box.scrollTop=box.scrollHeight;box.dispatchEvent(new Event('scroll'));}`);
    await eventually(() => evaluate(`document.querySelector('[data-history-id="fixture-adam"] .history-badge').textContent==='1'`));
    assert.equal(await evaluate(`document.querySelector('[data-history-id="fixture-adam"] .history-badge').hidden`), false, 'un message arrivé pendant la requête reste non lu jusqu’à son affichage');
    await eventually(() => evaluate(`document.querySelector('[data-history-id="fixture-adam"] .history-badge').hidden`));
    assert.deepEqual(reads.filter(read => read.id === 'fixture-adam'), [{ id: 'fixture-adam', messageID: 'reading-44' }, { id: 'fixture-adam', messageID: 'reading-45' }]);
    assert.equal(adamUnread, 0);
    assert.equal(await evaluate('document.querySelector("#history-unread-count").textContent'), '(1)');
    assert.equal(await evaluate(`document.querySelector('.roster-contact[data-id="fixture-adam"] em')`), null);
    assert.equal(await evaluate(`document.querySelector('#contact-picker option[value="fixture-adam"]').textContent.includes('(2)')`), false);
    await evaluate(`document.querySelector('#history-unread').click()`);
    assert.equal(await evaluate(`!!document.querySelector('[data-history-id="fixture-adam"]')`), false, 'la conversation lue quitte le filtre Non lus');
    await evaluate(`document.querySelector('#history-all').click();document.querySelector('[data-history-id="fixture-julie"]').click()`);
    await eventually(() => reads.some(read => read.id === 'fixture-julie'));
    await eventually(() => evaluate('document.querySelector("#toast").textContent.includes("Lecture non synchronisée")'));
    assert.equal(await evaluate(`document.querySelector('[data-history-id="fixture-julie"] .history-badge').hidden`), false, 'un échec conserve le non-lu');
    await evaluate(`document.querySelector('[data-history-id="fixture-chat"]').click()`);
    await eventually(() => evaluate('document.querySelectorAll(".message-photo").length===1'));
    await evaluate('document.querySelector("#emoji-btn").click()');
    assert.equal(await evaluate('document.querySelector("#emoji-btn").getAttribute("aria-expanded")'), 'true');
    await evaluate(`document.querySelector('[data-emoji="❤️"]').click()`);
    assert.equal(await evaluate('document.querySelector("#message-input").value'), '❤️');
    await evaluate('document.querySelector("#message-input").value="";document.querySelector("#message-input").dispatchEvent(new Event("input"))');
    await evaluate('document.querySelector(".photo-open").click()');
    await eventually(() => evaluate('document.querySelector("#media-viewer").open && document.querySelector("#viewer-image").naturalWidth>0'));
    await evaluate('document.querySelector("#viewer-close").click()');
    await evaluate(`{const transfer=new DataTransfer();transfer.items.add(new File(['fixture'],'test.png',{type:'image/png'}));const input=document.querySelector('#file-input');input.files=transfer.files;input.dispatchEvent(new Event('change'));}`);
    assert.equal(await evaluate('!document.querySelector("#attachment-draft").hidden'), true); assert.equal(sends, 0);
    await evaluate('document.querySelector("#remove-attachment").click()');
    const pasteImage = `{const data=new DataTransfer();const bytes=Uint8Array.from(atob('${png.toString('base64')}'),c=>c.charCodeAt(0));data.items.add(new File([bytes],'clipboard.png',{type:'image/png'}));const input=document.querySelector('#message-input');input.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));}`;
    await evaluate(pasteImage);
    await eventually(() => evaluate('!document.querySelector("#draft-image").hidden && document.querySelector("#draft-image").naturalWidth>0'));
    assert.ok(await evaluate('document.querySelector("#attachment-name").textContent.startsWith("clipboard.png")'));
    assert.equal(sends, 0, 'coller une image ne doit pas envoyer de message');
    await evaluate(`window.pastedImageURL=document.querySelector('#draft-image').src;document.querySelector('#remove-attachment').click()`);
    assert.equal(await evaluate('document.querySelector("#attachment-draft").hidden && !document.querySelector("#draft-image").hasAttribute("src")'), true);
    assert.equal(await evaluate('fetch(window.pastedImageURL).then(()=>false,()=>true)'), true, 'le blob de l’aperçu retiré est libéré');
    const link = 'https://www.instagram.com/reel/pasted/?a=1&b=2';
    const prepareLinkPaste = `(()=>{const input=document.querySelector('#message-input');input.value='Regarde ici\\nÀ bientôt';input.focus();input.setSelectionRange(8,11);const data=new DataTransfer();data.setData('text/plain',${JSON.stringify(link)});const event=new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true});input.dispatchEvent(event);return event.defaultPrevented})()`;
    assert.equal(await evaluate(prepareLinkPaste), false, 'les liens gardent le collage natif du navigateur');
    // Synthetic clipboard events cannot perform the browser default insertion; use its text input path.
    await command('Input.insertText', { text: link });
    assert.equal(await evaluate('document.querySelector("#message-input").value'), `Regarde ${link}\nÀ bientôt`);
    assert.ok(await evaluate(`document.querySelector('[data-history-id="fixture-chat"] .history-snippet').textContent.includes(${JSON.stringify(link)})`));
    assert.equal(sends, 0);
    await evaluate('document.querySelector("#message-input").value="";document.querySelector("#message-input").dispatchEvent(new Event("input"))');
    await evaluate('document.querySelector("#voice-clip-btn").click()');
    await eventually(() => evaluate('!document.querySelector("#recording-status").hidden && document.querySelector("#recording-time").textContent.includes("0:")'));
    assert.equal(await evaluate('document.querySelector("#send-btn").disabled'), true);
    await pause(700); await evaluate('document.querySelector("#voice-clip-btn").click()');
    await eventually(() => evaluate('!document.querySelector("#draft-audio").hidden && document.querySelector("#attachment-name").textContent.startsWith("Vocal-")'));
    assert.equal(sends, 0, 'enregistrer ne doit pas envoyer le vocal');
    await evaluate('document.querySelector("#remove-attachment").click();document.querySelector("#voice-clip-btn").click()');
    await eventually(() => evaluate('!document.querySelector("#recording-status").hidden'));
    await evaluate('document.querySelector("#cancel-recording").click()');
    assert.equal(await evaluate('document.querySelector("#recording-status").hidden && document.querySelector("#attachment-draft").hidden'), true);
    await evaluate(`window.realGetUserMedia=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia=()=>Promise.reject(new DOMException('Denied','NotAllowedError'));document.querySelector('#voice-clip-btn').click()`);
    await eventually(() => evaluate('document.querySelector("#toast").textContent.includes("Microphone refusé")'));
    assert.equal(await evaluate('document.querySelector("#recording-status").hidden'), true);
    await evaluate('navigator.mediaDevices.getUserMedia=window.realGetUserMedia');
    await evaluate('window.playerReference=document.querySelector("audio");window.playerReference.play()');
    await eventually(() => evaluate('document.querySelector("video").readyState>=1'));
    await evaluate('window.videoReference=document.querySelector("video");window.videoReference.loop=true;window.videoReference.currentTime=.5;window.videoReference.play()');
    const initialTime = await evaluate('window.playerReference.currentTime');
    await pause(4700);
    assert.ok(messages >= 2, 'la synchronisation doit avoir eu lieu');
    assert.equal(await evaluate('window.playerReference===document.querySelector("audio")'), true, 'le lecteur doit garder son identité DOM');
    assert.ok(await evaluate('window.playerReference.currentTime') > initialTime + 2, 'le son continue pendant la synchronisation');
    assert.equal(await evaluate('window.videoReference===document.querySelector("video") && !window.videoReference.paused && window.videoReference.played.length>0'), true, 'la vidéo est lisible et continue pendant la synchronisation');
    await evaluate(prepareLinkPaste); await command('Input.insertText', { text: link });
    await evaluate(pasteImage);
    await evaluate('document.querySelector("#send-btn").click()');
    await eventually(() => sends === 1 && evaluate('!document.querySelector("#send-btn").disabled && !document.querySelector(".send-state")'));
    assert.deepEqual(sentBodies, [{ text: `Regarde ${link}\nÀ bientôt`, attachment: { uploadID: 'pasted-image' } }]);
    assert.equal(uploads.length, 1);
    assert.ok(uploads[0].includes(png), 'les octets de l’image collée arrivent au serveur simulé');
    assert.equal(await evaluate('document.querySelector("#attachment-draft").hidden && document.querySelector("#message-input").value===""'), true);
    assert.deepEqual(exceptions, []);
    assert.equal(reads.filter(read => read.id === 'fixture-adam').length, 2, 'les rendus suivants ne répètent pas l’accusé de lecture');
    const screenshot = await command('Page.captureScreenshot', { format: 'png' }); await writeFile(join(artifacts, 'media-check.png'), Buffer.from(screenshot.data, 'base64'));
    await command('Emulation.setDeviceMetricsOverride', { width: 650, height: 900, deviceScaleFactor: 1, mobile: false });
    await pause(150);
    assert.equal(await evaluate('document.querySelector("#history-backdrop").hidden'), false);
    await evaluate('document.querySelector("#history-backdrop").click()');
    assert.equal(await evaluate('getComputedStyle(document.querySelector("#conversation-sidebar")).display'), 'none');
    assert.equal(await evaluate('document.documentElement.scrollWidth<=650'), true);
    await command('Browser.close').catch(() => {});
  } finally { socket?.close(); browser?.kill(); proxy?.kill(); await new Promise(resolve => mock.close(resolve)); }
});
