import { pathToFileURL } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { imageType } from './profiles.mjs';

function inlineType(info, header, prefix) {
  const image = imageType(prefix); if (image) return image;
  const extension = /\.([a-z0-9]+)$/i.exec(info.name || '')?.[1]?.toLowerCase();
  const guessed = { mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mp3: 'audio/mpeg', m4a: 'audio/mp4', ogg: 'audio/ogg', wav: 'audio/wav' }[extension];
  const types = [header?.split(';')[0], info.mimeType, guessed];
  const allowed = /^(video\/(mp4|webm|ogg|quicktime)|audio\/(mpeg|mp4|ogg|wav|webm|aac|flac|x-wav)|image\/(jpeg|png|gif|webp|avif|bmp))$/i;
  for (const type of types) if (allowed.test(type || '')) return type;
  return 'application/octet-stream';
}
export async function serveMedia(req, res, session, url) {
  const asset = url.searchParams.get('url'), info = session.media?.get(asset);
  if (!session.token || !info || !/^(file:|mxc:|localmxc:|[a-z]:[\\/]|\/)/i.test(asset || '')) {
    res.writeHead(404); res.end('Média indisponible.'); return;
  }
  const range = req.headers.range;
  if (range && !/^bytes=\d*-\d*$/.test(range)) { res.writeHead(416); res.end(); return; }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  const cancel = () => controller.abort();
  req.once('aborted', cancel); res.once('close', cancel);
  try {
    const media = /^(file:|mxc:|localmxc:)/i.test(asset) ? asset : pathToFileURL(asset).href;
    const response = await fetch(session.base + '/v1/assets/serve?' + new URLSearchParams({ url: media }), {
      headers: { Authorization: `Bearer ${session.token}`, 'Accept-Encoding': 'identity', ...(range ? { Range: range } : {}) }, signal: controller.signal, redirect: 'error',
    });
    clearTimeout(timeout);
    if (response.status === 416) { res.writeHead(416, { ...(response.headers.get('content-range') ? { 'Content-Range': response.headers.get('content-range') } : {}) }); res.end(); await response.body?.cancel(); return; }
    if (!response.ok) { res.writeHead(response.status, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Le média n’est pas disponible dans Beeper.'); await response.body?.cancel(); return; }
    const reader = response.body.getReader();
    const first = await reader.read();
    const type = inlineType(info, response.headers.get('content-type'), first.value || new Uint8Array());
    const name = String(info.name || 'piece-jointe').replace(/[\x00-\x1f\x7f/\\"]/g, '_').slice(0, 180);
    const download = url.searchParams.get('download') === '1' || type === 'application/octet-stream';
    const headers = { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="piece-jointe"; filename*=UTF-8''${encodeURIComponent(name).replace(/['()*]/g, char => '%' + char.charCodeAt(0).toString(16))}` };
    for (const key of ['content-length', 'content-range', 'accept-ranges']) if (response.headers.has(key) && !response.headers.has('content-encoding')) headers[key] = response.headers.get(key);
    res.writeHead(response.status, headers);
    if (req.method === 'HEAD') { await reader.cancel(); res.end(); return; }
    async function* chunks() { try { if (!first.done) yield first.value; while (true) { const next = await reader.read(); if (next.done) break; yield next.value; } } finally { await reader.cancel().catch(() => {}); } }
    await pipeline(Readable.from(chunks(), { objectMode: false }), res);
  } finally { clearTimeout(timeout); controller.abort(); req.off('aborted', cancel); res.off('close', cancel); }
}
