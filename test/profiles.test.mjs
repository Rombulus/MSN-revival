import { test } from 'node:test';
import assert from 'node:assert/strict';
import { conversationProfiles, avatarSources, imageType, networkIdentity, rosterGroups, historyEntries } from '../profiles.mjs';

test('place le participant distant en haut et isSelf en bas, quel que soit leur ordre', () => {
  const self = { id: 'me', isSelf: true, fullName: 'Moi', imgURL: 'mxc://self' };
  const other = { id: 'other', fullName: 'Contact', imgURL: 'mxc://contact' };
  for (const items of [[self, other], [other, self]]) {
    const result = conversationProfiles({ type: 'single', participants: { items }, imgURL: 'mxc://chat' });
    assert.equal(result.contactPhoto, other.imgURL); assert.equal(result.selfPhoto, self.imgURL);
  }
});
test('utilise mon profil du réseau de la conversation quand isSelf est absent', () => {
  const accounts = [{ accountID: 'a', user: { fullName: 'Profil A', imgURL: 'file:///a.jpg' } }, { accountID: 'b', user: { fullName: 'Profil B', imgURL: 'file:///b.jpg' } }];
  const result = conversationProfiles({ accountID: 'b', type: 'single', participants: { items: [] } }, accounts);
  assert.equal(result.selfPhoto, 'file:///b.jpg'); assert.equal(result.selfName, 'Profil B'); assert.equal(result.contactPhoto, undefined);
});
test('une conversation de groupe garde sa photo de groupe', () => {
  const result = conversationProfiles({ type: 'group', imgURL: 'mxc://group', participants: { items: [{ imgURL: 'mxc://member' }] } });
  assert.equal(result.contactPhoto, 'mxc://group');
});
test('les photos absentes restent absentes et les sources autorisées proviennent des profils', () => {
  assert.equal(conversationProfiles({}).selfPhoto, undefined);
  const sources = avatarSources({ items: [{ imgURL: 'chat', participants: { items: [{ imgURL: 'contact' }, { isSelf: true, imgURL: 'me' }] } }] });
  assert.deepEqual([...sources].sort(), ['chat', 'contact', 'me']);
  assert.deepEqual([...avatarSources([{ user: { imgURL: 'profile' } }])], ['profile']);
});
test('reconnaît une photo servie en octet-stream et rejette un document HTML', () => {
  assert.equal(imageType(Buffer.from([255, 216, 255, 224])), 'image/jpeg');
  assert.equal(imageType(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), 'image/png');
  assert.equal(imageType(Buffer.from('<html>not a photo</html>')), null);
});
test('reconnaît les réseaux par leur nom ou leur bridge sans afficher une icône MSN', () => {
  assert.equal(networkIdentity({ network: 'WhatsApp' }).icon, 'whatsapp');
  assert.equal(networkIdentity({ bridge: 'local-instagram' }).icon, 'instagram');
  assert.equal(networkIdentity({ network: 'Facebook Messenger' }).icon, 'messenger');
  assert.equal(networkIdentity({ network: 'Google Messages (SMS)' }).icon, 'googlemessages');
  assert.equal(networkIdentity({ network: 'Google Chat' }).icon, 'googlechat');
  assert.equal(networkIdentity({ network: 'Inconnu' }).icon, 'chat');
});
test('utilise les étiquettes réelles, les favoris et les groupes sans inventer de présence', () => {
  const chats = [{ id: '1', name: 'Léa', network: 'Instagram', labels: [{ id: 'f', name: 'Famille' }] }, { id: '2', name: 'Zoé', pinned: true }, { id: '3', name: 'La bande', type: 'group' }, { id: '4', name: 'Adam' }];
  const groups = rosterGroups(chats);
  assert.equal(groups[0].name, 'Favoris');
  assert.equal(groups.find(group => group.name === 'Famille').chats[0].id, '1');
  assert.equal(groups.find(group => group.name === 'Groupes').chats[0].id, '3');
  assert.equal(rosterGroups(chats, 'lea')[0].chats[0].id, '1');
  assert.equal(rosterGroups(chats, 'instagram')[0].chats[0].id, '1');
  assert.deepEqual(rosterGroups(chats, 'personne-inconnue'), []);
});
test('trie l’historique par activité et regroupe les dates sans fabriquer de date absente', () => {
  const now = new Date(2026, 9, 28, 12);
  const chats = [{ id: 'old', name: 'Ancien', lastActivity: new Date(2026, 8, 1, 14).toISOString() }, { id: 'today', name: 'Récent', activityAt: new Date(2026, 9, 28, 11).toISOString() }, { id: 'none', name: 'Sans date' }, { id: 'yesterday', name: 'Hier', lastActivity: new Date(2026, 9, 27, 18).toISOString() }];
  const entries = historyEntries(chats, { now });
  assert.deepEqual(entries.map(item => item.id), ['today', 'yesterday', 'old', 'none']);
  assert.deepEqual(entries.map(item => item.historyGroup), ['Aujourd’hui', 'Hier', 'Plus anciennes', 'Sans date']);
  assert.equal(entries[1].historyTime, 'Hier'); assert.equal(entries[3].historyTime, '');
});
test('filtre les non-lus et recherche les noms, réseaux et aperçus sans accents', () => {
  const chats = [{ id: 'a', name: 'Léa', network: 'Instagram', unread: 2, previewText: 'Une photo du marché' }, { id: 'b', name: 'Adam', network: 'Telegram', unread: 0, markedUnread: true }, { id: 'c', name: 'Julie', network: 'Messenger', unread: 0 }];
  assert.deepEqual(historyEntries(chats, { query: 'marche' }).map(item => item.id), ['a']);
  assert.deepEqual(historyEntries(chats, { query: 'lea', unreadOnly: true }).map(item => item.id), ['a']);
  assert.equal(historyEntries(chats, { unreadOnly: true }).length, 2);
  assert.equal(historyEntries(chats, { query: 'inexistant' }).length, 0);
});
