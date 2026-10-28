// Pure selection shared by the client and the local API proxy.
export function conversationProfiles(chat, accounts = []) {
  const participants = chat.participants?.items || [];
  const self = participants.find(person => person.isSelf);
  const other = participants.find(person => !person.isSelf);
  const account = accounts.find(item => item.accountID === chat.accountID);
  const fallbackSelf = accounts.find(item => item.accountID === 'matrix' && item.user?.imgURL)?.user
    || accounts.find(item => item.user?.imgURL)?.user;
  return {
    contactPhoto: chat.type === 'group' ? chat.imgURL : (other?.imgURL || chat.imgURL),
    selfPhoto: self?.imgURL || account?.user?.imgURL || fallbackSelf?.imgURL,
    selfName: self?.fullName || account?.user?.fullName || fallbackSelf?.fullName || 'Moi',
  };
}

export function avatarSources(data) {
  const sources = new Set();
  const add = value => { if (typeof value === 'string' && value) sources.add(value); };
  for (const item of Array.isArray(data) ? data : (data.items || [])) {
    add(item.imgURL); add(item.user?.imgURL);
    for (const participant of item.participants?.items || []) add(participant.imgURL);
  }
  return sources;
}

export function imageType(bytes) {
  if (bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  const ascii = (start, end) => String.fromCharCode(...bytes.slice(start, end));
  if (bytes.length >= 6 && ['GIF87a', 'GIF89a'].includes(ascii(0, 6))) return 'image/gif';
  if (bytes.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  return null;
}

export function networkIdentity(chat) {
  const text = `${chat.network || ''} ${chat.bridge || ''} ${chat.accountID || ''}`.toLowerCase();
  if (/whatsapp/.test(text)) return { icon: 'whatsapp', name: 'WhatsApp' };
  if (/instagram/.test(text)) return { icon: 'instagram', name: 'Instagram' };
  if (/messenger|facebook/.test(text)) return { icon: 'messenger', name: 'Messenger' };
  if (/signal/.test(text)) return { icon: 'signal', name: 'Signal' };
  if (/telegram/.test(text)) return { icon: 'telegram', name: 'Telegram' };
  if (/discord/.test(text)) return { icon: 'discord', name: 'Discord' };
  if (/google.?chat|hangouts/.test(text)) return { icon: 'googlechat', name: 'Google Chat' };
  if (/google.?messages|google.?voice|android.?sms|local.?sms|\bsms\b/.test(text)) return { icon: 'googlemessages', name: 'Google Messages' };
  if (/slack/.test(text)) return { icon: 'slack', name: 'Slack' };
  if (/linkedin/.test(text)) return { icon: 'linkedin', name: 'LinkedIn' };
  if (/teams/.test(text)) return { icon: 'teams', name: 'Teams' };
  if (/imessage|apple/.test(text)) return { icon: 'apple', name: 'iMessage' };
  if (/twitter|(^|\s)x($|\s)/.test(text)) return { icon: 'x', name: 'X' };
  if (/matrix/.test(text)) return { icon: 'matrix', name: 'Matrix' };
  return { icon: 'chat', name: chat.network || 'Beeper' };
}

export const rosterSearchText = value => String(value || '').normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('fr').trim();
export function rosterGroups(chats, query = '') {
  const groups = new Map(), needle = rosterSearchText(query);
  for (const chat of chats) {
    const labels = (chat.labels || []).filter(label => label.id && label.name);
    const targets = chat.pinned ? [{ id: 'favorites', name: 'Favoris' }] : labels.length ? labels.map(label => ({ id: 'label:' + label.id, name: label.name })) : [{ id: chat.type === 'group' ? 'groups' : 'contacts', name: chat.type === 'group' ? 'Groupes' : 'Contacts' }];
    for (const target of targets) {
      if (needle && !rosterSearchText(`${chat.name} ${chat.network} ${networkIdentity(chat).name} ${target.name}`).includes(needle)) continue;
      if (!groups.has(target.id)) groups.set(target.id, { ...target, chats: [] });
      groups.get(target.id).chats.push(chat);
    }
  }
  const compare = (a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' });
  return [...groups.values()].sort((a, b) => a.id === 'favorites' ? -1 : b.id === 'favorites' ? 1 : compare(a, b)).map(group => ({ ...group, chats: group.chats.sort(compare) }));
}
