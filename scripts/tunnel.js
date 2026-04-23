// Runs a cloudflared quick tunnel — more stable than localtunnel, no account needed.
// On each restart, writes the public URL to .tunnel-url so the server can read it.
import { spawn } from 'child_process';
import { writeFileSync, existsSync, statSync } from 'fs';
import { resolve } from 'path';

const CLOUDFLARED =
  (existsSync('C:/Program Files (x86)/cloudflared/cloudflared.exe') && 'C:/Program Files (x86)/cloudflared/cloudflared.exe') ||
  (existsSync('C:/Program Files/cloudflared/cloudflared.exe') && 'C:/Program Files/cloudflared/cloudflared.exe') ||
  'cloudflared';

const PORT = 3001;
const URL_FILE = resolve('.tunnel-url');

let attempts = 0;

function start() {
  attempts++;
  console.log(`[Tunnel] Starting cloudflared (attempt ${attempts}) → port ${PORT}...`);

  const proc = spawn(
    CLOUDFLARED,
    ['tunnel', '--url', `http://localhost:${PORT}`, '--no-autoupdate'],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );

  let captured = false;

  const handleLine = (line) => {
    process.stdout.write(`[Tunnel] ${line}\n`);
    // cloudflared logs the URL like: "|  https://random-words.trycloudflare.com  |"
    const match = line.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (match && !captured) {
      captured = true;
      const url = match[0];
      writeFileSync(URL_FILE, url, 'utf8');
      console.log(`[Tunnel] ✅ Public URL: ${url}`);
      console.log(`[Tunnel] Written to ${URL_FILE}`);
    }
  };

  proc.stdout.on('data', (chunk) => String(chunk).split('\n').filter(Boolean).forEach(handleLine));
  proc.stderr.on('data', (chunk) => String(chunk).split('\n').filter(Boolean).forEach(handleLine));

  proc.on('exit', (code) => {
    console.log(`[Tunnel] Exited (code ${code}). Restarting in 3s...`);
    setTimeout(start, 3000);
  });

  proc.on('error', (err) => {
    console.error('[Tunnel] Error:', err.message);
    setTimeout(start, 3000);
  });
}

start();
