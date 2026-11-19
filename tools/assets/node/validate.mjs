import fs from 'fs'; import path from 'path'; import validator from 'gltf-validator';
for (const f of process.argv.slice(2)) {
  const r = await validator.validateBytes(new Uint8Array(fs.readFileSync(f)), { externalResourceFunction: () => Promise.reject('no ext') });
  const i = r.issues; console.log(path.basename(f), 'errors', i.numErrors, 'warnings', i.numWarnings);
  for (const m of i.messages.filter(m => m.severity <= 1)) console.log('   ', m.code, m.pointer);
}
