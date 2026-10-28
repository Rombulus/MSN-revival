import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linkify, webURL, mediaURL, renderAttachments, renderPreviews, rememberMedia, instagramLink } from '../media.mjs';
test('rend les liens web cliquables en échappant le contenu du message', () => {
  const html = linkify('<script>bad()</script> Voir https://instagram.com/reel/abc/?x=1&y=2.');
  assert.ok(html.includes('&lt;script&gt;')); assert.ok(html.includes('rel="noopener noreferrer"')); assert.ok(html.includes('x=1&amp;y=2')); assert.ok(!html.includes('<script>')); assert.match(html, /<\/a>\.$/);
  assert.equal(webURL('javascript:alert(1)'), null); assert.equal(webURL('https://user:password@example.com'), null);
});
test('reconnaît Instagram sans accepter les domaines ressemblants', () => {
  assert.equal(instagramLink('https://www.instagram.com/reel/abc/').title, 'Reel Instagram');
  assert.equal(instagramLink('https://instagram.com.evil.example/p/abc/'), null);
});
test('utilise le proxy pour les fichiers locaux et refuse les URL actives', () => {
  assert.match(mediaURL('mxc://image'), /^\/api\/media\?/); assert.match(mediaURL('C:\\photos\\test.jpg', true), /download=1/);
  assert.equal(mediaURL('javascript:alert(1)'), null); assert.equal(mediaURL('data:image/svg+xml,<svg/>'), null);
});
test('rend les lecteurs natifs et une vignette agrandissable avec téléchargement', () => {
  const html = renderAttachments({ attachments: [{ type: 'img', id: 'mxc://photo', fileName: '<photo>.png' }, { type: 'video', id: 'mxc://clip', posterImg: 'mxc://poster' }, { type: 'audio', id: 'mxc://voice', isVoiceNote: true }] });
  assert.match(html, /data-photo=/); assert.match(html, /<video[^>]+controls/); assert.match(html, /<audio[^>]+controls/); assert.ok(html.includes('&lt;photo&gt;.png')); assert.ok(!html.includes('autoplay'));
});
test('rend une carte Instagram sans aperçu et les métadonnées Beeper quand elles existent', () => {
  const fallback = renderPreviews({}, 'https://www.instagram.com/reel/abc/'); assert.ok(fallback.includes('Reel Instagram')); assert.ok(!fallback.includes('<iframe'));
  const preview = renderPreviews({ links: [{ url: 'https://example.com', title: '<b>unsafe</b>', img: 'mxc://preview', summary: 'Description' }] }, ''); assert.ok(preview.includes('&lt;b&gt;')); assert.match(preview, /<img/);
});
test('autorise uniquement les fichiers annoncés par les messages visibles', () => {
  const sources = new Map(); rememberMedia({ items: [{ attachments: [{ type: 'video', id: 'mxc://clip', srcURL: 'file:///clip', posterImg: 'mxc://poster' }], links: [{ img: 'mxc://preview' }] }, { isDeleted: true, attachments: [{ id: 'mxc://deleted' }] }] }, sources);
  assert.deepEqual([...sources.keys()].sort(), ['file:///clip', 'mxc://clip', 'mxc://poster', 'mxc://preview']);
});
