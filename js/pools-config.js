// Settings for the pools page. After the pool contract is deployed, put its address in `contract`
// (and the owner's address in `owner`). Everything else updates itself from the chain.
// For testing you can also open pools.html?contract=<address>&rpc=<url>.
window.POOLS_CONFIG = {
  network: 'mainnet',
  rpc: 'https://api.koinos.io',
  contract: '',            // pool contract address (empty = not deployed yet)
  owner: '1DAHmrQJMAbn4FmMMrew78wPUizjVdbBrd', // shown as the pool operator; the contract itself decides who the owner is
  explorer: 'https://koinosblocks.com/tx/',
  tokens: [
    { sym: 'KOIN', id: '19GYjDBVXU7keLbYvMLazsGQn3GTWHjHkK', dec: 8 },
    { sym: 'vETH', id: '1Tf1QKv3gVYLjq34yURSHw5ErTYbFjqTG', dec: 8 },
    { sym: 'vUSDT', id: '12VoHz41a4HtfiyhTWbg9RXqGMRbYk6pXh', dec: 8, usd: 1 },
    { sym: 'vUSDC', id: '1N8iYrYEJdCVK1rhbqv3qZUzHcpoeKmFnj', dec: 8, usd: 1 },
  ],
  // the pools the page looks for (fee comes from the chain)
  pairs: [
    ['KOIN', 'vETH'], ['KOIN', 'vUSDT'], ['KOIN', 'vUSDC'],
    ['vETH', 'vUSDT'], ['vETH', 'vUSDC'], ['vUSDT', 'vUSDC'],
  ],
  koinUsdPool: '1E8AjPZxKLJGFouXtNNkPcYxAgsTh4AUTN', // KoinDX KOIN/vUSDT, for USD values
};
