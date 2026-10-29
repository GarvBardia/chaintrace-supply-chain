// Optional: deploy + seed demo data on a local Hardhat node.
//   Terminal 1:  npx hardhat node
//   Terminal 2:  npx hardhat run scripts/deploy.js --network localhost
// Not needed if you deploy from Remix.
const { ethers } = require("hardhat");

async function main() {
  const [admin, maker, dist, retail] = await ethers.getSigners();
  const sc = await (await ethers.getContractFactory("SupplyChainTracker")).deploy();
  await sc.waitForDeployment();
  const addr = await sc.getAddress();

  await (await sc.setRole(maker.address, 1)).wait();
  await (await sc.setRole(dist.address, 2)).wait();
  await (await sc.setRole(retail.address, 3)).wait();

  // Demo product 1: fully delivered and sold
  await (await sc.connect(maker).registerProduct("Organic Coffee 250g", "BATCH-001", "", "Coorg Estate")).wait();
  await (await sc.connect(maker).shipProduct(1, dist.address, "Coorg Estate")).wait();
  await (await sc.connect(dist).receiveProduct(1, "Mysuru Hub")).wait();
  await (await sc.connect(dist).shipProduct(1, retail.address, "Mysuru Hub")).wait();
  await (await sc.connect(retail).receiveProduct(1, "Store #12, Bengaluru")).wait();
  await (await sc.connect(retail).markSold(1, "Store #12, Bengaluru")).wait();

  // Demo product 2: waiting at the distributor
  await (await sc.connect(maker).registerProduct("Cold-Press Olive Oil 1L", "BATCH-002", "", "Kochi Plant")).wait();
  await (await sc.connect(maker).shipProduct(2, dist.address, "Kochi Plant")).wait();

  console.log("\nSupplyChainTracker deployed to:", addr);
  console.log("\nDemo accounts (Hardhat node default accounts):");
  console.log("  Admin        ", admin.address, "(account #0)");
  console.log("  Manufacturer ", maker.address, "(account #1)");
  console.log("  Distributor  ", dist.address, "(account #2)");
  console.log("  Retailer     ", retail.address, "(account #3)");
  console.log("\nProduct #1 is Sold, product #2 is in transit to the distributor (they can press Receive).");
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
