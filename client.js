import { conversationProfiles, networkIdentity, rosterGroups, historyEntries } from './profiles.mjs';
import { linkify, webURL, renderAttachments, renderPreviews, matchInstagramReels, continuesMessageGroup } from './media.mjs';
const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const clock = value => value ? new Date(value).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '';
const dateClock = value => { const date = new Date(value); return value && Number.isFinite(date.getTime()) ? `${date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })} · ${clock(value)}` : ''; };
const demo = [{ id: 'demo', name: 'Quentin', network: 'Démonstration', messages: [
  { id: '1', senderName: 'Quentin', text: 'Wesh :)', timestamp: new Date().toISOString() },
  { id: '2', senderName: 'Moi', text: 'Tu fais quoi ce soir ?', isSender: true, timestamp: new Date().toISOString() },
  { id: '3', senderName: 'Quentin', text: 'On se retrouve sur MSN ? 😄', timestamp: new Date().toISOString() },
], pending: [], draft: '' }];
let chats = structuredClone(demo), activeId = 'demo', connected = false, sending = false;
let chatsCursor = null, listBusy = false, syncBusy = false, soundOn = true, audioContext, toastTimer;
let accounts = [], accountsLoaded = false;
let recording = null, recordingSequence = 0, draftAudioURL = null, draftImageURL = null;
const quickReactions = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
const senderColors = [
  { value: '#008900', hue: 130 }, { value: '#c74d00', hue: 30 },
  { value: '#0055e7', hue: 215 }, { value: '#827400', hue: 65 },
  { value: '#00777a', hue: 180 }, { value: '#c90030', hue: 350 },
  { value: '#6f00c8', hue: 275 }, { value: '#727d00', hue: 90 },
];
const selfSenderColor = '#d000ad';
const collapsedRosterGroups = new Set();
let historyUnreadOnly = false;
let readTimer;
let authorization = null, connectionBusy = false;
const seen = new Map();
const current = () => chats.find(chat => chat.id === activeId);
const plain = text => /<\/?[a-z][^>]*>/i.test(text || '') ? new DOMParser().parseFromString(text, 'text/html').body.textContent : (text || '');
// Twemoji v17.0.3 artwork (CC BY 4.0): https://github.com/jdecked/twemoji
const emojiCodepoint = value => {
  const points = [...value].map(char => char.codePointAt(0).toString(16));
  return points.filter(point => point !== 'fe0f' || points.includes('200d')).join('-');
};
const emojiImageURL = value => `https://cdn.jsdelivr.net/gh/jdecked/twemoji@17.0.3/assets/svg/${emojiCodepoint(value)}.svg`;
function fallbackEmojiImage(event) {
  const image = event.target;
  if (image instanceof HTMLImageElement && image.matches('.inline-emoji, .emoji-art')) image.replaceWith(document.createTextNode(image.alt));
}
let emojiMatcher;
try { emojiMatcher = new RegExp('[\\p{Extended_Pictographic}\\p{Regional_Indicator}]', 'u'); }
catch { emojiMatcher = /[\u{1F000}-\u{1FAFF}\u2600-\u27BF]/u; }
const isEmojiSegment = value => emojiMatcher.test(value) || value.includes('\u20e3');
const emojiSegmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter('fr', { granularity: 'grapheme' }) : null;
function renderEmojiText(value, shouldLinkify = true) {
  const segments = emojiSegmenter ? [...emojiSegmenter.segment(String(value))].map(item => item.segment) : Array.from(String(value));
  const output = []; let textRun = '';
  for (const segment of segments) {
    if (!isEmojiSegment(segment)) { textRun += segment; continue; }
    if (textRun) { output.push(shouldLinkify ? linkify(textRun) : esc(textRun)); textRun = ''; }
    output.push(`<img class="inline-emoji" src="${emojiImageURL(segment)}" alt="${esc(segment)}" title="${esc(segment)}" referrerpolicy="no-referrer" draggable="false">`);
  }
  if (textRun) output.push(shouldLinkify ? linkify(textRun) : esc(textRun));
  return output.join('');
}
function markdownInline(value) {
  const pattern = /\*\*([^*\n]+)\*\*|__([^_\n]+)__|~~([^~\n]+)~~|\*([^*\n]+)\*|_([^_\n]+)_|`([^`\n]+)`|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
  let output = '', last = 0, match;
  while ((match = pattern.exec(value))) {
    output += renderEmojiText(value.slice(last, match.index));
    if (match[1] || match[2]) output += `<strong>${renderEmojiText(match[1] || match[2])}</strong>`;
    else if (match[3]) output += `<del>${renderEmojiText(match[3])}</del>`;
    else if (match[4] || match[5]) output += `<em>${renderEmojiText(match[4] || match[5])}</em>`;
    else if (match[6]) output += `<code>${esc(match[6])}</code>`;
    else { const href = webURL(match[8]); output += href ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${renderEmojiText(match[7], false)}</a>` : esc(match[7]); }
    last = pattern.lastIndex;
  }
  return output + renderEmojiText(value.slice(last));
}
function markdownText(value) {
  let inCode = false, codeLines = [], output = [];
  for (const line of String(value).split(/\r?\n/)) {
    if (/^\s*```/.test(line)) {
      if (inCode) { output.push(`<pre><code>${esc(codeLines.join('\n'))}</code></pre>`); codeLines = []; }
      inCode = !inCode; continue;
    }
    if (inCode) { codeLines.push(line); continue; }
    const heading = line.match(/^\s*(#{1,6})\s+(.+)$/);
    const quote = line.match(/^\s*>\s?(.+)$/);
    const list = line.match(/^\s*[-*+]\s+(.+)$/);
    if (heading) output.push(`<strong class="markdown-heading">${markdownInline(heading[2])}</strong>`);
    else if (quote) output.push(`<blockquote>${markdownInline(quote[1])}</blockquote>`);
    else if (list) output.push(`<div class="markdown-list-item">• ${markdownInline(list[1])}</div>`);
    else output.push(markdownInline(line));
  }
  if (inCode) output.push(`<pre><code>${esc(codeLines.join('\n'))}</code></pre>`);
  return output.join('<br>');
}
function richText(text) {
  if (!/<\/?[a-z][^>]*>/i.test(text || '')) return markdownText(text || '');
  const doc = new DOMParser().parseFromString(text, 'text/html');
  function walk(node) {
    if (node.nodeType === Node.TEXT_NODE) return renderEmojiText(node.textContent);
    if (node.nodeType !== Node.ELEMENT_NODE || ['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'SVG'].includes(node.tagName)) return '';
    if (node.tagName === 'BR') return '<br>';
    if (node.tagName === 'A') { const href = webURL(node.getAttribute('href')); return href ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${renderEmojiText(node.textContent, false)}</a>` : renderEmojiText(node.textContent); }
    const children = [...node.childNodes].map(walk).join('');
    const tag = { B: 'strong', STRONG: 'strong', I: 'em', EM: 'em', CODE: 'code', BLOCKQUOTE: 'blockquote' }[node.tagName];
    return tag ? `<${tag}>${children}</${tag}>` : children + (['P', 'DIV', 'LI'].includes(node.tagName) ? '<br>' : '');
  }
  return [...doc.body.childNodes].map(walk).join('');
}
function toast(message) { $('#toast').textContent = message; $('#toast').classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').classList.remove('show'), 4500); }
function chime(wizz = false) {
  if (!soundOn || recording) return;
  try {
    audioContext ||= new AudioContext(); audioContext.resume(); const now = audioContext.currentTime;
    if (wizz) {
      const oscillator = audioContext.createOscillator(), filter = audioContext.createBiquadFilter(), gain = audioContext.createGain();
      oscillator.type = 'sawtooth'; filter.type = 'lowpass'; filter.frequency.value = 1450; filter.Q.value = 1.1;
      const steps = [330, 690, 285, 760, 310, 650, 250], step = .15;
      oscillator.frequency.setValueAtTime(steps[0], now);
      steps.slice(1).forEach((frequency, index) => oscillator.frequency.setValueAtTime(frequency, now + (index + 1) * step));
      gain.gain.setValueAtTime(.001, now); gain.gain.linearRampToValueAtTime(.105, now + .035);
      for (let index = 0; index < steps.length; index++) {
        const start = now + index * step;
        gain.gain.setValueAtTime(index % 2 ? .055 : .11, start + .04);
        gain.gain.linearRampToValueAtTime(.018, start + step - .015);
      }
      gain.gain.linearRampToValueAtTime(.001, now + steps.length * step);
      oscillator.connect(filter); filter.connect(gain); gain.connect(audioContext.destination);
      oscillator.start(now); oscillator.stop(now + steps.length * step + .02);
    } else [660, 790, 990].forEach((frequency, index) => {
      const oscillator = audioContext.createOscillator(), gain = audioContext.createGain(), start = now + index * .1;
      oscillator.type = 'sine'; oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(.001, start); gain.gain.exponentialRampToValueAtTime(.1, start + .015); gain.gain.exponentialRampToValueAtTime(.001, start + .22);
      oscillator.connect(gain); gain.connect(audioContext.destination); oscillator.start(start); oscillator.stop(start + .25);
    });
  } catch {}
}
const WIZZ_MESSAGE = '*vous avez reçu un wizz*';
const isWizzMessage = message => plain(message?.text).trim().toLocaleLowerCase('fr') === WIZZ_MESSAGE;
function triggerWizz() {
  const windowElement = $('#window'); windowElement.classList.remove('shake'); void windowElement.offsetWidth; windowElement.classList.add('shake');
  chime(true); setTimeout(() => windowElement.classList.remove('shake'), 1500);
}
async function request(path, options = {}) {
  const response = await fetch(path, { ...options, cache: 'no-store', headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers } });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error || `Erreur ${response.status}`), { status: response.status });
  return data;
}
const beeper = (path, options) => request('/api/beeper' + path, options);
function connectionLabel(text, error = false) { $('#connection-label').textContent = text; $('#connection-label').classList.toggle('connection-error', error); }
function normalize(chat, previous) {
  const profiles = conversationProfiles(chat, accounts);
  const account = accounts.find(item => item.accountID === chat.accountID);
  return Object.assign(previous || {}, { id: chat.id, name: chat.title || 'Conversation', network: chat.network || 'Beeper', unread: chat.unreadCount || 0, avatar: profiles.contactPhoto, selfAvatar: profiles.selfPhoto, readOnly: !!chat.isReadOnly,
    selfName: profiles.selfName, accountID: chat.accountID, bridge: account?.bridge?.id, type: chat.type, pinned: !!chat.isPinned, labels: chat.labels || [],
    preview: chat.preview, lastActivity: chat.lastActivity || chat.preview?.timestamp, markedUnread: !!chat.isMarkedUnread,
    sourceChatIDs: [...new Set((chat.merge?.chatIDs || []).filter(id => typeof id === 'string' && id !== chat.id))], sourcePages: previous?.sourcePages || new Map(),
    messages: previous?.messages || [], pending: previous?.pending || [], draft: previous?.draft || '', oldestCursor: previous?.oldestCursor, hasMore: previous?.hasMore || false });
}
function renderContacts() {
  $('#contact-picker').innerHTML = chats.map(chat => `<option value="${esc(chat.id)}">${esc(chat.name)}${chat.unread ? ` (${chat.unread})` : ''} — ${esc(chat.network)}</option>`).join('');
  $('#contact-picker').value = activeId;
  renderRoster();
  renderHistory();
}
function historySummary(chat) {
  const candidates = [chat.preview, ...chat.messages.slice(-1), ...chat.pending].filter(message => message && !message.isHidden);
  candidates.sort((a, b) => (Date.parse(b.timestamp) || 0) - (Date.parse(a.timestamp) || 0));
  const latest = candidates[0];
  let preview = '', draft = false;
  if (chat.draft?.trim()) { preview = 'Brouillon : ' + chat.draft; draft = true; }
  else if (chat.file) { preview = 'Brouillon : ' + (chat.file.voiceNote ? 'Message vocal' : chat.file.name); draft = true; }
  else if (latest) {
    if (latest.failed) preview = 'Envoi non confirmé';
    else if (latest.isDeleted) preview = 'Message supprimé';
    else {
      preview = plain(latest.text);
      if (!preview && latest.attachments?.length) {
        const file = latest.attachments[0]; preview = file.isVoiceNote ? 'Message vocal' : file.type === 'img' || file.mimeType?.startsWith('image/') ? 'Photo' : file.type === 'video' || file.mimeType?.startsWith('video/') ? 'Vidéo' : file.type === 'audio' || file.mimeType?.startsWith('audio/') ? 'Audio' : file.fileName || 'Pièce jointe';
      }
      if (!preview && latest.links?.length) preview = latest.links[0].title || 'Lien partagé';
      if (latest.isSender) preview = 'Vous : ' + preview;
      else if (chat.type === 'group' && latest.senderName) preview = latest.senderName + ' : ' + preview;
    }
  }
  const dates = [chat.lastActivity, latest?.timestamp].filter(Boolean).sort((a, b) => (Date.parse(b) || 0) - (Date.parse(a) || 0));
  return { ...chat, previewText: preview.replace(/\s+/g, ' ').trim().slice(0, 300) || 'Ouvrir la conversation', hasDraft: draft, activityAt: dates[0] };
}
function renderHistory() {
  const list = $('#conversation-list'), scrollTop = list.scrollTop;
  const entries = historyEntries(chats.map(historySummary), { query: $('#history-search').value, unreadOnly: historyUnreadOnly });
  // Keep rows (and their SVGs) alive while typing or polling. Only move them when order changes.
  const old = new Map([...list.children].map(node => [node.dataset.historyKey, node]));
  let group = '', position = list.firstElementChild;
  const text = (node, value) => { if (node.textContent !== value) node.textContent = value; };
  const attribute = (node, name, value) => { if (node.getAttribute(name) !== value) { if (value === null) node.removeAttribute(name); else node.setAttribute(name, value); } };
  function place(key, create) {
    const node = old.get(key) || create(); old.delete(key); node.dataset.historyKey = key;
    if (node !== position) list.insertBefore(node, position);
    position = node.nextElementSibling;
    return node;
  }
  for (const chat of entries) {
    const network = networkIdentity(chat), unread = chat.unread > 0 || chat.markedUnread;
    if (group !== chat.historyGroup) {
      group = chat.historyGroup;
      const heading = place('group:' + group, () => { const node = document.createElement('div'); node.className = 'history-day'; return node; });
      text(heading, group);
    }
    const row = place('chat:' + chat.id, () => {
      const node = document.createElement('button'); node.type = 'button'; node.dataset.historyId = chat.id;
      node.innerHTML = '<span class="history-contact-avatar" aria-hidden="true"><svg class="msn-contact-icon" viewBox="0 0 48 48"><use href="assets/legacy-icons.svg#msn-contact-person" /></svg><svg role="img"><use /></svg></span><span class="history-chat-copy"><span class="history-chat-top"><strong></strong><time></time></span><span class="history-chat-bottom"><span class="history-snippet"></span><span class="history-badge"></span></span></span>';
      return node;
    });
    attribute(row, 'class', `history-chat${chat.id === activeId ? ' selected' : ''}${unread ? ' unread' : ''}`);
    attribute(row, 'aria-current', chat.id === activeId ? 'true' : null);
    attribute(row, 'title', `${chat.name} — ${network.name}`);
    const networkBadge = row.querySelector('.history-network-badge') || row.querySelector('.history-contact-avatar > svg[role="img"]');
    attribute(networkBadge, 'class', `history-network-badge network-logo network-${network.icon}`);
    attribute(networkBadge, 'aria-label', network.name);
    attribute(networkBadge.querySelector('use'), 'href', `assets/legacy-icons.svg#app-${network.icon}`);
    text(row.querySelector('strong'), chat.name);
    text(row.querySelector('time'), chat.historyTime);
    attribute(row.querySelector('time'), 'title', chat.activityAt || '');
    const snippet = row.querySelector('.history-snippet'), badge = row.querySelector('.history-badge');
    text(snippet, `— ${chat.previewText}`);
    attribute(snippet, 'class', `history-snippet${chat.hasDraft ? ' is-draft' : ''}`);
    badge.hidden = !unread;
    if (unread) { text(badge, String(chat.unread || '●')); attribute(badge, 'aria-label', `${chat.unread || 1} conversation ou messages non lus`); }
  }
  if (!entries.length) {
    const empty = place('empty', () => { const node = document.createElement('p'); node.className = 'history-empty'; return node; });
    text(empty, $('#history-search').value.trim() ? 'Aucun résultat dans les conversations chargées.' : historyUnreadOnly ? 'Aucune conversation non lue.' : 'Aucune conversation récente.');
  }
  for (const node of old.values()) node.remove();
  list.scrollTop = scrollTop;
  $('#history-count').textContent = `${entries.length} affichée${entries.length > 1 ? 's' : ''} · ${chats.length} chargée${chats.length > 1 ? 's' : ''}`;
  const unreadCount = chats.filter(chat => chat.unread > 0 || chat.markedUnread).length;
  $('#history-unread-count').textContent = unreadCount ? `(${unreadCount})` : '';
  $('#sidebar-more').hidden = !chatsCursor || !connected; $('#sidebar-more').disabled = listBusy;
}
function renderRoster() {
  const query = $('#contact-search').value;
  const groups = rosterGroups(chats, query);
  $('#roster-list').innerHTML = groups.map(group => `<details class="roster-group" data-group="${esc(group.id)}"${query.trim() || !collapsedRosterGroups.has(group.id) ? ' open' : ''}><summary>${esc(group.name)} <span>(${group.chats.length})</span></summary><div class="roster-group-contacts">${group.chats.map(chat => {
    const network = networkIdentity(chat);
    return `<button class="roster-contact${chat.id === activeId ? ' selected' : ''}" data-id="${esc(chat.id)}" title="${esc(chat.name)} — ${esc(network.name)}"${chat.id === activeId ? ' aria-current="true"' : ''}><svg class="network-logo network-${network.icon}" role="img" aria-label="${esc(network.name)}"><use href="assets/legacy-icons.svg#app-${network.icon}" /></svg><span class="roster-name">${esc(chat.name)}</span>${chat.unread ? `<em aria-label="${chat.unread} messages non lus">${chat.unread}</em>` : ''}</button>`;
  }).join('')}</div></details>`).join('') || '<p class="roster-empty">Aucune conversation trouvée.</p>';
  $('#roster-count').textContent = `${chats.length} conversation${chats.length > 1 ? 's' : ''}`;
  $('#roster-more').hidden = !chatsCursor;
}
function renderHeader() {
  const chat = current(); if (!chat) return;
  $('#contact-picker').value = activeId; $('#contact-display').textContent = chat.name;
  $('#chat-status').textContent = connected ? chat.network : chat.id === 'demo' ? 'Démo' : 'Déconnecté';
  $('#window-title').textContent = `${chat.name} — Conversation`;
  document.title = `${chat.name} — MSN Revival`;
  $('#message-input').disabled = chat.readOnly;
  $('#message-input').placeholder = chat.readOnly ? 'Cette conversation est en lecture seule.' : `Écris un message à ${chat.name}…`;
  $('#send-btn').disabled = chat.readOnly || sending || !!recording || (!connected && chat.id !== 'demo');
  $('#wizz-btn').disabled = chat.readOnly || sending || !!recording || (!connected && chat.id !== 'demo');
  $('#attach-btn').disabled = chat.readOnly || !connected || sending || !!recording;
  $('#voice-clip-btn').disabled = chat.readOnly || !connected || sending;
  $('#emoji-btn').disabled = chat.readOnly;
  setPhoto($('#contact-photo'), $('.avatar-card .buddy-art'), connected && chat.avatar);
  setPhoto($('#self-photo'), $('.self-fallback'), connected && chat.selfAvatar);
  $('#self-display').textContent = chat.selfName && chat.selfName !== 'Moi' ? `${chat.selfName} (moi)` : 'Moi';
  $('#history-more').hidden = !chat.hasMore || !connected;
  renderReplyDraft();
}
function renderReplyDraft() {
  const banner = $('#reply-draft'), target = current()?.replyDraft;
  banner.hidden = !target;
  if (!target) return;
  $('#reply-draft-name').textContent = target.name;
  $('#reply-draft-text').textContent = target.text || 'Pièce jointe';
}
function ownReactionIDs(chat) {
  const user = accounts.find(item => item.accountID === chat.accountID)?.user || {};
  return new Set([user.userID, user.id, user.matrixUserID, user.userId, user.username].filter(Boolean));
}
function messageActions(message, chat) {
  if (!connected || chat.readOnly || chat.id === 'demo' || message.localPending || !message.id || message.isDeleted) return '';
  const sourceID = message.chatID || chat.id;
  const picker = quickReactions.map(emoji => `<button data-message-reaction="${esc(emoji)}" aria-label="Réagir ${esc(emoji)}">${esc(emoji)}</button>`).join('');
  return `<div class="message-actions"><button class="message-action-icon" data-reply-message="${esc(message.id)}" data-reply-chat="${esc(sourceID)}" title="Répondre" aria-label="Répondre à ce message">↩</button><div class="message-react-control"><button class="message-action-icon" data-toggle-reactions aria-expanded="false" aria-label="Réagir au message" title="Réagir">☺</button><div class="message-reaction-picker" hidden>${picker}</div></div></div>`;
}
function messageReactionsMarkup(message, chat) {
  const ownIDs = ownReactionIDs(chat);
  const grouped = new Map();
  for (const reaction of message.reactions || []) {
    const key = reaction.reactionKey; if (typeof key !== 'string' || !key) continue;
    const group = grouped.get(key) || []; group.push(reaction); grouped.set(key, group);
  }
  const reactionButtons = [...grouped].map(([key, group]) => {
    const label = key === 'heart' ? '❤️' : key === 'like' ? '👍' : key.replace(/^:|:$/g, '');
    const mine = group.some(reaction => ownIDs.has(reaction.participantID));
    return `<button class="message-reaction${mine ? ' mine' : ''}" data-message-reaction="${esc(key)}" aria-label="${group.length} réaction${group.length === 1 ? '' : 's'} ${esc(label)}${mine ? ', toi aussi' : ''}" aria-pressed="${mine}">${esc(label)} <span>${group.length}</span></button>`;
  }).join('');
  return reactionButtons ? `<div class="message-reactions">${reactionButtons}</div>` : '';
}
function replyQuote(message, chat) {
  if (!message.linkedMessageID) return '';
  const target = [...chat.messages, ...chat.pending].find(item => item.id === message.linkedMessageID && (!message.chatID || !item.chatID || item.chatID === message.chatID));
  const who = target ? (target.isSender ? (chat.selfName || 'Moi') : target.senderName || chat.name) : 'Message précédent';
  const summary = target ? plain(target.text || target.replyPreview) || (target.attachments?.length ? 'Pièce jointe' : 'Message') : 'Réponse à un message';
  return `<button class="reply-quote" data-jump-message="${esc(message.linkedMessageID)}" data-reply-chat="${esc(message.chatID || chat.id)}"><strong>${esc(who)}</strong><span>${esc(summary.slice(0, 180))}</span></button>`;
}
function setPhoto(image, fallback, source) {
  const next = source || '';
  if (image.dataset.source === next) return;
  image.dataset.source = next; image.hidden = true; fallback.hidden = false;
  image.referrerPolicy = 'no-referrer';
  image.onload = () => { image.hidden = false; fallback.hidden = true; };
  image.onerror = () => { image.hidden = true; fallback.hidden = false; };
  if (!next) { image.removeAttribute('src'); return; }
  image.src = /^https:\/\//i.test(next) || /^data:image\/(png|jpeg|webp|gif);base64,/i.test(next) ? next : '/api/avatar?' + new URLSearchParams({ url: next });
}
function scrollToLatest(box = $('#messages')) {
  box.dataset.follow = 'true';
  box.scrollTop = box.scrollHeight;
}
function senderColorAssignments(rows, chat) {
  const assignments = new Map([['self', selfSenderColor]]);
  const senders = [];
  for (const message of rows) {
    if (message.isHidden || message.isSender) continue;
    const name = message.senderName || chat.name;
    const key = message.senderID ? `id:${message.senderID}` : `name:${name.trim().toLocaleLowerCase()}`;
    if (!assignments.has(key) && !senders.includes(key)) senders.push(key);
  }
  const available = [...senderColors];
  const usedHues = [310];
  for (const key of senders) {
    if (!available.length) { assignments.set(key, senderColors[senders.indexOf(key) % senderColors.length].value); continue; }
    let bestIndex = 0, bestDistance = -1;
    for (let index = 0; index < available.length; index++) {
      const hue = available[index].hue;
      const distance = Math.min(...usedHues.map(used => { const delta = Math.abs(hue - used); return Math.min(delta, 360 - delta); }));
      if (distance > bestDistance) { bestDistance = distance; bestIndex = index; }
    }
    const [chosen] = available.splice(bestIndex, 1);
    assignments.set(key, chosen.value); usedHues.push(chosen.hue);
  }
  return assignments;
}
function renderMessages(forceBottom = false) {
  const chat = current(); if (!chat) return;
  const box = $('#messages'); const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
  const rows = [...chat.messages, ...chat.pending];
  const colorsBySender = senderColorAssignments(rows, chat);
  const old = new Map();
  for (const node of [...box.children]) { if (node.dataset.messageKey) old.set(node.dataset.messageKey, node); else node.remove(); }
  let position = box.firstElementChild, count = 0, previous = null;
  for (const message of rows) {
    if (message.isHidden) continue;
    const name = message.isSender ? (chat.selfName || 'Moi') : (message.senderName || chat.name);
    const key = String(message.localId || message.sourceKey || message.id), signature = JSON.stringify([name, message.timestamp, message.text, message.attachments, message.links, message.reactions, message.linkedMessageID, message.isDeleted, message.failed, message.progress, message.localPending, message.sendStatus?.status, message.sendStatus?.message, chat.readOnly, connected]);
    let node = old.get(key); old.delete(key);
    if (!node) { node = document.createElement('article'); node.dataset.messageKey = key; }
    const senderKey = message.isSender ? 'self' : message.senderID ? `id:${message.senderID}` : `name:${name.trim().toLocaleLowerCase()}`;
    node.style.setProperty('--sender-color', colorsBySender.get(senderKey) || senderColors[0].value);
    const playing = [...node.querySelectorAll('video,audio')].some(player => !player.paused && !player.ended);
    if (node.dataset.signature !== signature && (!playing || message.isDeleted)) {
      node.className = `message-row ${message.isSender ? 'mine' : ''}`; node.dataset.signature = signature;
      node.dataset.messageId = message.id || '';
      node.dataset.messageChat = message.chatID || chat.id;
      const text = message.isDeleted ? '(Message supprimé)' : (message.text || (!message.attachments?.length && !message.links?.length ? '(Message sans texte)' : ''));
      const reels = matchInstagramReels(message, plain(message.text));
      const replyTo = message.linkedMessageID ? replyQuote(message, chat) : '';
      node.innerHTML = `<div class="message-content"><div class="message-meta"><strong>${renderEmojiText(name, false)} dit :</strong><time datetime="${esc(message.timestamp)}" title="${esc(message.timestamp)}">${esc(dateClock(message.timestamp))}</time></div>${replyTo}<div class="message-line"><div class="bubble">${richText(text)}</div>${messageActions(message, chat)}</div>${message.isDeleted ? '' : renderAttachments(message, reels) + renderPreviews(message, plain(message.text), reels.fusedURLs)}${message.localPending ? `<small class="send-state ${message.failed ? 'failed' : ''}">${message.failed ? 'Envoi non confirmé' : (message.progress || 'Envoi en cours…')}${message.failed ? ` <button data-retry="${esc(message.localId)}">Réessayer</button>` : ''}</small>` : messageReactionsMarkup(message, chat)}</div>`;
      if (!message.localPending && message.sendStatus?.status?.startsWith('FAIL')) {
        const status = document.createElement('small'); status.className = 'send-state failed'; status.textContent = message.sendStatus.message || 'Le réseau a signalé un échec de l’envoi.'; node.firstElementChild.append(status);
      }
    }
    const continuation = continuesMessageGroup(previous, message);
    node.classList.toggle('message-continuation', continuation);
    const meta = node.querySelector('.message-meta'); if (meta) meta.hidden = continuation;
    node.setAttribute('aria-label', `${name}, ${dateClock(message.timestamp)}`);
    previous = message;
    if (node !== position) box.insertBefore(node, position);
    position = node.nextElementSibling; count++;
  }
  for (const node of old.values()) node.remove();
  if (!count) {
    const text = chat.loading ? 'Chargement de l’historique…' : chat.loadError ? 'Impossible de charger l’historique.' : !connected && chat.id !== 'demo' ? 'Reconnecte Beeper pour charger cette conversation.' : chat.loaded ? 'Beeper ne fournit aucun message visible pour cette conversation.' : 'Chargement de la conversation…';
    box.innerHTML = `<div class="history-message-state" role="status"><p>${esc(text)}</p>${chat.loadError ? `<small>${esc(chat.loadError)}</small><button data-retry-history>Réessayer</button>` : chat.loaded && /matrix/i.test(chat.network || '') ? '<small>Ce salon appartient au compte Beeper / Matrix. Un historique vide ici signifie que l’API n’en a renvoyé aucun.</small>' : ''}</div>`;
  } else if (chat.loadError) {
    const warning = document.createElement('div'); warning.className = 'history-message-state warning'; warning.innerHTML = `<p>${esc(chat.loadError)}</p><button data-retry-history>Réessayer</button>`; box.append(warning);
  }
  box.dataset.follow = String(forceBottom || nearBottom);
  if (forceBottom || nearBottom) scrollToLatest(box);
  scheduleRead();
}
function readTargets(chat) {
  const latest = new Map();
  for (const message of chat.messages) {
    if (!message.isHidden && message.id && !message.localPending) latest.set(message.chatID || chat.id, message.id);
  }
  return [...latest].sort(([a], [b]) => a.localeCompare(b));
}
const unreadSnapshot = chat => JSON.stringify([chat.unread, chat.markedUnread, chat.preview?.id, chat.preview?.timestamp, chat.lastActivity]);
function scheduleRead() { clearTimeout(readTimer); readTimer = setTimeout(markVisibleRead, 250); }
async function markVisibleRead() {
  const chat = current(), box = $('#messages');
  if (!connected || !chat?.loaded || chat.loading || chat.loadError || chat.readPending || Date.now() < (chat.readRetryAt || 0)
    || document.hidden || !document.hasFocus() || !$('#settings-modal').hidden || !$('#contacts-modal').hidden || $('#media-viewer').open
    || box.scrollHeight - box.scrollTop - box.clientHeight > 4) return;
  const targets = readTargets(chat), key = JSON.stringify(targets), snapshot = unreadSnapshot(chat);
  if (!targets.length || (chat.readConfirmedKey === key && !chat.unread && !chat.markedUnread)) return;
  chat.readPending = true;
  try {
    // Merged conversations use each source's own message ID, never an ID from another network.
    const results = await Promise.allSettled(targets.map(([id, messageID]) => beeper(`/chats/${encodeURIComponent(id)}/read`, { method: 'POST', body: JSON.stringify({ messageID }) })));
    const failed = results.find(result => result.status === 'rejected'); if (failed) throw failed.reason;
    if (!connected || !chats.includes(chat)) return;
    chat.readConfirmedKey = key; chat.readRetryAt = 0; chat.readError = false;
    // An arrival during the request must retain its unread indicator until it too is displayed.
    if (JSON.stringify(readTargets(chat)) === key && unreadSnapshot(chat) === snapshot) {
      chat.unread = results.reduce((count, result) => count + (result.value.unreadCount || 0), 0);
      chat.markedUnread = results.some(result => result.value.isMarkedUnread);
      renderContacts();
    }
  } catch (error) {
    chat.readRetryAt = Date.now() + 10_000;
    if (!chat.readError) toast('Lecture non synchronisée avec Beeper : ' + error.message);
    chat.readError = true;
  } finally { chat.readPending = false; }
}
function selectChat(id) {
  if (recording) cancelRecording();
  closeEmojis();
  if (current()) current().draft = $('#message-input').value;
  activeId = id; const chat = current(); if (!chat) return;
  $('#message-input').value = chat.draft || ''; $('#messages').replaceChildren(); renderHeader(); renderMessages(true); renderContacts(); renderAttachmentDraft();
  $('#contacts-modal').hidden = true;
  if (connected) syncMessages(chat, { forceBottom: true });
}
async function loadChats(older = false) {
  if (listBusy) return; listBusy = true;
  $('#sidebar-more').disabled = true; $('#roster-more').disabled = true;
  try {
    if (!accountsLoaded) { accounts = await beeper('/accounts'); accountsLoaded = true; }
    const query = new URLSearchParams({ limit: '100' }); if (older && chatsCursor) { query.set('cursor', chatsCursor); query.set('direction', 'before'); }
    const result = await beeper('/chats?' + query);
    const previous = new Map(chats.filter(chat => chat.id !== 'demo').map(chat => [chat.id, chat]));
    const incoming = (result.items || []).filter(chat => !chat.mergedIntoChatID).map(chat => normalize(chat, previous.get(chat.id)));
    if (older) chats = [...previous.values(), ...incoming.filter(chat => !previous.has(chat.id))];
    else {
      const ids = new Set(incoming.map(chat => chat.id));
      chats = [...incoming, ...[...previous.values()].filter(chat => !ids.has(chat.id))];
    }
    if (older || !chatsCursor) chatsCursor = result.hasMore ? result.oldestCursor : null;
    if (!chats.length) { $('#contact-picker').innerHTML = ''; $('#messages').textContent = 'Aucune conversation disponible dans Beeper.'; $('#message-input').disabled = true; $('#send-btn').disabled = true; renderHistory(); connectionLabel('Beeper connecté · aucune conversation'); return; }
    const changed = !chats.some(chat => chat.id === activeId);
    if (changed) activeId = chats[0].id;
    renderContacts(); renderHeader();
    if (changed) { $('#message-input').value = current().draft; await syncMessages(current(), { forceBottom: true }); }
    if (!current()?.loadError) connectionLabel('Beeper connecté · messages synchronisés');
  } finally { listBusy = false; $('#sidebar-more').disabled = false; $('#roster-more').disabled = false; }
}
async function syncMessages(chat, { older = false, forceBottom = false } = {}) {
  if (!connected || !chat || chat.loading) return;
  chat.loading = true; chat.loadError = null;
  if (activeId === chat.id && !chat.messages.length) renderMessages();
  try {
    chat.sourcePages ||= new Map();
    const sourceIDs = chat.sourceChatIDs?.length ? chat.sourceChatIDs : [chat.id];
    const sources = older ? sourceIDs.filter(id => chat.sourcePages.get(id)?.hasMore) : sourceIDs;
    if (!sources.length) return;
    const results = await Promise.allSettled(sources.map(async id => {
      const query = new URLSearchParams(), page = chat.sourcePages.get(id);
      if (older && page?.oldestCursor) { query.set('cursor', page.oldestCursor); query.set('direction', 'before'); }
      const result = await beeper(`/chats/${encodeURIComponent(id)}/messages?${query}`);
      if (older || !page) chat.sourcePages.set(id, { oldestCursor: result.oldestCursor, hasMore: !!result.hasMore });
      return (result.items || []).map(message => ({ ...message, chatID: message.chatID || id, sourceKey: `${encodeURIComponent(message.chatID || id)}:${message.id}` }));
    }));
    const failures = results.filter(result => result.status === 'rejected');
    if (failures.length === results.length) throw failures[0].reason;
    chat.loaded = true;
    if (failures.length) chat.loadError = 'Une partie de l’historique est indisponible : ' + failures[0].reason.message;
    const before = seen.get(chat.id);
    const incoming = results.filter(result => result.status === 'fulfilled').flatMap(result => result.value);
    const records = new Map(chat.messages.map(message => [message.sourceKey || `${encodeURIComponent(message.chatID || chat.id)}:${message.id}`, message]));
    for (const message of incoming) records.set(message.sourceKey, message);
    chat.messages = [...records.values()].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp) || String(a.sortKey || '').localeCompare(String(b.sortKey || '')));
    const unpaired = [...incoming];
    chat.pending = chat.pending.filter(pending => {
      const index = unpaired.findIndex(message => (message.id === pending.id && (!pending.sentChatID || pending.sentChatID === message.chatID)) || (message.isSender && (pending.attachments?.length ? message.attachments?.some(file => file.fileName === pending.attachments[0].fileName && file.fileSize === pending.attachments[0].fileSize) : !!pending.text && plain(message.text) === pending.text) && new Date(message.timestamp) - new Date(pending.timestamp) >= -5000 && new Date(message.timestamp) - new Date(pending.timestamp) < 90_000));
      if (index < 0) return true;
      unpaired.splice(index, 1); return false;
    });
    chat.hasMore = sourceIDs.some(id => chat.sourcePages.get(id)?.hasMore);
    if (!older) {
      const newIncoming = before ? incoming.filter(message => !before.has(message.sourceKey) && !message.isSender && !message.isHidden) : [];
      if (newIncoming.some(isWizzMessage)) triggerWizz();
      else if (newIncoming.length) chime();
      seen.set(chat.id, new Set([...(before || []), ...incoming.map(message => message.sourceKey)]));
    }
    if (activeId === chat.id) {
      const box = $('#messages'), oldHeight = box.scrollHeight, oldTop = box.scrollTop;
      renderMessages(forceBottom); $('#history-more').hidden = !chat.hasMore;
      if (older) box.scrollTop = box.scrollHeight - oldHeight + oldTop;
    }
    renderHistory();
    if (activeId === chat.id) connectionLabel(chat.loadError || 'Beeper connecté · messages synchronisés', !!chat.loadError);
  } catch (error) { chat.loadError = error.message; if (activeId === chat.id) connectionLabel(error.message, true); if (error.status === 401) { connected = false; cancelRecording(); renderHeader(); openSettings(); } }
  finally { chat.loading = false; if (activeId === chat.id) renderMessages(forceBottom); }
}
async function sendMessage(existing, forcedText) {
  const chat = current(); if (!chat || chat.readOnly || sending || recording) return;
  if (!connected && chat.id !== 'demo') { openSettings(); toast('Reconnecte Beeper pour envoyer ce message.'); return false; }
  const text = existing ? existing.text : forcedText ?? $('#message-input').value.trim(), file = existing?.file || (!existing && forcedText === undefined && chat.file);
  if (!text && !file && !existing?.uploadID) return false;
  sending = true; $('#send-btn').disabled = true;
  const replyTarget = forcedText === undefined ? chat.replyDraft : null;
  const pending = existing || { localId: crypto.randomUUID(), text, isSender: true, timestamp: new Date().toISOString(), localPending: true, file,
    ...(replyTarget ? { id: crypto.randomUUID(), replyToMessageID: replyTarget.messageID, replyChatID: replyTarget.chatID, linkedMessageID: replyTarget.messageID, chatID: replyTarget.chatID, senderName: 'Moi', replyPreview: replyTarget.text } : {}),
    ...(file ? { attachments: [{ type: file.type.startsWith('image/') ? 'img' : file.type.startsWith('video/') ? 'video' : file.type.startsWith('audio/') ? 'audio' : 'unknown', mimeType: file.type, fileName: file.name, fileSize: file.size }] } : {}) };
  pending.failed = false;
  if (!existing) {
    chat.pending.push(pending); if (forcedText === undefined) chat.replyDraft = null;
    if (forcedText === undefined) { chat.draft = ''; chat.file = null; $('#message-input').value = ''; renderAttachmentDraft(); }
    else chat.draft = $('#message-input').value;
    renderReplyDraft();
  }
  renderMessages(true);
  renderHistory();
  let sent = false;
  try {
    if (connected) {
      if (pending.file && !pending.uploadID) {
        const upload = await uploadFile(pending.file, progress => { pending.progress = progress; if (activeId === chat.id) renderMessages(); });
        pending.uploadID = upload.uploadID; pending.file = null;
      }
      pending.progress = 'Transmission à Beeper…';
      const result = await beeper(`/chats/${encodeURIComponent(pending.replyChatID || chat.id)}/messages`, { method: 'POST', body: JSON.stringify({ text, ...(pending.replyToMessageID ? { replyToMessageID: pending.replyToMessageID } : {}), ...(pending.uploadID ? { attachment: { uploadID: pending.uploadID } } : {}) }) });
      pending.id = result.pendingMessageID;
      pending.sentChatID = result.chatID;
      sent = true;
      await syncMessages(chat);
    } else { chat.messages.push({ ...pending, id: pending.localId, localPending: false }); chat.pending = chat.pending.filter(item => item !== pending); sent = true; }
  } catch (error) { pending.failed = true; toast(error.message); }
  finally { sending = false; renderHeader(); renderHistory(); if (activeId === chat.id) renderMessages(true); }
  return sent;
}
function uploadFile(file, progress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest(), form = new FormData(); form.append('file', file, file.name);
    xhr.open('POST', '/api/upload'); xhr.timeout = 120_000;
    xhr.upload.onprogress = event => progress(event.lengthComputable ? `Préparation du fichier… ${Math.round(event.loaded / event.total * 100)} %` : 'Préparation du fichier…');
    xhr.onload = () => { let data; try { data = JSON.parse(xhr.responseText); } catch { reject(new Error('Réponse de Beeper illisible.')); return; } if (xhr.status >= 200 && xhr.status < 300) resolve(data); else reject(new Error(data.error || 'Préparation du fichier impossible.')); };
    xhr.onerror = () => reject(new Error('Connexion interrompue pendant le chargement du fichier.'));
    xhr.ontimeout = () => reject(new Error('Le chargement du fichier a pris trop de temps.'));
    xhr.send(form);
  });
}
function renderAttachmentDraft() {
  const file = current()?.file; $('#attachment-draft').hidden = !file;
  $('#attachment-name').textContent = file ? `${file.name} · ${(file.size / 1_000_000).toFixed(1)} Mo` : '';
  const audio = $('#draft-audio'); audio.pause(); audio.removeAttribute('src'); audio.hidden = true;
  if (draftAudioURL) { URL.revokeObjectURL(draftAudioURL); draftAudioURL = null; }
  if (file?.voiceNote) { draftAudioURL = URL.createObjectURL(file); audio.src = draftAudioURL; audio.hidden = false; }
  const image = $('#draft-image'); image.hidden = true; image.removeAttribute('src');
  if (draftImageURL) { URL.revokeObjectURL(draftImageURL); draftImageURL = null; }
  if (file?.type.startsWith('image/')) { draftImageURL = URL.createObjectURL(file); image.src = draftImageURL; image.hidden = false; }
  renderHistory();
}
function closeEmojis() { $('#emoji-picker').hidden = true; $('#emoji-btn').setAttribute('aria-expanded', 'false'); }
const emojiGroups = [
  ['Visages', '😀|😃|😄|😁|😆|😅|🤣|😂|🙂|🙃|🫠|😉|😊|😇|🥰|😍|🤩|😘|😗|☺️|😚|😙|🥲|😋|😛|😜|🤪|😝|🤑|🤗|🤭|🫢|🫣|🤫|🤔|🫡|🤐|🤨|😐|😑|😶|🫥|😶‍🌫️|😏|😒|🙄|😬|😮‍💨|🤥|🫨|🙂‍↔️|🙂‍↕️|😌|😔|😪|🤤|😴|😷|🤒|🤕|🤢|🤮|🤧|🥵|🥶|🥴|😵|😵‍💫|🤯|🥳|🥸|😎|🤓|🧐|😕|🫤|😟|🙁|☹️|😮|😯|😲|😳|🥺|🥹|😦|😧|😨|😰|😥|😢|😭|😱|😖|😣|😞|😓|😩|😫|🥱|😤|😡|😠|🤬|😈|👿|💀|☠️|💩|🤡|👻|👽|👾|🤖'],
  ['Gestes', '👋|🤚|🖐️|✋|🖖|🫱|🫲|🫳|🫴|🫷|🫸|👌|🤌|🤏|✌️|🤞|🫰|🤟|🤘|🤙|👈|👉|👆|👇|☝️|🫵|👍|👎|✊|👊|🤛|🤜|👏|🙌|🫶|👐|🤲|🤝|🙏|✍️|💅|💪|🦾|🦿|🦵|🦶|👂|🦻|👃|🧠|🫀|🫁|🦷|🦴|👀|👁️|👅|👄|💋'],
  ['Personnes', '👶|🧒|👦|👧|🧑|👨|👩|🧓|👴|👵|🙍|🙎|🙅|🙆|💁|🙋|🧏|🙇|🤦|🤷|🧑‍⚕️|🧑‍🎓|🧑‍🏫|🧑‍⚖️|🧑‍🌾|🧑‍🍳|🧑‍🔧|🧑‍💼|🧑‍🔬|🧑‍🎤|🧑‍🎨|🧑‍🚀|🧑‍🚒|👮|🕵️|💂|🥷|👷|🤴|👸|👳|👲|🧕|🤵|👰|🤰|🫃|🫄|🤱|👼|🎅|🤶|🧑‍🎄|🦸|🦹|🧙|🧚|🧛|🧜|🧝|🧞|🧟|💃|🕺|🕴️|👯|🧖|🧗|🏃|🚶|🧎|🧘|🛀|🛌'],
  ['Animaux', '🐶|🐱|🐭|🐹|🐰|🦊|🐻|🐼|🐻‍❄️|🐨|🐯|🦁|🐮|🐷|🐸|🐵|🙈|🙉|🙊|🐒|🐔|🐧|🐦|🐤|🐣|🐥|🦆|🦅|🦉|🦇|🐺|🐗|🐴|🦄|🐝|🪱|🐛|🦋|🐌|🐞|🐜|🪰|🪲|🪳|🦟|🦗|🕷️|🦂|🐢|🐍|🦎|🦖|🦕|🐙|🦑|🦐|🦞|🦀|🐡|🐠|🐟|🐬|🐳|🐋|🦈|🦭|🐊|🐅|🐆|🦓|🦍|🦧|🦣|🐘|🦛|🦏|🐪|🐫|🦒|🦘|🦬|🐃|🐂|🐄|🐎|🐖|🐏|🐑|🦙|🐐|🦌|🐕|🐩|🦮|🐈|🐓|🦃|🦤|🦚|🦜|🦢|🪿|🦩|🕊️|🐇|🦝|🦨|🦡|🦫|🦦|🦥|🐁|🐀|🐿️|🦔|🐾'],
  ['Nature', '🌵|🎄|🌲|🌳|🌴|🪵|🌱|🌿|☘️|🍀|🎍|🪴|🎋|🍃|🍂|🍁|🪺|🪹|🍄|🐚|🪨|🌾|💐|🌷|🪷|🌹|🥀|🌺|🌸|🌼|🌻|🌞|🌝|🌛|🌜|🌚|🌕|🌖|🌗|🌘|🌑|🌒|🌓|🌔|🌙|🌎|🌍|🌏|🪐|💫|⭐|🌟|✨|⚡|☄️|💥|🔥|🌪️|🌈|☀️|🌤️|⛅|🌥️|☁️|🌦️|🌧️|⛈️|🌩️|🌨️|❄️|☃️|⛄|🌬️|💨|💧|💦|☔|☂️|🌊'],
  ['Nourriture', '🍏|🍎|🍐|🍊|🍋|🍌|🍉|🍇|🍓|🫐|🍈|🍒|🍑|🥭|🍍|🥥|🥝|🍅|🍆|🥑|🥦|🥬|🥒|🌶️|🫑|🌽|🥕|🫒|🧄|🧅|🥔|🍠|🫚|🥐|🥯|🍞|🥖|🥨|🧀|🥚|🍳|🧈|🥞|🧇|🥓|🥩|🍗|🍖|🌭|🍔|🍟|🍕|🫓|🥪|🥙|🧆|🌮|🌯|🫔|🥗|🥘|🫕|🥫|🍝|🍜|🍲|🍛|🍣|🍱|🥟|🦪|🍤|🍙|🍚|🍘|🍥|🥠|🥮|🍢|🍡|🍧|🍨|🍦|🥧|🧁|🍰|🎂|🍮|🍭|🍬|🍫|🍿|🍩|🍪|🌰|🥜|🫘|🍯|🥛|🍼|☕|🫖|🍵|🧃|🥤|🧋|🍶|🍺|🍻|🥂|🍷|🥃|🍸|🍹|🧉|🍾'],
  ['Activités', '⚽|🏀|🏈|⚾|🥎|🎾|🏐|🏉|🥏|🎱|🪀|🏓|🏸|🏒|🏑|🥍|🏏|🪃|🥅|⛳|🪁|🛝|🏹|🎣|🤿|🥊|🥋|🎽|🛹|🛼|🛷|⛸️|🥌|🎿|⛷️|🏂|🪂|🏋️|🤼|🤸|⛹️|🤺|🤾|🏌️|🏇|🧘|🏄|🏊|🤽|🚣|🧗|🚴|🚵|🎪|🎭|🩰|🎨|🎬|🎤|🎧|🎼|🎹|🥁|🪘|🎷|🎺|🪗|🎸|🪕|🎻|🪇|🎮|🕹️|🎲|♟️|🎯|🎳|🎰|🧩'],
  ['Voyages', '🚗|🚕|🚙|🚌|🚎|🏎️|🚓|🚑|🚒|🚐|🛻|🚚|🚛|🚜|🛵|🏍️|🛺|🚲|🛴|🛹|🛼|🚏|🛣️|🛤️|🛢️|⛽|🛞|🚨|🚥|🚦|🛑|🚧|⚓|🛟|⛵|🛶|🚤|🛳️|⛴️|🛥️|🚢|✈️|🛩️|🛫|🛬|🪂|💺|🚁|🚟|🚠|🚡|🛰️|🚀|🛸|🌍|🗺️|🧭|🏖️|🏝️|🏕️|⛺|🏠|🏡|🏢|🏰|🗼|🗽|⛲|🎡|🎢|🎠|🌃|🌆|🌇|🌉|🌌'],
  ['Objets', '⌚|📱|📲|💻|⌨️|🖥️|🖨️|🖱️|🖲️|🕹️|💽|💾|💿|📀|📼|📷|📸|📹|🎥|📽️|🎞️|📞|☎️|📟|📠|📺|📻|🎙️|🎚️|🎛️|🧭|⏱️|⏰|⌛|⏳|🔋|🪫|🔌|💡|🔦|🕯️|🪔|🧯|🛢️|💸|💵|💴|💶|💷|🪙|💰|💳|🧾|💎|⚖️|🪜|🧰|🪛|🔧|🔨|⚒️|🛠️|⛏️|🪚|🔩|⚙️|🪤|🧱|⛓️|🧲|🔫|💣|🧨|🪓|🔪|🗡️|🛡️|🚬|⚰️|🪦|⚱️|🏺|🔮|📿|🧿|💈|⚗️|🔭|🔬|🕳️|🩹|🩺|💊|💉|🩸|🧬|🦠|🧫|🧪|🌡️|🧹|🪠|🧺|🧻|🪣|🧼|🫧|🪥|🧽|🧴|🛎️|🔑|🗝️|🚪|🪑|🛋️|🛏️|🛌|🧸|🪆|🖼️|🪞|🪟|🛍️|🛒|🎁|🎈|🎀|🪄|🪅|🎊|🎉|🎎|🏮|🎐|🧧'],
  ['Symboles', '❤️|🧡|💛|💚|💙|🩵|💜|🖤|🩶|🤍|🤎|💔|❤️‍🔥|❤️‍🩹|❣️|💕|💞|💓|💗|💖|💘|💝|💟|☮️|✝️|☪️|🕉️|☸️|✡️|🔯|🕎|☯️|☦️|🛐|⛎|♈|♉|♊|♋|♌|♍|♎|♏|♐|♑|♒|♓|🆔|⚛️|🉑|☢️|☣️|📴|📳|🈶|🈚|🈸|🈺|🈷️|✴️|🆚|💮|🉐|㊙️|㊗️|🈴|🈵|🈹|🈲|🅰️|🅱️|🆎|🆑|🅾️|🆘|❌|⭕|🛑|⛔|📛|🚫|💯|💢|♨️|🚷|🚯|🚳|🚱|🔞|📵|🚭|❗|❕|❓|❔|‼️|⁉️|🔅|🔆|〽️|⚠️|🚸|🔱|⚜️|🔰|♻️|✅|🈯|💹|❇️|✳️|❎|🌐|💠|Ⓜ️|🌀|💤|🏧|🚾|♿|🅿️|🛗|🈳|🈂️|🛂|🛃|🛄|🛅|🚹|🚺|🚻|🚼|🚰|🚮|🎦|📶|🈁|🔣|ℹ️|🔤|🔡|🔠|🆖|🆗|🆙|🆒|🆕|🆓|🔟|🔢|▶️|⏸️|⏯️|⏹️|⏺️|⏭️|⏮️|⏩|⏪|🔀|🔁|🔂|🔼|🔽|⏫|⏬|➡️|⬅️|⬆️|⬇️|↗️|↘️|↙️|↖️|↕️|↔️|🔄|🔃|🔚|🔙|🔛|🔝|🔜|➕|➖|➗|✖️|♾️|💲|💱|™️|©️|®️|〰️|➰|➿|🔴|🟠|🟡|🟢|🔵|🟣|⚫|⚪|🟤|🔺|🔻|🔸|🔹|🔶|🔷|🔳|🔲|▪️|▫️|◾|◽|◼️|◻️|⬛|⬜|🟥|🟧|🟨|🟩|🟦|🟪|🟫|🔈|🔉|🔊|🔔|🔕|📣|📢|💬|💭|🗯️|♠️|♥️|♦️|♣️|🃏|🀄|🎴'],
];
const emojiGrid = () => $('#emoji-picker .emoji-grid');
function showEmojiGroup(name = 'Tout') {
  const values = name === 'Tout' ? emojiGroups.flatMap(([, values]) => values.split('|')) : (emojiGroups.find(([group]) => group === name)?.[1] || '').split('|');
  emojiGrid().innerHTML = values.filter(Boolean).map(emoji => `<button type="button" data-emoji="${esc(emoji)}" title="${esc(emoji)}" aria-label="${esc(emoji)}"><img class="emoji-art" src="${emojiImageURL(emoji)}" alt="${esc(emoji)}" referrerpolicy="no-referrer" loading="lazy" draggable="false" /></button>`).join('');
}
$('#emoji-picker').innerHTML = `<div class="emoji-categories"><button type="button" data-emoji-category="Tout" class="active">Tout</button>${emojiGroups.map(([group]) => `<button type="button" data-emoji-category="${esc(group)}" title="${esc(group)}">${esc(group)}</button>`).join('')}</div><div class="emoji-grid"></div>`;
showEmojiGroup();
$('#emoji-picker').addEventListener('error', fallbackEmojiImage, true);
function closeFormatting() { $('#format-menu').hidden = true; $('#format-btn').setAttribute('aria-expanded', 'false'); }
function applyMarkdownFormat(kind) {
  const input = $('#message-input'); if (input.disabled || !current()) return;
  const start = input.selectionStart, end = input.selectionEnd, selected = input.value.slice(start, end) || 'texte';
  let replacement = '', innerStart = 0;
  if (kind === 'quote') {
    replacement = selected.split('\n').map(line => `> ${line}`).join('\n'); innerStart = replacement.length;
  } else {
    const markers = { bold: '**', italic: '*', strike: '~~', code: '`' }[kind];
    if (!markers) return;
    replacement = `${markers}${selected}${markers}`; innerStart = markers.length;
  }
  input.setRangeText(replacement, start, end, 'select');
  input.setSelectionRange(start + innerStart, start + innerStart + (kind === 'quote' ? 0 : selected.length));
  current().draft = input.value; renderHistory(); closeFormatting(); input.focus();
}
$('#format-btn').addEventListener('click', () => {
  const show = $('#format-menu').hidden; closeEmojis(); $('#format-menu').hidden = !show;
  $('#format-btn').setAttribute('aria-expanded', String(show)); if (show) $('#format-menu button').focus();
});
$('#format-menu').addEventListener('click', event => {
  const button = event.target.closest('[data-format]'); if (button) applyMarkdownFormat(button.dataset.format);
});
$('#emoji-btn').addEventListener('click', () => { const show = $('#emoji-picker').hidden; closeFormatting(); $('#emoji-picker').hidden = !show; $('#emoji-btn').setAttribute('aria-expanded', String(show)); if (show) $('#emoji-picker button').focus(); });
$('#emoji-picker').addEventListener('click', event => {
  const category = event.target.closest('[data-emoji-category]');
  if (category) { $('#emoji-picker').querySelectorAll('[data-emoji-category]').forEach(button => button.classList.toggle('active', button === category)); showEmojiGroup(category.dataset.emojiCategory); return; }
  const button = event.target.closest('[data-emoji]'), input = $('#message-input'); if (!button || input.disabled || !current()) return;
  input.setRangeText(button.dataset.emoji, input.selectionStart, input.selectionEnd, 'end'); current().draft = input.value; renderHistory(); closeEmojis(); input.focus();
});
document.addEventListener('click', event => { if (!event.target.closest('.compose-tools')) { closeEmojis(); closeFormatting(); } });

function renderRecording() {
  const active = !!recording; $('#recording-status').hidden = !active;
  $('#voice-clip-btn').classList.toggle('is-recording', active);
  $('#voice-clip-btn').setAttribute('aria-pressed', String(active));
  $('#voice-clip-btn').title = active ? 'Arrêter l’enregistrement' : 'Enregistrer un vocal';
  $('#voice-clip-btn').setAttribute('aria-label', $('#voice-clip-btn').title);
  if (active) {
    const seconds = recording.started ? Math.floor((Date.now() - recording.started) / 1000) : 0;
    $('#recording-time').textContent = recording.started ? `Enregistrement ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')} — clique sur le micro pour arrêter` : 'Autorise l’accès au microphone dans le navigateur…';
  }
  renderHeader();
}
function releaseRecording(value) {
  clearInterval(value.timer); clearTimeout(value.limit);
  value.stream?.getTracks().forEach(track => track.stop());
}
function cancelRecording() {
  if (!recording) return;
  const value = recording; value.cancelled = true; recording = null; recordingSequence++;
  if (value.recorder?.state === 'recording') value.recorder.stop();
  releaseRecording(value); renderRecording();
}
async function startRecording() {
  if (!connected || !current() || current().readOnly || sending) return;
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { toast('L’enregistrement audio n’est pas disponible dans ce navigateur.'); return; }
  closeEmojis();
  $('#draft-audio').pause();
  const value = { chatId: activeId, sequence: ++recordingSequence, chunks: [], cancelled: false }; recording = value; renderRecording();
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    if (value.cancelled || recording !== value || activeId !== value.chatId || value.sequence !== recordingSequence) { stream.getTracks().forEach(track => track.stop()); return; }
    value.stream = stream;
    const mimeType = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4'].find(type => MediaRecorder.isTypeSupported(type));
    value.recorder = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 64_000 });
    value.recorder.ondataavailable = event => { if (event.data.size) value.chunks.push(event.data); };
    value.recorder.onerror = () => { if (recording === value) cancelRecording(); toast('L’enregistrement a été interrompu. Réessaie.'); };
    value.recorder.onstop = () => {
      releaseRecording(value); if (recording === value) recording = null;
      renderRecording();
      if (value.cancelled || activeId !== value.chatId || !connected) return;
      const type = value.recorder.mimeType || 'audio/webm', blob = new Blob(value.chunks, { type });
      if (!blob.size) { toast('Aucun son enregistré. Réessaie.'); return; }
      const extension = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
      const file = new File([blob], `Vocal-${new Date().toISOString().replace(/[:.]/g, '-')}.${extension}`, { type });
      file.voiceNote = true; current().file = file; renderAttachmentDraft();
      toast('Vocal prêt : écoute-le puis clique sur Envoyer.');
    };
    value.recorder.start(250); value.started = Date.now();
    value.timer = setInterval(renderRecording, 250);
    value.limit = setTimeout(() => { if (recording === value && value.recorder.state === 'recording') { value.recorder.stop(); toast('Limite de 5 minutes atteinte. Ton vocal est prêt.'); } }, 5 * 60_000);
    renderRecording();
  } catch (error) {
    const cancelled = value.cancelled; releaseRecording(value); if (recording === value) recording = null; renderRecording();
    if (!cancelled) toast(error.name === 'NotAllowedError' ? 'Microphone refusé : autorise-le dans les réglages du navigateur.' : error.name === 'NotFoundError' ? 'Aucun microphone disponible.' : 'Impossible de démarrer le microphone.');
  }
}
$('#voice-clip-btn').addEventListener('click', () => { if (!recording) startRecording(); else if (recording.recorder?.state === 'recording') recording.recorder.stop(); else if (!recording.recorder) cancelRecording(); });
$('#cancel-recording').addEventListener('click', cancelRecording);
window.addEventListener('pagehide', cancelRecording);
$('#file-input').addEventListener('change', event => {
  const file = event.target.files[0]; event.target.value = ''; attachDraft(file);
});
function attachDraft(file) {
  const chat = current(); if (!file || !chat || chat.readOnly || sending || recording) return;
  if (!connected) { toast('Connecte Beeper pour joindre une image ou un fichier.'); return; }
  if (file.size > 100 * 1024 * 1024) { toast('Choisis un fichier de 100 Mo maximum.'); return; }
  chat.file = file; renderAttachmentDraft();
}
$('#message-input').addEventListener('paste', event => {
  const input = event.currentTarget, clipboard = event.clipboardData;
  if (!clipboard || input.disabled || !current()) return;
  const image = [...clipboard.items].find(item => item.kind === 'file' && item.type.startsWith('image/'))?.getAsFile()
    || [...clipboard.files].find(file => file.type.startsWith('image/'));
  if (image) {
    event.preventDefault();
    const extension = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' }[image.type] || 'img';
    attachDraft(image.name ? image : new File([image], `Image-${Date.now()}.${extension}`, { type: image.type }));
    return;
  }
  // Text and links use the textarea's native paste: selection, newlines and undo stay intact.
});
$('#remove-attachment').addEventListener('click', () => { if (current()) current().file = null; renderAttachmentDraft(); });
$('#attach-btn').addEventListener('click', () => { $('#file-input').accept = ''; $('#file-input').click(); });
let giphyApiKey = null, giphyKeyRequest = null, giphySearchSequence = 0;
async function loadGiphyKey() {
  if (giphyApiKey) return giphyApiKey;
  giphyKeyRequest ||= fetch('/api/giphy-key', { cache: 'no-store' }).then(async response => {
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Impossible de lire la configuration GIPHY.');
    if (!data.enabled || !data.apiKey) throw new Error('Ajoute GIPHY_API_KEY dans .env puis redémarre MSN Revival.');
    giphyApiKey = data.apiKey; return giphyApiKey;
  }).finally(() => { giphyKeyRequest = null; });
  return giphyKeyRequest;
}
async function loadGiphy(query = '') {
  const sequence = ++giphySearchSequence, status = $('#giphy-status'), results = $('#giphy-results');
  status.textContent = query ? 'Recherche GIPHY…' : 'Chargement des tendances GIPHY…'; results.replaceChildren();
  try {
    const key = await loadGiphyKey();
    const endpoint = query ? 'search' : 'trending';
    const params = new URLSearchParams({ api_key: key, limit: '24', rating: 'g', lang: 'fr', bundle: 'messaging_non_clips' });
    if (query) params.set('q', query);
    const response = await fetch(`https://api.giphy.com/v1/gifs/${endpoint}?${params}`);
    const payload = await response.json();
    if (!response.ok || payload.meta?.status >= 400) throw new Error(payload.meta?.msg || 'Recherche GIPHY impossible.');
    if (sequence !== giphySearchSequence) return;
    const cards = (payload.data || []).map(gif => {
      const original = gif.images?.original?.url;
      const preview = gif.images?.fixed_width_small?.url || gif.images?.fixed_width?.url || original;
      if (!original || !preview) return '';
      return `<button class="giphy-result" type="button" data-giphy-url="${esc(original)}" data-giphy-id="${esc(gif.id)}" title="${esc(gif.title || 'GIF GIPHY')}"><img src="${esc(preview)}" alt="${esc(gif.title || 'GIF animé')}" referrerpolicy="no-referrer" loading="lazy" /><span>Joindre</span></button>`;
    }).filter(Boolean);
    results.innerHTML = cards.join('');
    status.textContent = cards.length ? '' : 'Aucun GIF trouvé.';
  } catch (error) {
    if (sequence === giphySearchSequence) status.textContent = error.message || 'Impossible de contacter GIPHY.';
  }
}
$('#gif-btn').addEventListener('click', () => { $('#giphy-modal').hidden = false; $('#giphy-search-input').focus(); loadGiphy(); });
$('#giphy-close').addEventListener('click', () => { $('#giphy-modal').hidden = true; });
$('#giphy-modal').addEventListener('click', event => { if (event.target === $('#giphy-modal')) $('#giphy-modal').hidden = true; });
$('#giphy-search-form').addEventListener('submit', event => { event.preventDefault(); loadGiphy($('#giphy-search-input').value.trim()); });
$('#giphy-trending').addEventListener('click', () => { $('#giphy-search-input').value = ''; loadGiphy(); });
$('#giphy-results').addEventListener('click', async event => {
  const result = event.target.closest('[data-giphy-url]'), chat = current();
  if (!result) return;
  if (!connected || !chat || chat.readOnly || sending) { toast(!connected ? 'Connecte Beeper pour joindre ce GIF.' : 'Cette conversation ne peut pas recevoir de pièce jointe.'); return; }
  result.disabled = true; $('#giphy-results').inert = true; $('#giphy-status').textContent = 'Préparation du GIF…';
  try {
    const response = await fetch('/api/giphy-media?url=' + encodeURIComponent(result.dataset.giphyUrl));
    if (!response.ok) { const data = await response.json(); throw new Error(data.error || 'Téléchargement du GIF impossible.'); }
    const blob = await response.blob();
    attachDraft(new File([blob], `GIPHY-${result.dataset.giphyId || Date.now()}.gif`, { type: 'image/gif' }));
    $('#giphy-modal').hidden = true;
  } catch (error) { $('#giphy-status').textContent = error.message; result.disabled = false; }
  finally { $('#giphy-results').inert = false; }
});
function openSettings() { $('#settings-error').hidden = true; $('#settings-modal').hidden = false; $('#disconnect-button').hidden = !connected; }
function settingsError(error) { $('#settings-error').textContent = error.message; $('#settings-error').hidden = false; }
async function oauth() {
  if (authorization) return;
  const button = $('#authorize-button'); button.disabled = true;
  const popup = window.open('about:blank', 'msn-beeper-authorization', 'popup,width=780,height=720');
  try {
    if (location.protocol === 'file:') throw new Error('Lance Lancer-MSN.cmd puis ouvre http://127.0.0.1:4173 pour connecter Beeper.');
    const result = await request('/api/auth/start', { method: 'POST', body: JSON.stringify({ base: $('#api-url').value.trim() }) });
    if (!popup) { location.assign(result.url); return; }
    popup.location.replace(result.url);
    authorization = { popup, id: result.authorizationID, started: Date.now(), busy: false };
    authorization.timer = setInterval(checkAuthorization, 1000);
    connectionLabel('Valide la connexion dans la fenêtre Beeper…');
  } catch (error) { popup?.close(); settingsError(error); button.disabled = false; }
}
function finishAuthorization() {
  if (authorization) { clearInterval(authorization.timer); authorization.popup.close(); authorization = null; }
  $('#authorize-button').disabled = false;
}
async function restoreConnection(status, force = false) {
  if (!status.connected || connectionBusy) return false;
  connectionBusy = true;
  try {
    if (force) { accountsLoaded = false; accounts = []; }
    connected = true; await loadChats();
    if (!connected) return false;
    $('#settings-modal').hidden = true; return true;
  } finally { connectionBusy = false; }
}
async function checkAuthorization() {
  const pending = authorization; if (!pending || pending.busy) return;
  if (Date.now() - pending.started > 600_000) { finishAuthorization(); settingsError(new Error('La demande de connexion a expiré. Recommence l’autorisation.')); return; }
  pending.busy = true;
  try {
    const status = await request('/api/status');
    if (authorization === pending && status.connected && status.authorizationID === pending.id && await restoreConnection(status, true)) {
      finishAuthorization(); toast('Beeper connecté. La connexion sera conservée aux prochains lancements.');
    } else if (authorization === pending && pending.popup.closed && status.authorizationID !== pending.id) {
      finishAuthorization(); settingsError(new Error('La fenêtre Beeper a été fermée. Tu peux relancer l’autorisation.'));
    }
  } catch (error) { connectionLabel(error.message, true); }
  finally { pending.busy = false; }
}
window.addEventListener('message', event => {
  if (event.origin !== location.origin) return;
  if (event.data?.type === 'msn-beeper-connected') checkAuthorization();
  else if (event.data?.type === 'msn-beeper-error') { finishAuthorization(); openSettings(); settingsError(new Error(event.data.error)); }
});
async function initialize() {
  const params = new URLSearchParams(location.search);
  if (params.has('authError') && window.opener) {
    window.opener.postMessage({ type: 'msn-beeper-error', error: params.get('authError') }, location.origin); window.close(); return;
  }
  if (params.has('connected') && window.opener) {
    window.opener.postMessage({ type: 'msn-beeper-connected' }, location.origin); window.close(); return;
  }
  renderContacts(); renderHeader(); renderMessages(true);
  if (location.protocol === 'file:') { connectionLabel('Démo · lance Lancer-MSN.cmd pour connecter Beeper'); return; }
  try {
    const status = await request('/api/status'); $('#api-url').value = status.base;
    connected = status.connected;
    if (connected) await restoreConnection(status);
    else { connectionLabel(status.available ? 'Beeper détecté · autorisation requise' : 'Beeper inaccessible · mode démonstration'); openSettings(); }
    const error = new URLSearchParams(location.search).get('authError');
    if (error) { openSettings(); settingsError(new Error(error)); }
    else if (status.authError) settingsError(new Error(status.authError));
    history.replaceState(null, '', '/');
  } catch (error) { connectionLabel(error.message, true); }
}
$('#contact-picker').addEventListener('change', event => selectChat(event.target.value));
$('#contact-search').addEventListener('input', renderRoster);
$('#roster-list').addEventListener('click', event => { const button = event.target.closest('[data-id]'); if (button) selectChat(button.dataset.id); });
$('#roster-list').addEventListener('toggle', event => {
  const group = event.target;
  if (!group.matches('details[data-group]') || !group.isConnected || $('#contact-search').value.trim()) return;
  if (group.open) collapsedRosterGroups.delete(group.dataset.group); else collapsedRosterGroups.add(group.dataset.group);
}, true);
$('#roster-more').addEventListener('click', () => loadChats(true).catch(error => toast(error.message)));
$('#sidebar-more').addEventListener('click', () => loadChats(true).catch(error => toast(error.message)));
$('#history-search').addEventListener('input', () => { $('#conversation-list').scrollTop = 0; renderHistory(); });
$('#conversation-list').addEventListener('click', event => { const row = event.target.closest('[data-history-id]'); if (row) { selectChat(row.dataset.historyId); if (matchMedia('(max-width: 760px)').matches) setHistoryVisible(false); } });
function setHistoryTab(unread) {
  historyUnreadOnly = unread;
  for (const [id, selected] of [['history-all', !unread], ['history-unread', unread]]) { $('#' + id).setAttribute('aria-selected', String(selected)); $('#' + id).tabIndex = selected ? 0 : -1; }
  $('#conversation-list').setAttribute('aria-labelledby', unread ? 'history-unread' : 'history-all');
  $('#conversation-list').scrollTop = 0; renderHistory();
}
$('#history-all').addEventListener('click', () => setHistoryTab(false)); $('#history-unread').addEventListener('click', () => setHistoryTab(true));
$('.history-tabs').addEventListener('keydown', event => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault(); const unread = event.key === 'Home' ? false : event.key === 'End' ? true : !historyUnreadOnly; setHistoryTab(unread); $(unread ? '#history-unread' : '#history-all').focus();
});
function setHistoryVisible(visible) {
  $('.legacy-layout').classList.toggle('history-hidden', !visible); $('#history-toggle').setAttribute('aria-expanded', String(visible));
  $('#history-backdrop').hidden = !visible || !matchMedia('(max-width: 760px)').matches;
}
$('#history-toggle').addEventListener('click', () => setHistoryVisible($('.legacy-layout').classList.contains('history-hidden')));
$('#history-collapse').addEventListener('click', () => { setHistoryVisible(false); $('#history-toggle').focus(); });
$('#history-backdrop').addEventListener('click', () => setHistoryVisible(false));
window.addEventListener('resize', () => { $('#history-backdrop').hidden = $('.legacy-layout').classList.contains('history-hidden') || !matchMedia('(max-width: 760px)').matches; });
setHistoryVisible(!matchMedia('(max-width: 760px)').matches);
$('#history-more').addEventListener('click', async event => { event.target.disabled = true; await syncMessages(current(), { older: true }); event.target.disabled = false; });
$('#send-btn').addEventListener('click', () => sendMessage());
$('#cancel-reply').addEventListener('click', () => { if (current()) current().replyDraft = null; renderReplyDraft(); });
$('#messages').addEventListener('click', event => { const button = event.target.closest('[data-retry]'); if (button) sendMessage(current().pending.find(item => item.localId === button.dataset.retry)); });
$('#messages').addEventListener('click', event => { if (event.target.closest('[data-retry-history]')) syncMessages(current(), { forceBottom: true }); });
$('#messages').addEventListener('click', async event => {
  const chat = current(); if (!chat) return;
  const reply = event.target.closest('[data-reply-message]');
  if (reply && !chat.readOnly) {
    const message = [...chat.messages, ...chat.pending].find(item => item.id === reply.dataset.replyMessage && (item.chatID || chat.id) === reply.dataset.replyChat);
    if (message) {
      chat.replyDraft = { messageID: message.id, chatID: reply.dataset.replyChat, name: message.isSender ? (chat.selfName || 'Moi') : message.senderName || chat.name, text: plain(message.text) || (message.attachments?.length ? 'Pièce jointe' : 'Message') };
      renderReplyDraft(); $('#message-input').focus();
    }
    return;
  }
  const jump = event.target.closest('[data-jump-message]');
  if (jump) {
    const target = [...$('#messages').querySelectorAll('.message-row')].find(node => node.dataset.messageId === jump.dataset.jumpMessage && node.dataset.messageChat === jump.dataset.replyChat);
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' }); else toast('Le message d’origine n’est pas chargé dans cette conversation.');
    return;
  }
  const toggle = event.target.closest('[data-toggle-reactions]');
  if (toggle) {
    const picker = toggle.parentElement.querySelector('.message-reaction-picker'); picker.hidden = !picker.hidden;
    toggle.setAttribute('aria-expanded', String(!picker.hidden)); return;
  }
  const react = event.target.closest('[data-message-reaction]');
  if (!react || !connected || chat.readOnly || chat.id === 'demo') return;
  const row = react.closest('.message-row'), messageID = row?.dataset.messageId, sourceID = row?.dataset.messageChat, reactionKey = react.dataset.messageReaction;
  if (!messageID || !sourceID || !reactionKey) return;
  const remove = react.getAttribute('aria-pressed') === 'true';
  react.disabled = true;
  try {
    const path = `/chats/${encodeURIComponent(sourceID)}/messages/${encodeURIComponent(messageID)}/reactions`;
    await beeper(remove ? `${path}/${encodeURIComponent(reactionKey)}` : path, remove ? { method: 'DELETE' } : { method: 'POST', body: JSON.stringify({ reactionKey }) });
    await syncMessages(chat);
  } catch (error) { toast(error.message); }
  finally { if (react.isConnected) react.disabled = false; }
});
$('#message-input').addEventListener('input', () => { if (current()) current().draft = $('#message-input').value; renderHistory(); });
$('#message-input').addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); sendMessage(); } });
$('#settings-bottom').addEventListener('click', openSettings);
$('#settings-close').addEventListener('click', () => { $('#settings-modal').hidden = true; });
$('#authorize-button').addEventListener('click', oauth);
$('#connect-button').addEventListener('click', async event => {
  event.target.disabled = true;
  try { await request('/api/auth/token', { method: 'POST', body: JSON.stringify({ base: $('#api-url').value, token: $('#api-token').value }) }); finishAuthorization(); $('#api-token').value = ''; accountsLoaded = false; accounts = []; connected = true; await loadChats(); $('#settings-modal').hidden = true; }
  catch (error) { settingsError(error); }
  finally { event.target.disabled = false; }
});
$('#disconnect-button').addEventListener('click', async () => { finishAuthorization(); cancelRecording(); try { await request('/api/logout', { method: 'POST', body: '{}' }); connected = false; accountsLoaded = false; accounts = []; chats = structuredClone(demo); activeId = 'demo'; renderContacts(); renderHeader(); renderMessages(true); renderAttachmentDraft(); connectionLabel('Déconnecté · mode démonstration'); $('#disconnect-button').hidden = true; } catch (error) { settingsError(error); } });
$('#demo-button').addEventListener('click', () => { $('#settings-modal').hidden = true; });
for (const id of ['settings-modal', 'contacts-modal']) $('#' + id).addEventListener('click', event => { if (event.target === $('#' + id)) $('#' + id).hidden = true; });
function openContacts() { $('#contacts-modal').hidden = false; $('#contact-search').focus(); renderRoster(); }
$('#search-send').addEventListener('click', openContacts); $('#invite-btn').addEventListener('click', openContacts); $('#contacts-close').addEventListener('click', () => { $('#contacts-modal').hidden = true; });
$('#wizz-btn').addEventListener('click', async () => { if ($('#wizz-btn').disabled || sending) return; const sent = await sendMessage(null, WIZZ_MESSAGE); if (sent) triggerWizz(); });
function toggleSound() { soundOn = !soundOn; $('#sound-label').textContent = soundOn ? 'Sons activés' : 'Sons coupés'; if (soundOn) chime(); }
$('#sound-label').addEventListener('click', toggleSound);
document.addEventListener('keydown', event => { if (event.key === 'Escape') { $('#settings-modal').hidden = true; $('#contacts-modal').hidden = true; closeEmojis(); closeFormatting(); } if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); openContacts(); } });
const controls = document.querySelectorAll('.window-controls button');
controls[0].disabled = true; controls[2].disabled = true;
controls[1].addEventListener('click', () => $('#window').classList.toggle('maximized'));
$('.titlebar').addEventListener('dblclick', () => $('#window').classList.toggle('maximized'));
let gallery = [], galleryIndex = 0;
function showPhoto(index) {
  galleryIndex = (index + gallery.length) % gallery.length; const photo = gallery[galleryIndex]; if (!photo) return;
  $('#viewer-stage').classList.remove('zoomed'); $('#viewer-zoom').textContent = 'Zoom'; $('#viewer-error').hidden = true;
  $('#viewer-image').src = photo.src; $('#viewer-image').alt = photo.name;
  $('#viewer-caption').textContent = `${photo.name} · ${galleryIndex + 1}/${gallery.length}`;
  $('#viewer-download').href = photo.download || photo.src; $('#viewer-download').download = photo.name;
  $('#viewer-prev').disabled = gallery.length < 2; $('#viewer-next').disabled = gallery.length < 2;
}
$('#messages').addEventListener('click', event => {
  const photo = event.target.closest('[data-photo]');
  if (photo) {
    gallery = [...$('#messages').querySelectorAll('[data-photo]')].map(button => ({ src: button.dataset.photo, name: button.dataset.name, download: button.dataset.download }));
    showPhoto([...$('#messages').querySelectorAll('[data-photo]')].indexOf(photo)); $('#media-viewer').showModal();
  }
  const retry = event.target.closest('.media-retry');
  if (retry) { const frame = retry.closest('.attachment'), media = frame.querySelector('img,video,audio'); frame.querySelector('.media-error').hidden = true; if (media instanceof HTMLMediaElement) media.load(); else if (media) media.src = media.src; }
});
$('#messages').addEventListener('error', event => {
  if (event.target.matches?.('.inline-emoji')) { fallbackEmojiImage(event); return; }
  const frame = event.target.closest?.('.attachment'); if (frame) frame.querySelector('.media-error').hidden = false;
  else if (event.target.closest?.('.link-preview')) event.target.hidden = true;
}, true);
function mediaLoaded() { const box = $('#messages'); if (box.dataset.follow === 'true') scrollToLatest(box); scheduleRead(); }
$('#messages').addEventListener('load', mediaLoaded, true); $('#messages').addEventListener('loadedmetadata', mediaLoaded, true);
function loadOlderAtTop(box) {
  const chat = current();
  if (box.scrollTop > 56 || !connected || !chat?.hasMore || chat.loading) return;
  const sourceIDs = chat.sourceChatIDs?.length ? chat.sourceChatIDs : [chat.id];
  const cursorKey = JSON.stringify(sourceIDs.map(id => {
    const page = chat.sourcePages?.get(id);
    return [id, page?.oldestCursor || null, !!page?.hasMore];
  }));
  if (chat.autoOlderCursor === cursorKey) return;
  chat.autoOlderCursor = cursorKey;
  syncMessages(chat, { older: true });
}
$('#messages').addEventListener('scroll', () => { const box = $('#messages'); box.dataset.follow = String(box.scrollHeight - box.scrollTop - box.clientHeight < 80); scheduleRead(); loadOlderAtTop(box); });
window.addEventListener('focus', scheduleRead);
document.addEventListener('visibilitychange', scheduleRead);
$('#media-viewer').addEventListener('close', scheduleRead);
$('#viewer-close').addEventListener('click', () => $('#media-viewer').close());
$('#viewer-prev').addEventListener('click', () => showPhoto(galleryIndex - 1)); $('#viewer-next').addEventListener('click', () => showPhoto(galleryIndex + 1));
$('#viewer-zoom').addEventListener('click', () => { const zoom = $('#viewer-stage').classList.toggle('zoomed'); $('#viewer-zoom').textContent = zoom ? 'Adapter' : 'Zoom'; });
$('#viewer-image').addEventListener('error', () => { $('#viewer-error').hidden = false; });
$('#media-viewer').addEventListener('click', event => { if (event.target === $('#media-viewer')) $('#media-viewer').close(); });
document.addEventListener('keydown', event => { if (!$('#media-viewer').open) return; if (event.key === 'ArrowLeft') { event.preventDefault(); showPhoto(galleryIndex - 1); } if (event.key === 'ArrowRight') { event.preventDefault(); showPhoto(galleryIndex + 1); } });
setInterval(async () => { if (!connected || syncBusy || document.hidden || sending) return; syncBusy = true; try { await syncMessages(current()); } finally { syncBusy = false; } }, 4000);
setInterval(() => { if (connected && !document.hidden) loadChats().catch(error => connectionLabel(error.message, true)); }, 20_000);
setInterval(async () => {
  if (document.hidden || connectionBusy || authorization || (connected && accountsLoaded && current()?.id !== 'demo')) return;
  connectionBusy = true;
  let status;
  try { status = await request('/api/status'); }
  catch (error) { connectionLabel(error.message, true); }
  finally { connectionBusy = false; }
  if (status?.connected) try { await restoreConnection(status); } catch (error) { connectionLabel(error.message, true); }
}, 3000);
initialize();
