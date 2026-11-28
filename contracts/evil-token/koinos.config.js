module.exports = {
  class: "Evil",
  version: "0.1.0",
  supportAbi1: true,
  proto: ["./proto/evil.proto"],
  files: ["./Evil.ts"],
  sourceDir: "./assembly",
  buildDir: "./build",
  protoImport: [
    { name: "@koinos/sdk-as", path: "./node_modules/koinos-precompiler-as/koinos-proto/koinos" },
    { name: "__", path: "./node_modules/koinos-precompiler-as/koinos-proto/google" },
  ],
};
