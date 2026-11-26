// KoinDX periphery (router) ABI, copied from app.koindx.com. Contract 17e1q6Fh5RgnuA8K7v4KvXXH4k9qHgsT5s.
window.PERIPHERY_ABI = {
  methods: {
    get_config: { argument: "periphery.get_config_arguments", return: "periphery.configs_object", description: "Get configs of protocol", entry_point: 3159346644, read_only: true },
    get_pair: { argument: "periphery.get_pair_arguments", return: "periphery.address", description: "get address of a pair", entry_point: 4024190401, read_only: true },
    add_liquidity: { argument: "periphery.add_liquidity_arguments", return: "periphery.add_liquidity_result", description: "Add liquidity to pair", entry_point: 117856717, read_only: false },
    remove_liquidity: { argument: "periphery.remove_liquidity_arguments", return: "periphery.remove_liquidity_result", description: "Remove liquidity from pair", entry_point: 650612145, read_only: false },
    swap_tokens_in: { argument: "periphery.swap_tokens_in_arguments", return: "periphery.empty_object", description: "Swap tokens with exact input", entry_point: 2335548678, read_only: false },
  },
  koilib_types: {
    nested: { periphery: { nested: {
      address: { fields: { value: { type: "bytes", id: 1, options: { "(koinos.btype)": "ADDRESS" } } } },
      empty_object: { fields: {} },
      configs_object: { fields: { feeOn: { type: "bool", id: 1 }, feeTo: { type: "bytes", id: 2, options: { "(koinos.btype)": "ADDRESS" } } } },
      get_config_arguments: { fields: {} },
      get_pair_arguments: { fields: { tokenA: { type: "string", id: 1 }, tokenB: { type: "string", id: 2 } } },
      add_liquidity_arguments: { fields: {
        from: { type: "bytes", id: 1, options: { "(koinos.btype)": "ADDRESS" } },
        receiver: { type: "bytes", id: 2, options: { "(koinos.btype)": "ADDRESS" } },
        tokenA: { type: "string", id: 3 }, tokenB: { type: "string", id: 4 },
        amountADesired: { type: "uint64", id: 5, options: { jstype: "JS_STRING" } },
        amountBDesired: { type: "uint64", id: 6, options: { jstype: "JS_STRING" } },
        amountAMin: { type: "uint64", id: 7, options: { jstype: "JS_STRING" } },
        amountBMin: { type: "uint64", id: 8, options: { jstype: "JS_STRING" } } } },
      add_liquidity_result: { fields: {
        liquidity: { type: "uint64", id: 1, options: { jstype: "JS_STRING" } },
        amountA: { type: "uint64", id: 2, options: { jstype: "JS_STRING" } },
        amountB: { type: "uint64", id: 3, options: { jstype: "JS_STRING" } } } },
      remove_liquidity_arguments: { fields: {
        from: { type: "bytes", id: 1, options: { "(koinos.btype)": "ADDRESS" } },
        receiver: { type: "bytes", id: 2, options: { "(koinos.btype)": "ADDRESS" } },
        tokenA: { type: "string", id: 3 }, tokenB: { type: "string", id: 4 },
        liquidity: { type: "uint64", id: 5, options: { jstype: "JS_STRING" } },
        amountAMin: { type: "uint64", id: 6, options: { jstype: "JS_STRING" } },
        amountBMin: { type: "uint64", id: 7, options: { jstype: "JS_STRING" } } } },
      remove_liquidity_result: { fields: {
        amountA: { type: "uint64", id: 1, options: { jstype: "JS_STRING" } },
        amountB: { type: "uint64", id: 2, options: { jstype: "JS_STRING" } } } },
      swap_tokens_in_arguments: { fields: {
        from: { type: "bytes", id: 1, options: { "(koinos.btype)": "ADDRESS" } },
        receiver: { type: "bytes", id: 2, options: { "(koinos.btype)": "ADDRESS" } },
        amountIn: { type: "uint64", id: 3, options: { jstype: "JS_STRING" } },
        amountOutMin: { type: "uint64", id: 4, options: { jstype: "JS_STRING" } },
        path: { rule: "repeated", type: "string", id: 5 } } },
    } } },
  },
};

// Minimal KCS token ABI (KOIN, VHP, LP tokens). Field layout checked against a real KoinDX approve operation.
window.TOKEN_ABI = {
  methods: {
    balanceOf: { argument: "token.balance_of_args", return: "token.uint64", entry_point: 0x5c721497, read_only: true },
    allowance: { argument: "token.allowance_args", return: "token.uint64", entry_point: 0x32f09fa1, read_only: true },
    approve: { argument: "token.approve_args", return: "token.empty", entry_point: 0x74e21680, read_only: false },
  },
  koilib_types: {
    nested: { token: { nested: {
      uint64: { fields: { value: { type: "uint64", id: 1, options: { jstype: "JS_STRING" } } } },
      empty: { fields: {} },
      balance_of_args: { fields: { owner: { type: "bytes", id: 1, options: { "(koinos.btype)": "ADDRESS" } } } },
      allowance_args: { fields: {
        owner: { type: "bytes", id: 1, options: { "(koinos.btype)": "ADDRESS" } },
        spender: { type: "bytes", id: 2, options: { "(koinos.btype)": "ADDRESS" } } } },
      approve_args: { fields: {
        owner: { type: "bytes", id: 1, options: { "(koinos.btype)": "ADDRESS" } },
        spender: { type: "bytes", id: 2, options: { "(koinos.btype)": "ADDRESS" } },
        value: { type: "uint64", id: 3, options: { jstype: "JS_STRING" } } } },
    } } },
  },
};
