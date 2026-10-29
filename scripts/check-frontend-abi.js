// Verifies that frontend/abi.js matches the compiled contract and that the field names
// used by frontend/app.js exist. Run: npx hardhat run scripts/check-frontend-abi.js
const fs = require("fs");
const vm = require("vm");
const path = require("path");
const { ethers } = require("hardhat");

async function main() {
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../frontend/abi.js"), "utf8"), sandbox);
  const abi = sandbox.window.SUPPLY_CHAIN_ABI;

  const [admin, maker, dist] = await ethers.getSigners();
  const Factory = await ethers.getContractFactory("SupplyChainTracker");
  const deployed = await (await Factory.deploy()).waitForDeployment();
  const sc = new ethers.Contract(await deployed.getAddress(), abi, admin);

  await (await sc.setRole(maker.address, 1)).wait();
  await (await sc.setRole(dist.address, 2)).wait();
  await (await sc.connect(maker).registerProduct("Test", "B1", "QmCID", "Plant")).wait();
  await (await sc.connect(maker).shipProduct(1, dist.address, "Plant")).wait();

  const list = await sc.getProducts(1, await sc.productCount());
  const p = list[0];
  const fields = ["id", "name", "batchNumber", "metadataCID", "manufacturer", "currentOwner", "pendingOwner", "stage", "recalled", "createdAt", "updatedAt"];
  for (const f of fields) if (p[f] === undefined) throw new Error("Missing product field: " + f);
  const h = await sc.getHistory(1);
  for (const f of ["stage", "actor", "timestamp", "location", "note"]) if (h[0][f] === undefined) throw new Error("Missing record field: " + f);

  // error decoding used by the frontend
  const { decodeContractError } = require("../frontend/errors.js");
  const iface = new ethers.Interface(abi);
  try { await sc.connect(dist).registerProduct("x", "y", "", ""); throw new Error("should have reverted"); }
  catch (e) {
    const d = decodeContractError(iface, e);
    if (d?.name !== "MissingRole" || Number(d.args[0]) !== 1) throw new Error("Custom error not decoded: " + e.message);
  }
  // also check the message-only fallback path
  const d2 = decodeContractError(iface, { message: "reverted with custom error 'NotPendingOwner(7)'" });
  if (d2?.name !== "NotPendingOwner") throw new Error("Fallback decode failed");

  console.log("Frontend ABI OK: product + history field names and custom error decoding all match.");
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
