// Regenerates frontend/abi.js and frontend/bytecode.js from the compiled contract. Run via: npm run abi
const fs = require("fs");
const a = require("../artifacts/contracts/SupplyChainTracker.sol/SupplyChainTracker.json");
fs.writeFileSync(
  "frontend/abi.js",
  "// Auto-generated from the compiled contract. Re-generate with: npm run abi\nwindow.SUPPLY_CHAIN_ABI = " + JSON.stringify(a.abi, null, 2) + ";\n"
);
fs.writeFileSync(
  "frontend/bytecode.js",
  "// Auto-generated. Used by the standalone demo mode to deploy the contract in the browser.\nwindow.SUPPLY_CHAIN_BYTECODE = " + JSON.stringify(a.bytecode) + ";\n"
);
console.log("frontend/abi.js + bytecode.js updated (" + a.abi.length + " ABI entries)");
