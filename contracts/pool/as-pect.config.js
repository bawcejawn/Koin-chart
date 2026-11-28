const path = require("path");
const { MockVM } = require("@koinos/mock-vm");

module.exports = {
  /**
   * A set of globs passed to the glob package that qualify typescript files for testing.
   */
  include: ["node_modules/@as-pect/assembly/assembly/index.ts"],
  /**
   * A set of globs passed to the glob package that quality files to be added to each test.
   */
  add: ["assembly/__tests__/**/*.include.ts"],
  /**
   * All the compiler flags needed for this test suite. Make sure that a binary file is output.
   */
  flags: {
    /** To output a wat file, uncomment the following line. */
    // "--textFile": ["output.wat"],
    /** A runtime must be provided here. */
    "--runtime": ["incremental"],
  },
  /**
   * A set of regexp that will disclude source files from testing.
   */
  disclude: [/node_modules/],
  /**
   * Add your required AssemblyScript imports here.
   */
  async instantiate(memory, createImports, instantiate, binary) {
    const mockVM = new MockVM();
    const myImports = {
      wasi_snapshot_preview1: { fd_write: () => {}, proc_exit: () => {} },
      env: { memory, ...mockVM.getImports() },
    };
    const instance = await instantiate(binary, createImports(myImports));
    instance.exports.memory.grow(512); // mock-vm keeps a view of memory; grow up front so it never goes stale
    mockVM.setInstance(instance);
    return instance;
  },
  // wasi: {
  //   // pass args here
  //   args: [],
  //   // inherit from env
  //   env: process.env,
  //   preopens: {
  //     // put your preopen's here
  //   },
  //   // let as-pect finish what it needs to finish
  //   returnOnExit: false,
  // },
  /** Enable code coverage. */
  coverage: [],
  /**
   * Specify if the binary wasm file should be written to the file system.
   */
  outputBinary: false,
};
