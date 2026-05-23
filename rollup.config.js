import resolve from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";

const external = [
  "@capacitor/core",
  "@capacitor/app",
  "@capacitor/browser",
  "@solana/wallet-adapter-base",
  "@solana/web3.js",
  "tweetnacl",
  "bs58",
];

export default [
  // CJS build
  {
    input: "src/index.ts",
    output: {
      file: "dist/index.js",
      format: "cjs",
      sourcemap: true,
      exports: "named",
    },
    external,
    plugins: [resolve(), typescript({ tsconfig: "./tsconfig.json", declaration: false })],
  },
  // ESM build
  {
    input: "src/index.ts",
    output: {
      file: "dist/index.esm.js",
      format: "esm",
      sourcemap: true,
    },
    external,
    plugins: [resolve(), typescript({ tsconfig: "./tsconfig.json", declaration: false })],
  },
];
