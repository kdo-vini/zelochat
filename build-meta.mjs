import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

export function verifyBuildVersion(sha, requested) {
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error('Build requires a real Git commit SHA.');
  if (requested && requested !== sha && requested !== sha.slice(0, 12)) throw new Error('PUBLIC_APP_VERSION differs from the checked-out source.');
  return sha;
}

export function writeBuildMetadata() {
  const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
  const sha = verifyBuildVersion(git('rev-parse', 'HEAD'), process.env.PUBLIC_APP_VERSION);
  const inputs = ['package.json', 'package-lock.json', 'src', 'server', 'public', 'index.html', 'vite.config.ts', 'tsconfig*.json', 'Dockerfile*', '.dockerignore', '.gitignore', 'nginx.frontend.conf', 'build-meta.mjs'];
  // Production images cannot claim a SHA while building dirty or untracked code.
  // Compare Git-normalized text, including Windows checkouts copied to Linux.
  git('-c', 'core.autocrlf=input', '-c', 'core.safecrlf=false', 'diff', '--quiet', 'HEAD', '--', ...inputs);
  if (git('ls-files', '--others', '--', ...inputs)) throw new Error('Untracked production source cannot be published as this SHA.');
  const metadata = { version: sha.slice(0, 12), sourceCommit: sha };
  writeFileSync('build-info.json', `${JSON.stringify(metadata)}\n`);
  console.log(`[build] sourceCommit=${sha}`);
  return metadata;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) writeBuildMetadata();
