// Creates a brand-new wallet just for the bot and saves its key to bot.key (never commit this file).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Signer } = require('koilib');

const keyFile = path.join(__dirname, '..', 'bot.key');
if (fs.existsSync(keyFile)) {
  const s = Signer.fromWif(fs.readFileSync(keyFile, 'utf8').trim());
  console.log('A bot key already exists. Bot address:', s.getAddress());
  process.exit(0);
}
const signer = new Signer({ privateKey: crypto.randomBytes(32).toString('hex') });
fs.writeFileSync(keyFile, signer.getPrivateKey('wif') + '\n', { mode: 0o600 });
console.log('New bot wallet created.');
console.log('Bot address (send KOIN here):', signer.getAddress());
console.log(`Private key saved to ${keyFile}. Back it up somewhere safe and never share or commit it.`);
