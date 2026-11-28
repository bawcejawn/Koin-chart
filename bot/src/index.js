// Entry point: node src/index.js [--config path]
const fs = require('fs');
const path = require('path');
const { Bot } = require('./bot');

const argIdx = process.argv.indexOf('--config');
const cfgPath = argIdx > 0 ? process.argv[argIdx + 1] : path.join(__dirname, '..', 'config.json');
if (!fs.existsSync(cfgPath)) {
  console.error(`No config at ${cfgPath}. Copy config.example.json to config.json and edit it.`);
  process.exit(1);
}
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
if (cfg.mode === 'live' && !/^1[1-9A-HJ-NP-Za-km-z]{25,34}$/.test(cfg.producerAddress || '')) {
  console.error('producerAddress in config.json does not look like a Koinos address. Refusing to run live.');
  process.exit(1);
}
const bot = new Bot(cfg);
process.on('SIGINT', () => { console.log('summary', bot.summary()); process.exit(0); });
bot.run();
