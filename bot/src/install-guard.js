// Installs the Bot Guard on the bot's own address (run once, from the bot folder: install-guard.bat).
// The guard is koinosbox's SmartWalletAllowance contract (MIT, by Julian Gonzalez). After this, contracts can
// only move the bot's tokens with a one-time allowance the bot itself adds to each transaction.
// Upgrades or removal need the bot's key, same as today.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');
const { Provider, Contract } = require('koilib');
const { loadSigner, makeChain } = require('./chain');

const WASM = path.join(__dirname, '..', 'guard', 'bot-guard.wasm');
const ABI = require('../guard/bot-guard-abi.json');
const PINNED = 'ff6e6e153ff2ef1126ba379936f538dc077623feed8a46ff1544f28ec592eb16'; // sha256 of the reviewed build

(async () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config.json'), 'utf8'));
  const bytes = fs.readFileSync(WASM);
  const hash = crypto.createHash('sha256').update(bytes).digest('hex');
  if (hash !== PINNED) throw new Error(`guard/bot-guard.wasm does not match the reviewed build (${hash}). Not installing.`);
  const signer = loadSigner(fs.readFileSync(path.join(__dirname, '..', 'bot.key'), 'utf8').trim());
  const provider = new Provider(cfg.rpc);
  signer.provider = provider;
  const chain = makeChain(cfg.rpc);
  if (await chain.guardActive(signer.address)) { console.log(`The Bot Guard is already on for ${signer.address}.`); return; }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ans = await new Promise(r => rl.question(`Install the Bot Guard on ${signer.address}? Type YES to continue: `, r));
  rl.close();
  if (ans.trim() !== 'YES') { console.log('Cancelled.'); return; }
  const c = new Contract({ id: signer.address, abi: ABI, provider, signer, bytecode: bytes });
  const { transaction } = await c.deploy({ abi: JSON.stringify(ABI), authorizesCallContract: true, authorizesTransactionApplication: true, authorizesUploadContract: true, rcLimit: '1000000000' });
  console.log('Sent', transaction.id, '- waiting for the block...');
  await transaction.wait('byBlock', 120000);
  console.log((await chain.guardActive(signer.address)) ? 'Bot Guard is ON.' : 'Sent, but the guard does not show as active yet. Run this again in a minute to check.');
})().catch(e => { console.error(e.message); process.exit(1); });
