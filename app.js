const $ = (selector) => document.querySelector(selector);
const demoContacts = [
  { id: 'quentin', name: 'Quentin', status: 'En ligne', online: true, initials: 'Q', color: 'coral', network: 'Windows Live Messenger', preview: 'tu fais quoi ce soir ?', time: '12:42', messages: [
    { from: 'Quentin', time: '12:38', text: 'Wesh 😄' }, { from: 'Hugo', time: '12:39', text: 'Tu fais quoi ce soir ?' }, { from: 'Quentin', time: '12:42', text: 'On se capte sur MSN vers 20h ? je te raconte tout 👀' },
  ]},
  { id: 'marie', name: 'Marie', status: 'Absente', online: false, initials: 'M', color: 'lilac', network: 'Messenger', preview: 'a partagé une photo', time: '11:18', messages: [{ from: 'Marie', time: '11:18', text: 'Regarde cette photo 🥹' }, { from: 'Hugo', time: '11:20', text: 'Trop beau !' }]},
  { id: 'lucas', name: 'Lucas', status: 'En ligne', online: true, initials: 'L', color: 'mint', network: 'WhatsApp', preview: 'mdr c’était incroyable', time: '10:56', messages: [{ from: 'Hugo', time: '10:52', text: 'Le match hier soir 🔥' }, { from: 'Lucas', time: '10:56', text: 'mdr c’était incroyable' }]},
  { id: 'lea', name: 'Léa ✨', status: 'Occupée', online: false, initials: 'L', color: 'pink', network: 'Instagram', preview: 'à tout à l’heure !', time: 'Hier', messages: [{ from: 'Léa ✨', time: '17:14', text: 'À tout à l’heure !' }]},
  { id: 'groupe', name: 'La bande 🪩', status: '4 membres', online: true, initials: '🪩', color: 'sun', network: 'Telegram', preview: 'Nina : vendredi ça vous dit ?', time: 'Hier', messages: [{ from: 'Nina', time: '16:02', text: 'Vendredi ça vous dit ?' }]},
];
let contacts = structuredClone(demoContacts);
let activeId = 'quentin';
let mode = 'demo';
let apiBase = localStorage.getItem('msn-api-base') || 'http://localhost:23373';
let apiToken = localStorage.getItem('msn-api-token') || '';
let soundOn = true;
let audioContext;
let toastTimer;

function activeContact() { return contacts.find((contact) => contact.id === activeId) || contacts[0]; }
function escapeHTML(value = '') { return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]); }
function initials(name = '?') { return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || '?'; }
function colorFor(index) { return ['coral', 'lilac', 'mint', 'pink', 'sun', 'blue'][index % 6]; }
function showToast(message) { const toast = $('#toast'); toast.textContent = message; toast.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove('show'), 2500); }
function playChime(kind = 'message') {
  if (!soundOn) return;
  try {
    audioContext ||= new AudioContext();
    const now = audioContext.currentTime;
    const notes = kind === 'wizz' ? [[440, 0], [587, .09], [440, .19], [740, .3]] : [[659, 0], [784, .11], [988, .23]];
    notes.forEach(([frequency, offset]) => {
      const oscillator = audioContext.createOscillator(); const gain = audioContext.createGain();
      oscillator.type = 'sine'; oscillator.frequency.setValueAtTime(frequency, now + offset);
      gain.gain.setValueAtTime(.0001, now + offset); gain.gain.exponentialRampToValueAtTime(kind === 'wizz' ? .12 : .1, now + offset + .015); gain.gain.exponentialRampToValueAtTime(.0001, now + offset + .22);
      oscillator.connect(gain); gain.connect(audioContext.destination); oscillator.start(now + offset); oscillator.stop(now + offset + .24);
    });
  } catch { /* Audio is optional; the chat still works if the browser blocks it. */ }
}
function renderContacts(filter = '') {
  const picker = $('#contact-picker');
  if (!picker) return;
  picker.innerHTML = contacts.map((item) => `<option value="${escapeHTML(item.id)}">${escapeHTML(item.name)}</option>`).join('');
  picker.value = activeId;
}
function renderMessages() {
  const contact = activeContact();
  $('#messages').innerHTML = `${(contact.messages || []).map((message) => {
    if (message.system) return `<div class="system-note">${escapeHTML(message.text)}</div>`;
    const mine = message.from === 'Hugo' || message.isSender;
    return `<article class="message-row ${mine ? 'mine' : ''}"><div class="message-content"><div class="message-meta"><strong>${escapeHTML(message.from || (mine ? 'Hugo' : contact.name))} dit :</strong><span>${escapeHTML(message.time || '')}</span></div><div class="bubble">${escapeHTML(message.text || message.body || 'Pièce jointe')}</div></div></article>`;
  }).join('') || '<div class="system-note">Cette conversation est encore silencieuse. Envoie le premier message ✨</div>'}`;
  $('#messages').scrollTop = $('#messages').scrollHeight;
}
function updateChatHeader() {
  const contact = activeContact();
  $('#contact-picker').value = contact.id;
  $('#contact-display').textContent = contact.name;
  $('#chat-status').textContent = contact.status || (contact.online ? 'En ligne' : 'Vu récemment');
  $('#chat-status').previousElementSibling.style.background = contact.online ? 'var(--green)' : 'var(--yellow)';
  $('#message-input').placeholder = `Écris un message à ${contact.name}...`;
}
function selectContact(id) { activeId = id; updateChatHeader(); renderContacts(); renderMessages(); if (mode === 'beeper') loadMessages(activeContact()); }
async function api(path, options = {}) {
  const response = await fetch(`${apiBase.replace(/\/$/, '')}${path}`, { ...options, headers: { Authorization: `Bearer ${apiToken}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers } });
  if (!response.ok) throw new Error(`L’API Beeper répond ${response.status}. Vérifie l’adresse et ton token.`);
  return response.json();
}
function normalizeChat(chat, index) {
  const name = chat.title || chat.name || chat.participants?.map((person) => person.name || person.displayName).filter(Boolean).join(', ') || chat.preview?.senderName || `Conversation ${index + 1}`;
  return { id: chat.id || chat.chatID, name, status: chat.isArchived ? 'Archivée' : (chat.participants?.length > 2 ? 'Conversation de groupe' : 'Connecté'), online: true, initials: initials(name), color: colorFor(index), network: chat.network || 'Beeper', preview: chat.preview?.text || chat.preview?.body || 'Ouvre la conversation', time: chat.preview?.timestamp ? new Date(chat.preview.timestamp).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '', messages: [] };
}
async function connectBeeper() {
  const button = $('#connect-button'); const error = $('#settings-error');
  apiBase = $('#api-url').value.trim() || 'http://localhost:23373'; apiToken = $('#api-token').value.trim();
  if (!apiToken) { error.textContent = 'Ajoute le token généré dans Beeper Desktop pour continuer.'; error.hidden = false; return; }
  button.disabled = true; button.textContent = 'Connexion…'; error.hidden = true;
  try {
    const result = await api('/v1/chats?limit=100');
    const items = Array.isArray(result) ? result : (result.items || result.chats || []);
    if (!items.length) throw new Error('Aucune conversation trouvée. Vérifie que tes réseaux sont connectés dans Beeper.');
    localStorage.setItem('msn-api-base', apiBase); localStorage.setItem('msn-api-token', apiToken);
    contacts = items.map(normalizeChat); mode = 'beeper'; activeId = contacts[0].id;
    $('#settings-modal').hidden = true; $('#connection-label').innerHTML = '<i class="presence-dot"></i> Beeper connecté · conversation privée'; $('#settings-bottom').title = 'API locale active';
    renderContacts(); updateChatHeader(); renderMessages(); showToast(`${contacts.length} conversations chargées · bienvenue sur MSN !`); await loadMessages(activeContact());
  } catch (cause) {
    error.textContent = `${cause.message} Si le message parle de connexion réseau, ouvre Beeper → Paramètres → Intégrations et vérifie que l’API locale est activée.`; error.hidden = false;
  } finally { button.disabled = false; button.innerHTML = 'Connecter Beeper <span>→</span>'; }
}
async function loadMessages(contact) {
  if (mode !== 'beeper' || !contact?.id) return;
  try {
    const result = await api(`/v1/chats/${encodeURIComponent(contact.id)}/messages`);
    const items = Array.isArray(result) ? result : (result.items || result.messages || []);
    contact.messages = items.map((message) => ({ from: message.isSender ? 'Hugo' : (message.senderName || contact.name), isSender: message.isSender, time: message.timestamp ? new Date(message.timestamp).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '', text: message.text || message.body || message.caption || (message.attachments?.length ? '📎 Pièce jointe' : '') })).filter((message) => message.text);
    renderMessages();
  } catch (cause) { showToast(cause.message); }
}
async function sendMessage() {
  const input = $('#message-input'); const text = input.value.trim(); if (!text) return;
  const contact = activeContact();
  const optimistic = { from: 'Hugo', time: new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }), text };
  contact.messages ||= []; contact.messages.push(optimistic); contact.preview = text; input.value = ''; renderMessages(); renderContacts(); playChime('message');
  if (mode === 'beeper') {
    try { await api(`/v1/chats/${encodeURIComponent(contact.id)}/messages`, { method: 'POST', body: JSON.stringify({ text }) }); }
    catch (cause) { contact.messages.pop(); contact.messages.push({ ...optimistic, system: true, text: `Envoi échoué · ${cause.message}` }); renderMessages(); showToast('Le message n’a pas pu être envoyé.'); }
  }
}
function openSettings() { $('#api-url').value = apiBase; $('#api-token').value = apiToken; $('#settings-error').hidden = true; $('#settings-modal').hidden = false; $('#api-token').focus(); }
$('#contact-picker').addEventListener('change', (event) => selectContact(event.target.value));
$('#settings-open').addEventListener('click', openSettings); $('#settings-bottom').addEventListener('click', openSettings); $('#settings-close').addEventListener('click', () => { $('#settings-modal').hidden = true; });
$('#settings-modal').addEventListener('click', (event) => { if (event.target === $('#settings-modal')) $('#settings-modal').hidden = true; });
$('#connect-button').addEventListener('click', connectBeeper);
$('#demo-button').addEventListener('click', () => { mode = 'demo'; contacts = structuredClone(demoContacts); activeId = 'quentin'; $('#settings-modal').hidden = true; $('#connection-label').innerHTML = '<i class="presence-dot"></i> Mode démo · conversation privée'; $('#connection-label').style.color = ''; $('#settings-bottom').innerHTML = '⚙'; $('#settings-bottom').title = 'Connecter Beeper'; renderContacts(); updateChatHeader(); renderMessages(); showToast('Mode démo : explore les petits détails MSN ✨'); });
$('#send-btn').addEventListener('click', sendMessage);
$('#message-input').addEventListener('keydown', (event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); sendMessage(); } });
$('#emoji-btn').addEventListener('click', () => { const input = $('#message-input'); input.value += ' 😊'; input.focus(); });
$('#wizz-btn').addEventListener('click', async () => {
  const window = $('#window'); window.classList.remove('shake'); void window.offsetWidth; window.classList.add('shake'); playChime('wizz');
  const contact = activeContact(); contact.messages.push({ from: 'Hugo', time: new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }), text: '✣ Wizz !', system: true }); renderMessages();
  if (mode === 'beeper') { try { await api(`/v1/chats/${encodeURIComponent(contact.id)}/messages`, { method: 'POST', body: JSON.stringify({ text: '✣ Wizz !' }) }); } catch { showToast('Le Wizz s’affiche ici, mais Beeper n’a pas accepté ce message spécial.'); } }
});
function toggleSound() {
  soundOn = !soundOn;
  $('#sound-label').textContent = soundOn ? 'Sons activés' : 'Sons coupés';
  $('#sound-toggle').textContent = soundOn ? '♫' : '♩';
  $('#sound-toggle-bottom').textContent = soundOn ? '🔊' : '🔇';
  if (soundOn) playChime();
}
$('#sound-toggle').addEventListener('click', toggleSound);
$('#sound-toggle-bottom').addEventListener('click', toggleSound);
$('#call-btn').addEventListener('click', () => showToast('Les appels restent dans Beeper pour le moment.'));
$('#video-btn').addEventListener('click', () => showToast('La webcam attendra une prochaine version 🙂'));
$('#attach-btn').addEventListener('click', () => showToast('Les pièces jointes arrivent bientôt.'));
$('#font-btn').addEventListener('click', () => showToast('Format du texte : bientôt disponible.'));
$('#invite-btn').addEventListener('click', () => showToast('Les invitations de groupe arrivent bientôt.'));
$('#activities-btn').addEventListener('click', () => showToast('Les activités partagées arrivent bientôt.'));
$('#games-btn').addEventListener('click', () => showToast('Les jeux MSN arrivent bientôt 🙂'));
$('#voice-clip-btn').addEventListener('click', () => showToast('Les messages vocaux arrivent bientôt.'));
$('#wizz-emoji-btn').addEventListener('click', () => showToast('Les émoticônes animées arrivent bientôt.'));
$('#image-btn').addEventListener('click', () => showToast('L’insertion d’image arrive bientôt.'));
$('#sticker-btn').addEventListener('click', () => showToast('Les stickers arrivent bientôt.'));
$('#search-send').addEventListener('click', () => showToast('La recherche de conversation arrive bientôt.'));
$('#sound-label').addEventListener('click', toggleSound);
document.addEventListener('keydown', (event) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); $('#contact-picker').focus(); } if (event.key === 'Escape') $('#settings-modal').hidden = true; });
renderContacts(); updateChatHeader(); renderMessages();
if (apiToken) { $('#api-token').value = apiToken; }
