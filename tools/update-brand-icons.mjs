// Import only SVG path data from Simple Icons (CC0) into the existing local sprite.
import { readFile, writeFile } from 'node:fs/promises';
const icons = ['whatsapp', 'messenger', 'instagram', 'signal', 'telegram', 'discord', 'googlemessages', 'googlechat', 'slack', 'linkedin', 'x', 'apple', 'matrix'];
const results = await Promise.allSettled(icons.map(async name => {
  const url = `https://raw.githubusercontent.com/simple-icons/simple-icons/develop/icons/${name}.svg`;
  const response = await fetch(url); if (!response.ok) return { name, missing: true };
  const svg = await response.text(); const paths = [...svg.matchAll(/<path\b[^>]*\bd="([^"]+)"/g)].map(match => match[1]);
  if (!paths.length || paths.some(path => !/^[a-z0-9.,+\-\s]+$/i.test(path))) throw new Error('Unexpected SVG path: ' + name);
  return { name, symbol: `<symbol id="app-${name}" viewBox="0 0 24 24">${paths.map(path => `<path d="${path}"/>`).join('')}</symbol>` };
}));
const symbols = [];
for (let i = 0; i < results.length; i++) { const result = results[i]; if (result.status === 'rejected') throw result.reason; if (result.value.symbol) symbols.push(result.value.symbol); console.log(icons[i] + ': ' + (result.value.missing ? 'fallback' : 'downloaded')); }
// Recognizable fallbacks for unavailable brand entries, plus a neutral chat logo.
const existing = new Set(results.filter(result => result.status === 'fulfilled' && result.value.symbol).map(result => result.value.name));
if (!existing.has('messenger')) symbols.push('<symbol id="app-messenger" viewBox="0 0 24 24"><path d="M12 2C5.9 2 1 6.5 1 12c0 3.1 1.6 5.9 4.1 7.7V23l3.6-2c1 .3 2.2.5 3.3.5 6.1 0 11-4.2 11-9.5S18.1 2 12 2Z"/><path d="m5.5 14.7 5.2-5.6 3.1 2.3 4.7-2.3-5.1 5.5-3.1-2.3Z" fill="white"/></symbol>');
if (!existing.has('linkedin')) symbols.push('<symbol id="app-linkedin" viewBox="0 0 24 24"><rect width="24" height="24" rx="2"/><circle cx="5.4" cy="5.2" r="1.7" fill="white"/><path d="M4 9h3v11H4Zm6 0h3v1.5c2-2.5 7-2.4 7 2.8V20h-3v-6c0-3-4-3-4 0v6h-3Z" fill="white"/></symbol>');
if (!existing.has('googlemessages')) symbols.push('<symbol id="app-googlemessages" viewBox="0 0 24 24"><path d="M4 2h16a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H8l-7 4V5a3 3 0 0 1 3-3Z"/><path d="M6 7h12M6 11h12M6 15h8" stroke="white" stroke-width="2"/></symbol>');
if (!existing.has('slack')) symbols.push('<symbol id="app-slack" viewBox="0 0 24 24"><path d="M8 1a2 2 0 0 1 2 2v7H6V3a2 2 0 0 1 2-2Z" fill="#36c5f0"/><circle cx="3" cy="8" r="2" fill="#36c5f0"/><path d="M23 8a2 2 0 0 1-2 2h-7V6h7a2 2 0 0 1 2 2Z" fill="#2eb67d"/><circle cx="16" cy="3" r="2" fill="#2eb67d"/><path d="M16 23a2 2 0 0 1-2-2v-7h4v7a2 2 0 0 1-2 2Z" fill="#ecb22e"/><circle cx="21" cy="16" r="2" fill="#ecb22e"/><path d="M1 16a2 2 0 0 1 2-2h7v4H3a2 2 0 0 1-2-2Z" fill="#e01e5a"/><circle cx="8" cy="21" r="2" fill="#e01e5a"/></symbol>');
symbols.push('<symbol id="app-teams" viewBox="0 0 24 24"><circle cx="16" cy="5" r="3" opacity=".8"/><circle cx="21" cy="8" r="2" opacity=".7"/><rect x="10" y="10" width="13" height="9" rx="3" opacity=".8"/><rect x="1" y="5" width="14" height="16" rx="2"/><path d="M4 9h8M8 9v8" stroke="white" stroke-width="2"/></symbol>');
symbols.push('<symbol id="app-chat" viewBox="0 0 24 24"><path d="M4 3h16a3 3 0 0 1 3 3v11a3 3 0 0 1-3 3H8l-6 4V6a3 3 0 0 1 2-3Z"/><path d="M6 8h12M6 12h9" stroke="white" stroke-width="2"/></symbol>');
const path = new URL('../assets/legacy-icons.svg', import.meta.url);
const sprite = (await readFile(path, 'utf8')).replace(/<!-- APP LOGOS START -->[\s\S]*?<!-- APP LOGOS END -->/g, '');
await writeFile(path, sprite.replace('</svg>', `<!-- APP LOGOS START -->${symbols.join('')}<!-- APP LOGOS END --></svg>`));
