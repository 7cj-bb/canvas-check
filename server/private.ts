import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
export const privateDirectory = process.env.CANVAS_CHECK_PRIVATE_DIR || fileURLToPath(new URL('../.local-private/', import.meta.url));
export async function bridgeToken() {
  await mkdir(privateDirectory, { recursive: true });
  const filename = path.join(privateDirectory, 'bridge-token');
  try { const token = (await readFile(filename, 'utf8')).trim(); if (/^[a-f0-9]{64}$/.test(token)) return token; } catch {}
  const token = randomBytes(32).toString('hex'); await writeFile(filename, token, { mode: 0o600 }); return token;
}
export async function loadSettings(): Promise<{ apiKey: string; model: string; pregradeModel: string }> {
  let local: { apiKey?: string; model?: string } = {};
  try { local = JSON.parse(await readFile(path.join(privateDirectory, 'openai.json'), 'utf8')); } catch {}
  return { apiKey: process.env.OPENAI_API_KEY || local.apiKey || '', model: process.env.OPENAI_MODEL || local.model || 'gpt-4.1-mini', pregradeModel: process.env.OPENAI_PREGRADE_MODEL || 'gpt-5-mini' };
}
export async function saveSettings(apiKey: string, model: string) {
  await mkdir(privateDirectory, { recursive: true });
  await writeFile(path.join(privateDirectory, 'openai.json'), JSON.stringify({ apiKey, model }), { mode: 0o600 });
}
