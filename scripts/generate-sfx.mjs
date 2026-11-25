#!/usr/bin/env node
// Generates the recorded sound effects in public/sfx/ with ElevenLabs Sound Effects,
// through the Comfy API router (same key as the narrator).
//   COMFY_API_KEY=... node scripts/generate-sfx.mjs            # only clips that don't exist yet
//   COMFY_API_KEY=... node scripts/generate-sfx.mjs --force    # redo all of them
//   COMFY_API_KEY=... node scripts/generate-sfx.mjs steps_wood # just these ids (implies --force)
//
// Most clips hold several separate hits or steps; src/audio/Sfx.js cuts them apart at
// load time, so one clip gives a handful of variations to pick from at random.
import { writeFile, mkdir, access } from 'node:fs/promises';

const ROUTER = process.env.COMFY_ROUTER_BASE || 'https://api.comfy.org';
const key = process.env.COMFY_API_KEY;
if (!key) {
  console.error('Set COMFY_API_KEY (your Comfy API key) first.');
  process.exit(1);
}

const NO = 'no music, no voices';
const CLIPS = {
  paddle_hit: [5, `Close-up foley of table tennis: a celluloid ping pong ball struck by a rubber paddle, five separate crisp single hits with a clear second of silence between each, indoor room, ${NO}`],
  paddle_smash: [4, `Three separate hard table tennis smashes, the loud sharp crack of a rubber paddle slamming a ping pong ball, silence between each hit, indoor, ${NO}`],
  table_bounce: [5, `A ping pong ball bouncing once on a wooden table tennis table, six separate single bounces with silence between each, close microphone, hollow wooden tock, ${NO}`],
  floor_bounce: [2.5, `A ping pong ball falling onto a hardwood floor and bouncing several times, light ticking bounces getting quicker and quieter until it rolls to a stop, ${NO}`],
  net: [3, `A ping pong ball hitting a table tennis net, a soft fabric tap and rattle, three separate times with silence between, ${NO}`],
  steps_wood: [6, `Footsteps of one person walking in sneakers on a hardwood floor, ten steady evenly spaced steps, indoor room, close microphone, ${NO}`],
  steps_carpet: [6, `Footsteps of one person walking in sneakers on thin office carpet tiles, ten soft steady evenly spaced steps, quiet office, ${NO}`],
  steps_concrete: [6, `Footsteps of one person walking in sneakers on a polished concrete kitchen floor, ten steady evenly spaced steps, ${NO}`],
};

const args = process.argv.slice(2);
const only = args.filter((a) => !a.startsWith('--'));
const force = args.includes('--force') || only.length > 0;
const outDir = new URL('../public/sfx/', import.meta.url);
await mkdir(outDir, { recursive: true });
const exists = (p) => access(p).then(() => true, () => false);

let made = 0;
for (const [id, [duration, text]] of Object.entries(CLIPS)) {
  if (only.length && !only.includes(id)) continue;
  const file = new URL(`${id}.mp3`, outDir);
  if (!force && (await exists(file))) continue;
  const res = await fetch(`${ROUTER}/proxy/elevenlabs/v1/sound-generation`, {
    method: 'POST',
    headers: { 'X-API-Key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, duration_seconds: duration, prompt_influence: 0.6 }),
  });
  if (!res.ok) {
    console.error(`✗ ${id}: ${res.status} ${(await res.text()).slice(0, 300)}`);
    process.exitCode = 1;
    continue;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(file, buf);
  made++;
  console.log(`✓ ${id}.mp3 (${(buf.length / 1024).toFixed(0)} KB)`);
}
console.log(`${made} clip(s) written to public/sfx/`);
