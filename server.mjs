import http from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { avatarSources, imageType } from './profiles.mjs';
import { join } from 'node:path';
import { rememberMedia } from './media.mjs';
import { serveMedia } from './media-server.mjs';
import { createAuthStore } from './auth-store.mjs';

const port = Number(process.env.PORT || 4173);
const origin = `http://127.0.0.1:${port}`;
const root = fileURLToPath(new URL('.', import.meta.url));
const sessions = new Map();
const flows = new Map();
const authStore = createAuthStore();
let savedAuth = null, authError = null;
try { savedAuth = await authStore.load(); if (savedAuth) savedAuth.base = localBase(savedAuth.base); }
catch { savedAuth = null; authError = 'Impossible de relire l’autorisation enregistrée. Reconnecte Beeper pour la remplacer.'; }
const staticFiles = new Map([
  ['/', ['index.html', 'text/html']], ['/index.html', ['index.html', 'text/html']],
  ['/styles.css', ['styles.css', 'text/css']], ['/client.js', ['client.js', 'text/javascript']],
  ['/profiles.mjs', ['profiles.mjs', 'text/javascript']],
  ['/media.mjs', ['media.mjs', 'text/javascript']],
  ['/assets/legacy-icons.svg', ['assets/legacy-icons.svg', 'image/svg+xml']],
  ['/assets/buddy.svg', ['assets/buddy.svg', 'image/svg+xml']], ['/assets/duck.svg', ['assets/duck.svg', 'image/svg+xml']],
]);
const random = () => randomBytes(32).toString('base64url');
function reply(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}
function session(req, res) {
  let id = /(?:^|; )msn_session=([A-Za-z0-9_-]+)/.exec(req.headers.cookie || '')?.[1];
  if (!id || !sessions.has(id)) {
    id = random(); sessions.set(id, { base: savedAuth?.base || 'http://localhost:23373', token: savedAuth?.token, assets: new Set(), touched: Date.now() });
    res.setHeader('Set-Cookie', sessionCookie(id));
  }
  const value = sessions.get(id); value.touched = Date.now();
  return { id, ...value, value };
}
const sessionCookie = id => `msn_session=${id}; HttpOnly; SameSite=Lax; Path=/; Max-Age=31536000`;
async function rememberAuth(base, token, authorizationID = random()) {
  if (typeof token !== 'string' || !token.trim()) throw new Error('Beeper n’a pas fourni de clé valide.');
  const value = { base, token: token.trim(), authorizationID };
  try { await authStore.save(value); } catch { throw new Error('Impossible de mémoriser la connexion à Beeper sur cet ordinateur.'); }
  savedAuth = value; authError = null;
  for (const session of sessions.values()) {
    session.base = base; session.token = value.token;
    session.assets.clear(); session.media?.clear(); session.uploads?.clear();
  }
}
function localBase(value) {
  const url = new URL(value || 'http://localhost:23373');
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(url.hostname) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Adresse attendue : http://localhost:23373');
  return url.origin;
}
async function body(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw Object.assign(new Error('JSON requis.'), { status: 415 });
  let text = ''; for await (const chunk of req) { text += chunk; if (text.length > 100_000) throw Object.assign(new Error('Message trop long.'), { status: 413 }); }
  return JSON.parse(text || '{}');
}
async function remote(base, path, options = {}) {
  const response = await fetch(base + path, { ...options, signal: AbortSignal.timeout(12_000), redirect: 'error' });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(response.status === 401 ? 'Autorisation expirée : reconnecte Beeper.' : `Beeper a refusé cette opération (${response.status}).`), { status: response.status });
  return data;
}
const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: blob:; media-src 'self' https: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  try {
    if (req.headers.host !== `127.0.0.1:${port}`) return reply(res, 403, { error: 'Hôte local non autorisé.' });
    if (req.headers.origin && req.headers.origin !== origin) return reply(res, 403, { error: 'Origine non autorisée.' });
    const url = new URL(req.url, origin);
    const s = session(req, res);
    if (url.pathname === '/api/status' && req.method === 'GET') {
      let info; try { info = await remote(s.base, '/v1/info'); } catch {}
      return reply(res, 200, { connected: !!s.value.token, available: !!info, version: info?.app?.version, base: s.base, authorizationID: savedAuth?.authorizationID, authError });
    }
    if (url.pathname === '/api/auth/start' && req.method === 'POST') {
      const input = await body(req); const base = localBase(input.base);
      const redirect = origin + '/oauth/callback';
      const registration = await remote(base, '/oauth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_name: 'MSN Revival', redirect_uris: [redirect], grant_types: ['authorization_code'], response_types: ['code'], scope: 'read write', token_endpoint_auth_method: 'none' }) });
      const state = random(), verifier = random();
      flows.set(state, { sessionId: s.id, base, verifier, clientId: registration.client_id, created: Date.now() });
      const authorization = new URL(base + '/oauth/authorize');
      authorization.search = new URLSearchParams({ client_id: registration.client_id, redirect_uri: redirect, response_type: 'code', scope: 'read write', state, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' });
      return reply(res, 200, { url: authorization.href, authorizationID: state });
    }
    if (url.pathname === '/oauth/callback' && req.method === 'GET') {
      const flow = flows.get(url.searchParams.get('state')); flows.delete(url.searchParams.get('state'));
      if (!flow || Date.now() - flow.created > 600_000) throw new Error('Autorisation expirée. Recommence la connexion.');
      if (url.searchParams.has('error')) throw new Error('Autorisation refusée dans Beeper.');
      const code = url.searchParams.get('code'); if (!code) throw new Error('Code d’autorisation manquant.');
      const token = await remote(flow.base, '/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code, code_verifier: flow.verifier, client_id: flow.clientId, redirect_uri: origin + '/oauth/callback' }) });
      await rememberAuth(flow.base, token.access_token, url.searchParams.get('state'));
      res.writeHead(303, { Location: '/?connected=1', 'Set-Cookie': sessionCookie(flow.sessionId) }); return res.end();
    }
    if (url.pathname === '/api/auth/token' && req.method === 'POST') {
      const input = await body(req); const base = localBase(input.base);
      if (typeof input.token !== 'string' || !input.token.trim()) throw new Error('Ajoute une clé Beeper.');
      await remote(base, '/v1/accounts', { headers: { Authorization: `Bearer ${input.token.trim()}` } });
      await rememberAuth(base, input.token); return reply(res, 200, { connected: true });
    }
    if (url.pathname === '/api/logout' && req.method === 'POST') {
      await body(req); await authStore.clear(); savedAuth = null; authError = null;
      for (const session of sessions.values()) { delete session.token; session.assets.clear(); session.media?.clear(); session.uploads?.clear(); }
      flows.clear(); return reply(res, 200, { connected: false });
    }
    if (url.pathname === '/api/upload' && req.method === 'POST') {
      if (!s.value.token) return reply(res, 401, { error: 'Connecte Beeper avant de joindre un fichier.' });
      if (req.headers.origin !== origin || !/^multipart\/form-data;\s*boundary=/i.test(req.headers['content-type'] || '')) return reply(res, 415, { error: 'Fichier multipart attendu.' });
      const limit = 100 * 1024 * 1024 + 64 * 1024;
      if (Number(req.headers['content-length']) > limit) return reply(res, 413, { error: 'Fichier trop volumineux (100 Mo maximum).' });
      async function* uploadBody() { let size = 0; for await (const chunk of req) { size += chunk.length; if (size > limit) throw new Error('Fichier trop volumineux.'); yield chunk; } }
      const result = await fetch(s.base + '/v1/assets/upload', { method: 'POST', headers: { Authorization: `Bearer ${s.value.token}`, 'Content-Type': req.headers['content-type'] }, body: uploadBody(), duplex: 'half', signal: AbortSignal.timeout(120_000), redirect: 'error' });
      const data = await result.json();
      if (!result.ok || !data.uploadID) return reply(res, result.ok ? 400 : result.status, { error: 'Beeper n’a pas pu préparer ce fichier.' });
      s.value.uploads ||= new Set(); s.value.uploads.add(data.uploadID);
      return reply(res, 200, data);
    }
    if (url.pathname.startsWith('/api/beeper/')) {
      if (!s.value.token) return reply(res, 401, { error: 'Connecte MSN Revival à Beeper.' });
      const path = url.pathname.slice('/api/beeper'.length);
      const messages = /^\/chats\/[^/]+\/messages$/.test(path);
      const messageReactions = /^\/chats\/[^/]+\/messages\/[^/]+\/reactions(?:\/[^/]+)?$/.test(path);
      const markRead = /^\/chats\/[^/]+\/read$/.test(path);
      if (!(req.method === 'GET' && (path === '/accounts' || path === '/chats' || messages)) && !(req.method === 'POST' && (messages || markRead || messageReactions)) && !(req.method === 'DELETE' && messageReactions)) return reply(res, 404, { error: 'Opération indisponible.' });
      const options = { headers: { Authorization: `Bearer ${s.value.token}` } };
      if (req.method === 'POST' && markRead) {
        const input = await body(req);
        if (input.messageID !== undefined && (typeof input.messageID !== 'string' || !input.messageID.trim())) throw new Error('Identifiant de message invalide.');
        options.method = 'POST'; options.headers['Content-Type'] = 'application/json';
        options.body = JSON.stringify(input.messageID === undefined ? {} : { messageID: input.messageID });
      } else if (req.method === 'POST' && messages) {
        const input = await body(req); const text = typeof input.text === 'string' ? input.text : '';
        const attachment = input.attachment;
        if (attachment && !s.value.uploads?.has(attachment.uploadID)) throw new Error('Ce fichier doit être préparé à nouveau avant son envoi.');
        if (!text.trim() && !attachment) throw new Error('Message vide.');
        if (input.replyToMessageID !== undefined && (typeof input.replyToMessageID !== 'string' || !input.replyToMessageID.trim())) throw new Error('Identifiant du message auquel répondre invalide.');
        options.method = 'POST'; options.headers['Content-Type'] = 'application/json'; options.body = JSON.stringify({ text, ...(input.replyToMessageID ? { replyToMessageID: input.replyToMessageID } : {}), ...(attachment ? { attachment: { uploadID: attachment.uploadID } } : {}) });
      } else if (req.method === 'POST' && messageReactions) {
        const input = await body(req);
        if (typeof input.reactionKey !== 'string' || !input.reactionKey.trim() || input.reactionKey.length > 128) throw new Error('Réaction invalide.');
        options.method = 'POST'; options.headers['Content-Type'] = 'application/json'; options.body = JSON.stringify({ reactionKey: input.reactionKey });
      } else if (req.method === 'DELETE' && messageReactions) {
        options.method = 'DELETE';
      }
      const query = new URLSearchParams(); for (const key of ['cursor', 'direction', 'limit']) if (url.searchParams.has(key)) query.set(key, url.searchParams.get(key));
      const data = await remote(s.base, '/v1' + path + '?' + query, options);
      for (const source of avatarSources(data)) s.value.assets.add(source);
      s.value.media ||= new Map(); rememberMedia(data, s.value.media);
      return reply(res, 200, data);
    }
    if (url.pathname === '/api/media' && ['GET', 'HEAD'].includes(req.method)) return await serveMedia(req, res, s.value, url);
    if (url.pathname === '/api/avatar' && req.method === 'GET') {
      const asset = url.searchParams.get('url');
      if (!s.value.token || !s.value.assets.has(asset)) return reply(res, 404, { error: 'Avatar indisponible.' });
      const fileURL = /^(file|mxc|localmxc):/.test(asset) ? asset : pathToFileURL(asset).href;
      const result = await fetch(s.base + '/v1/assets/serve?' + new URLSearchParams({ url: fileURL }), { headers: { Authorization: `Bearer ${s.value.token}` }, signal: AbortSignal.timeout(12_000), redirect: 'error' });
      if (!result.ok) return reply(res, 404, { error: 'Avatar indisponible.' });
      if (Number(result.headers.get('content-length')) > 8_000_000) throw new Error('Avatar trop volumineux.');
      const chunks = []; let length = 0;
      for await (const chunk of result.body) { length += chunk.length; if (length > 8_000_000) throw new Error('Avatar trop volumineux.'); chunks.push(chunk); }
      const bytes = Buffer.concat(chunks), type = imageType(bytes);
      if (!type) return reply(res, 404, { error: 'Format de photo non pris en charge.' });
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' }); return res.end(bytes);
    }
    const file = staticFiles.get(url.pathname);
    if (!file || req.method !== 'GET') return reply(res, 404, { error: 'Page introuvable.' });
    const content = await readFile(join(root, file[0])); res.writeHead(200, { 'Content-Type': file[1] + '; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(content);
  } catch (error) {
    if (res.headersSent) { res.destroy(); return; }
    const message = error.name === 'TimeoutError' || error.message === 'fetch failed' ? 'Beeper est inaccessible. Ouvre Beeper et active son API locale dans Paramètres → Intégrations.' : error.message;
    if (req.url.startsWith('/oauth/callback')) { res.writeHead(303, { Location: '/?authError=' + encodeURIComponent(message) }); res.end(); }
    else reply(res, error.status || 400, { error: message });
  }
});
setInterval(() => {
  for (const [key, value] of flows) if (Date.now() - value.created > 600_000) flows.delete(key);
  for (const [key, value] of sessions) if (Date.now() - value.touched > 86_400_000) sessions.delete(key);
}, 60_000).unref();
server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? 'MSN Revival tourne déjà sur ' + origin : error.message); process.exitCode = 1; });
server.listen(port, '127.0.0.1', () => console.log('MSN Revival : ' + origin));
