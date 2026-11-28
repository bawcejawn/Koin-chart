// Encrypted backup and restore of the bot's key and settings.
//   node src/backup.js create            -> backups/bot-backup-YYYYMMDD-HHMM.kcbak
//   node src/backup.js verify <file>     -> checks the password opens it
//   node src/backup.js restore <file>    -> writes bot.key and config.json (refuses to overwrite unless --force)
// Encryption: scrypt (N=2^15, r=8, p=1) password key + AES-256-GCM. Without the password the file is useless,
// so keep the password somewhere separate from the file (e.g. password manager; file on a USB stick).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');

const ROOT = path.join(__dirname, '..');
const FILES = ['bot.key', 'config.json'];
const KDF = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function encrypt(obj, password) {
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(password, salt, 32, KDF);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return { format: 'koin-chart-bot-backup', v: 1, kdf: 'scrypt', ...KDF, maxmem: undefined, salt: salt.toString('base64'), iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), data: data.toString('base64'), created: new Date().toISOString() };
}
function decrypt(box, password) {
  if (box.format !== 'koin-chart-bot-backup') throw new Error('Not a bot backup file.');
  const key = crypto.scryptSync(password, Buffer.from(box.salt, 'base64'), 32, { N: box.N, r: box.r, p: box.p, maxmem: KDF.maxmem });
  const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(box.iv, 'base64'));
  d.setAuthTag(Buffer.from(box.tag, 'base64'));
  try { return JSON.parse(Buffer.concat([d.update(Buffer.from(box.data, 'base64')), d.final()]).toString('utf8')); }
  catch (e) { throw new Error('Wrong password, or the file is damaged.'); }
}

function ask(q, hidden = true) {
  return new Promise(res => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) rl._writeToOutput = s => { if (s.includes(q)) process.stdout.write(s); else process.stdout.write('*'); };
    rl.question(q, a => { rl.close(); if (hidden) process.stdout.write('\n'); res(a); });
  });
}

async function main() {
  const [cmd, file] = process.argv.slice(2);
  const force = process.argv.includes('--force');
  if (cmd === 'create') {
    const payload = {};
    for (const f of FILES) if (fs.existsSync(path.join(ROOT, f))) payload[f] = fs.readFileSync(path.join(ROOT, f), 'utf8');
    if (!payload['bot.key']) throw new Error('No bot.key found next to the bot. Nothing to back up.');
    const p1 = await ask('Choose a backup password (12+ characters): ');
    if (p1.length < 12) throw new Error('Use at least 12 characters.');
    const p2 = await ask('Type it again: ');
    if (p1 !== p2) throw new Error('The two passwords did not match.');
    const box = encrypt(payload, p1);
    decrypt(box, p1); // prove it opens before writing
    fs.mkdirSync(path.join(ROOT, 'backups'), { recursive: true });
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '').replace(/^(\d{8})(\d{4})$/, '$1-$2');
    const out = path.join(ROOT, 'backups', `bot-backup-${stamp}.kcbak`);
    fs.writeFileSync(out, JSON.stringify(box, null, 1));
    console.log(`Backup written: ${out}\nCopy it to a USB stick. Keep the password somewhere else (a password manager).`);
  } else if (cmd === 'verify' || cmd === 'restore') {
    if (!file) throw new Error(`Usage: node src/backup.js ${cmd} <backup file>`);
    const box = JSON.parse(fs.readFileSync(file, 'utf8'));
    const payload = decrypt(box, await ask('Backup password: '));
    console.log(`Opened. Created ${box.created}. Contains: ${Object.keys(payload).join(', ')}`);
    if (cmd === 'restore') {
      for (const [f, body] of Object.entries(payload)) {
        const dest = path.join(ROOT, f);
        if (fs.existsSync(dest) && !force) { console.log(`Skipped ${f}: it already exists (add --force to overwrite).`); continue; }
        fs.writeFileSync(dest, body, { mode: 0o600 });
        console.log(`Restored ${f}`);
      }
    }
  } else {
    console.log('Usage: node src/backup.js create | verify <file> | restore <file> [--force]');
  }
}

if (require.main === module) main().catch(e => { console.error(e.message); process.exit(1); });
module.exports = { encrypt, decrypt };
