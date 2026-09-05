import { readFileSync } from 'node:fs';

const resolved = (value: string | undefined) => value && !value.startsWith('${') ? value : undefined;
function readBuildMetadata(): { version: string; sourceCommit: string | null } {
  try {
    const baked = JSON.parse(readFileSync(new URL('../build-info.json', import.meta.url), 'utf8'));
    if (!/^[a-f0-9]{40}$/.test(baked.sourceCommit) || baked.version !== baked.sourceCommit.slice(0, 12)) throw new Error('Invalid build metadata');
    return baked;
  } catch (error) {
    if (process.env.NODE_ENV === 'production') throw new Error('Production requires valid baked build-info.json', { cause: error });
    return { version: resolved(process.env.PUBLIC_APP_VERSION) || resolved(process.env.SOURCE_COMMIT) || 'dev', sourceCommit: null };
  }
}
export const BUILD_INFO = readBuildMetadata();
