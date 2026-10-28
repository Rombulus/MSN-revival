import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';

export const defaultAuthFile = process.env.MSN_AUTH_FILE || join(process.env.LOCALAPPDATA || join(homedir(), '.local', 'share'), 'MSN Revival', 'beeper-auth.json');

function windowsProtect(value, decrypt = false) {
  // Secrets pass over stdin/stdout only, never in command arguments or logs.
  const script = `$ErrorActionPreference='Stop';Add-Type -AssemblyName System.Security;$value=[Console]::In.ReadToEnd();$scope=[System.Security.Cryptography.DataProtectionScope]::CurrentUser;` + (decrypt
    ? '[Console]::Out.Write([System.Text.Encoding]::UTF8.GetString([System.Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($value),$null,$scope)))'
    : '[Console]::Out.Write([Convert]::ToBase64String([System.Security.Cryptography.ProtectedData]::Protect([System.Text.Encoding]::UTF8.GetBytes($value),$null,$scope)))');
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    let output = ''; const timer = setTimeout(() => child.kill(), 15_000);
    child.stdout.setEncoding('utf8'); child.stdout.on('data', chunk => { output += chunk; });
    child.on('error', () => { clearTimeout(timer); reject(new Error('Le chiffrement Windows est indisponible.')); });
    child.stdin.on('error', () => {});
    child.on('close', code => { clearTimeout(timer); if (code === 0) resolve(output); else reject(new Error('Impossible de lire ou protéger l’autorisation avec ce compte Windows.')); });
    child.stdin.end(value);
  });
}

export function createAuthStore(path = defaultAuthFile) {
  return {
    async load() {
      let raw; try { raw = await readFile(path, 'utf8'); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
      const record = JSON.parse(raw);
      const value = record.format === 'windows-dpapi' ? JSON.parse(await windowsProtect(record.data, true)) : record.format === 'private-file' && process.platform !== 'win32' ? record.data : null;
      if (!value || typeof value.token !== 'string' || !value.token || typeof value.base !== 'string') throw new Error('Autorisation enregistrée illisible.');
      return value;
    },
    async save(value) {
      const record = process.platform === 'win32' ? { format: 'windows-dpapi', data: await windowsProtect(JSON.stringify(value)) } : { format: 'private-file', data: value };
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      const temp = path + '.' + randomBytes(6).toString('hex') + '.tmp';
      try { await writeFile(temp, JSON.stringify(record), { mode: 0o600, flag: 'wx' }); await rename(temp, path); }
      finally { await rm(temp, { force: true }); }
    },
    async clear() { await rm(path, { force: true }); },
  };
}
