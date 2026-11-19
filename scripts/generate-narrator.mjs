// Generate the narrator's voice clips with ElevenLabs v4 through Comfy Router.
//
//   COMFY_API_KEY=... node scripts/generate-narrator.mjs            # only clips that don't exist yet
//   COMFY_API_KEY=... node scripts/generate-narrator.mjs --force    # redo all of them
//   COMFY_API_KEY=... node scripts/generate-narrator.mjs pp_start   # just these line ids (implies --force)
//
// Reads scripts/narrator-lines.json and writes public/narrator/<file>.mp3.
// Lines marked `per` are rendered once per character, with their name filled in.

import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const ROUTER = process.env.COMFY_ROUTER_BASE || 'https://api.comfy.org';
const MODEL = 'elevenlabs/eleven_v4';
const VOICE = 'JBFqnCBsd6RMkjVDRZzb'; // "George": warm, British, storyteller
const CHARACTERS = { matt: 'Matt', deep: 'Deep', steven: 'Steven' };

const key = process.env.COMFY_API_KEY;
if (!key) {
  console.error('Set COMFY_API_KEY (your Comfy API key) first.');
  process.exit(1);
}

const root = new URL('..', import.meta.url);
const lines = JSON.parse(await readFile(new URL('scripts/narrator-lines.json', root), 'utf8'));
const outDir = fileURLToPath(new URL('public/narrator/', root));
await mkdir(outDir, { recursive: true });

const args = process.argv.slice(2);
const only = args.filter((a) => !a.startsWith('--'));
const force = args.includes('--force') || only.length > 0;

const jobs = [];
for (const l of lines) {
  if (only.length && !only.includes(l.id)) continue;
  if (l.per) for (const [id, name] of Object.entries(CHARACTERS)) jobs.push({ file: `${l.id}_${id}`, text: l.text.replaceAll('{name}', name) });
  else jobs.push({ file: l.id, text: l.text });
}

const exists = (p) => access(p).then(() => true, () => false);
let made = 0;
for (const job of jobs) {
  const path = `${outDir}${job.file}.mp3`;
  if (!force && (await exists(path))) continue;
  const res = await fetch(`${ROUTER}/v2/models/${MODEL}`, {
    method: 'POST',
    headers: { 'X-API-Key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ inputs: [{ text: job.text, voice_id: VOICE }], seed: 7 }),
  });
  if (!res.ok) {
    console.error(`✗ ${job.file}: ${res.status} ${(await res.text()).slice(0, 300)}`);
    process.exitCode = 1;
    continue;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(path, buf);
  made++;
  console.log(`✓ ${job.file}.mp3 (${(buf.length / 1024).toFixed(0)} KB)`);
}
console.log(`${made} clip(s) written to public/narrator/`);
