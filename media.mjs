export const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
export function continuesMessageGroup(previous, message) {
  if (!previous || !!previous.isSender !== !!message.isSender) return false;
  // A display name alone is not an identity when Beeper supplies participant IDs.
  if (!message.isSender) {
    if (previous.senderID || message.senderID) { if (!previous.senderID || previous.senderID !== message.senderID) return false; }
    else if ((previous.senderName || '') !== (message.senderName || '')) return false;
  }
  const before = new Date(previous.timestamp), after = new Date(message.timestamp);
  return Number.isFinite(+before) && Number.isFinite(+after) && before.toDateString() === after.toDateString();
}
export function webURL(value) {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null; } catch { return null; }
}
export function mediaURL(value, download = false) {
  if (typeof value !== 'string' || !value) return null;
  if (/^https:\/\//i.test(value)) return webURL(value);
  if (/^data:image\/(png|jpeg|gif|webp);base64,/i.test(value) && !download) return value;
  if (/^(mxc:|localmxc:|file:)/i.test(value) || /^[a-z]:[\\/]/i.test(value) || value.startsWith('/')) return '/api/media?' + new URLSearchParams({ url: value, ...(download ? { download: '1' } : {}) });
  return null;
}
export function attachmentSource(file) {
  return /^(mxc:|localmxc:|file:)/i.test(file.id || '') ? file.id : (file.srcURL || file.id);
}
export function attachmentKind(file) {
  const extension = /\.([a-z0-9]+)$/i.exec(file.fileName || '')?.[1]?.toLowerCase();
  if (file.isGif || file.isSticker) return 'image';
  if (file.isVoiceNote) return 'audio';
  if (file.type === 'img' || file.mimeType?.startsWith('image/')) return 'image';
  if (file.type === 'video' || file.mimeType?.startsWith('video/')) return 'video';
  if (file.type === 'audio' || file.mimeType?.startsWith('audio/')) return 'audio';
  if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'bmp'].includes(extension)) return 'image';
  if (['mp4', 'webm', 'mov', 'ogv'].includes(extension)) return 'video';
  if (['mp3', 'm4a', 'aac', 'wav', 'flac', 'ogg', 'opus'].includes(extension)) return 'audio';
  return 'file';
}
export function rememberMedia(data, registry) {
  for (const message of data.items || []) {
    if (message.isDeleted || message.isHidden) continue;
    for (const file of message.attachments || []) {
      const info = { kind: attachmentKind(file), mimeType: file.mimeType, name: file.fileName || 'Pièce jointe' };
      for (const source of [file.id, file.srcURL]) if (mediaURL(source)) registry.set(source, info);
      if (mediaURL(file.posterImg)) registry.set(file.posterImg, { kind: 'image', name: 'Aperçu vidéo' });
    }
    for (const link of message.links || []) for (const source of [link.img, link.favicon]) if (mediaURL(source)) registry.set(source, { kind: 'image', name: 'Aperçu du lien' });
  }
}
export function linkify(text) {
  text = String(text ?? '');
  let result = '', last = 0;
  for (const match of String(text).matchAll(/(?:https?:\/\/|www\.)[^\s<>"\u0000-\u001f]+/gi)) {
    const raw = match[0].replace(/[.,!?;:]+$/, '').replace(/\)+$/, tail => {
      const before = match[0].slice(0, -tail.length); return ')'.repeat(Math.min(tail.length, Math.max(0, (before.match(/\(/g) || []).length - (before.match(/\)/g) || []).length)));
    });
    const url = webURL(raw.startsWith('www.') ? 'https://' + raw : raw);
    result += escapeHTML(text.slice(last, match.index));
    result += url ? `<a href="${escapeHTML(url)}" target="_blank" rel="noopener noreferrer">${escapeHTML(raw)}</a>` : escapeHTML(raw);
    last = match.index + raw.length;
  }
  return result + escapeHTML(text.slice(last));
}
export function instagramLink(value) {
  const safe = webURL(value); if (!safe) return null;
  const url = new URL(safe); if (!/(^|\.)instagram\.com$/i.test(url.hostname)) return null;
  const kind = /^\/(reel|reels)\//.test(url.pathname) ? 'Reel Instagram' : /^\/stories\//.test(url.pathname) ? 'Story Instagram' : 'Publication Instagram';
  return { url: safe, title: kind, summary: 'Ouvrir dans Instagram' };
}
export function linkPreviews(message, plainText) {
  const links = new Map();
  for (const link of message.links || []) { const url = webURL(link.url); if (url) links.set(url, { ...link, url }); }
  for (const match of plainText.matchAll(/https?:\/\/[^\s<>"']+/gi)) { const link = instagramLink(match[0].replace(/[).,;!]+$/, '')); if (link && !links.has(link.url)) links.set(link.url, link); }
  return [...links.values()];
}
export function formatSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  return bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} Mo` : `${Math.max(1, Math.round(bytes / 1000))} ko`;
}
export function renderAttachments(message) {
  return (message.attachments || []).map(file => {
    const source = attachmentSource(file), src = mediaURL(source), download = mediaURL(source, true), kind = attachmentKind(file);
    const title = file.isSticker ? 'Autocollant' : file.isGif ? 'GIF animé' : file.fileName || ({ image: 'Photo', video: 'Vidéo', audio: file.isVoiceNote ? 'Message vocal' : 'Audio', file: 'Pièce jointe' }[kind]);
    const details = [formatSize(file.fileSize), Number.isFinite(file.duration) ? `${Math.floor(file.duration / 60)}:${String(Math.floor(file.duration % 60)).padStart(2, '0')}` : ''].filter(Boolean).join(' · ');
    let content = '';
    if (src && kind === 'image') content = `<button class="photo-open" data-photo="${escapeHTML(src)}" data-name="${escapeHTML(title)}" data-download="${escapeHTML(download)}" aria-label="Agrandir ${escapeHTML(title)}"><img class="message-photo"${file.isGif ? ' data-gif="true"' : ''} src="${escapeHTML(src)}" alt="${escapeHTML(title)}" loading="lazy" referrerpolicy="no-referrer" /></button>`;
    else if (src && kind === 'video') content = `<video class="message-video" controls playsinline preload="metadata" src="${escapeHTML(src)}"${mediaURL(file.posterImg) ? ` poster="${escapeHTML(mediaURL(file.posterImg))}"` : ''}></video>`;
    else if (src && kind === 'audio') content = `<audio class="message-audio" controls preload="metadata" src="${escapeHTML(src)}"></audio>`;
    else content = `<span class="file-icon-small" aria-hidden="true">📎</span>`;
    return `<figure class="attachment attachment-${kind}">${content}<div class="media-error" hidden>Impossible de lire ce média. <button class="media-retry">Réessayer</button></div><figcaption><span>${escapeHTML(title)}${details ? ` <small>${escapeHTML(details)}</small>` : ''}</span>${download ? `<a class="media-download" href="${escapeHTML(download)}" download="${escapeHTML(title)}" target="_blank" rel="noopener noreferrer">Télécharger</a>` : '<small>Média non fourni par Beeper</small>'}</figcaption>${file.transcription?.transcription ? `<p class="transcription">${escapeHTML(file.transcription.transcription)}</p>` : ''}</figure>`;
  }).join('');
}
export function renderPreviews(message, plainText) {
  return linkPreviews(message, plainText).map(link => {
    const image = mediaURL(link.img), insta = instagramLink(link.url);
    const host = new URL(link.url).hostname.replace(/^www\./, ''), platform = insta ? 'Instagram' : host;
    const title = link.title && link.title !== link.url ? link.title : insta?.title || host;
    return `<a class="link-preview${insta ? ' is-instagram' : ''}${image ? ' has-image' : ''}" href="${escapeHTML(link.url)}" target="_blank" rel="noopener noreferrer">${image ? `<span class="link-preview-media"><img src="${escapeHTML(image)}" alt="Aperçu de ${escapeHTML(platform)}" loading="lazy" referrerpolicy="no-referrer" /><span class="link-preview-badge">${escapeHTML(platform)}</span></span>` : ''}<span class="link-preview-copy"><small>${escapeHTML(platform)}</small><strong>${escapeHTML(title)}</strong>${link.summary && link.summary !== title ? `<span>${escapeHTML(link.summary)}</span>` : ''}<em>Ouvrir le lien ↗</em></span></a>`;
  }).join('');
}
