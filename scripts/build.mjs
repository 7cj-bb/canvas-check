import { build as viteBuild } from 'vite';
import { build as bundle } from 'esbuild';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const output = process.env.CANVAS_CHECK_OUT_DIR || 'dist';
if (!['dist','dist-pregrade','dist-pregrade-cloud'].includes(output)) throw new Error('Invalid build directory.');
await viteBuild({build:{outDir:output}});
await bundle({ entryPoints: ['src/extension/content.ts'], outfile: `${output}/content.js`, bundle: true, format: 'iife', target: 'chrome116' });
await bundle({ entryPoints: ['src/extension/background.ts'], outfile: `${output}/background.js`, bundle: true, format: 'esm', target: 'chrome116' });
await cp('samples', `${output}/samples`, { recursive: true });
const privateDirectory = process.env.CANVAS_CHECK_PRIVATE_DIR || fileURLToPath(new URL('../.local-private/', import.meta.url));
await mkdir(privateDirectory, { recursive: true });
const tokenPath = path.join(privateDirectory, 'bridge-token');
let bridgeToken;
try { bridgeToken = (await readFile(tokenPath, 'utf8')).trim(); } catch {}
if (!/^[a-f0-9]{64}$/.test(bridgeToken ?? '')) { bridgeToken = randomBytes(32).toString('hex'); await writeFile(tokenPath, bridgeToken, { mode: 0o600 }); }
const remote = process.env.CANVAS_CHECK_API_URL;
if (remote) {
  const url = new URL(remote);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !/^[A-Za-z0-9_-]{32,}$/.test(process.env.CANVAS_CHECK_CLIENT_TOKEN ?? '') || /^sk-/i.test(process.env.CANVAS_CHECK_CLIENT_TOKEN ?? '')) throw new Error('Cloud builds require a valid HTTPS backend and a separate demo access token (never an OpenAI API key).');
  const manifest = JSON.parse(await readFile(`${output}/manifest.json`, 'utf8'));
  manifest.host_permissions = manifest.host_permissions.filter(host => !host.includes('127.0.0.1'));
  manifest.host_permissions.push(`${url.origin}/*`);
  manifest.content_scripts = manifest.content_scripts.map(script => ({ ...script, matches: script.matches.filter(match => !match.includes('127.0.0.1')) }));
  if (process.env.CANVAS_CHECK_KEEP_DEVELOPMENT_ID !== '1') {
    const identity = JSON.parse(await readFile('cloud/extension-identity.json', 'utf8'));
    const id = createHash('sha256').update(Buffer.from(identity.key, 'base64')).digest('hex').slice(0, 32).replace(/[0-9a-f]/g, char => String.fromCharCode(97 + parseInt(char, 16)));
    if (id !== identity.id || !/^[a-p]{32}$/.test(id)) throw new Error('Distribution extension identity does not match its public key.');
    manifest.key = identity.key;
  }
  await writeFile(`${output}/manifest.json`, JSON.stringify(manifest, null, 2));
  await writeFile(`${output}/local-bridge.json`, JSON.stringify({ baseUrl: url.origin, mode: 'cloud', token: process.env.CANVAS_CHECK_CLIENT_TOKEN }));
} else await writeFile(`${output}/local-bridge.json`, JSON.stringify({ baseUrl: 'http://127.0.0.1:4318', mode: 'development', token: bridgeToken }));
console.log(`Chrome extension built: ${output}/`);
