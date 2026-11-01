// End-to-end test of the real frontend files in a simulated browser (jsdom) with a mock MetaMask
// that forwards to a local Hardhat node (unlocked accounts).
//   Terminal 1: npx hardhat node
//   Terminal 2: npx hardhat run scripts/deploy.js --network localhost   (note the address)
//   Terminal 3: node scripts/e2e-frontend.js <contractAddress>
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const RPC = "http://127.0.0.1:8545";
const ADDR = process.argv[2];
if (!ADDR) { console.error("usage: node scripts/e2e-frontend.js <contractAddress>"); process.exit(1); }

const ACCOUNTS = [
  "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266", // admin
  "0x70997970C51812dc3A010C7d01b50e0d17dc79C8", // manufacturer
  "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC", // distributor
  "0x90F79bf6EB2c4f870365E785982E1f101E93b906", // retailer
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let rpcId = 1;

async function rpc(method, params) {
  const res = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: rpcId++, method, params }) });
  const j = await res.json();
  if (j.error) { const e = new Error(j.error.message); e.code = j.error.code; e.data = j.error.data; throw e; }
  return j.result;
}

async function openPage(accountIndex) {
  const dir = path.join(__dirname, "../frontend");
  const html = fs.readFileSync(path.join(dir, "index.html"), "utf8").replace(/<script src="[^"]+"><\/script>/g, "");
  const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true, url: "http://localhost:8080/" });
  const { window } = dom;
  window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  window.HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
  window.fetch = fetch; window.TextEncoder = TextEncoder; window.TextDecoder = TextDecoder;
  window.confirm = () => true;
  // the app starts in wallet mode when this session flag is set, and loads the saved contract address
  window.sessionStorage.setItem("chaintrace.net", "wallet");
  window.localStorage.setItem("chaintrace.address", ADDR);
  const errors = [];
  window.addEventListener("error", (e) => errors.push(e.message));
  window.ethereum = {
    request: async ({ method, params = [] }) => {
      if (method === "eth_requestAccounts" || method === "eth_accounts") return [ACCOUNTS[accountIndex]];
      if (method === "eth_sendTransaction") params = [{ ...params[0], from: ACCOUNTS[accountIndex] }];
      return rpc(method, params);
    },
    on() {},
  };
  for (const f of ["ethers.umd.min.js", "abi.js", "icons.js", "errors.js", "app.js"]) window.eval(fs.readFileSync(path.join(dir, f), "utf8"));
  return { window, doc: window.document, errors };
}

async function waitFor(fn, label, ms = 15000) {
  const t = Date.now();
  while (Date.now() - t < ms) { try { if (await fn()) return; } catch (_) {} await sleep(150); }
  throw new Error("Timed out waiting for: " + label);
}
const ok = (c, m) => { if (!c) throw new Error("FAILED: " + m); console.log("  ok -", m); };

async function main() {
  console.log("Persona 1: Admin");
  let { doc, errors } = await openPage(0);
  await waitFor(() => !doc.getElementById("app").classList.contains("hidden") && doc.querySelectorAll("#productRows .pcard").length >= 2, "products loaded");
  ok(doc.getElementById("roleBadge").textContent.includes("Admin"), "admin badge shown");
  ok(doc.getElementById("statTotal").textContent === "2", "2 products listed");
  ok(doc.getElementById("statSold").textContent === "1", "1 sold product counted");

  const sel = doc.getElementById("trackSel");
  sel.value = "1";
  sel.dispatchEvent(new doc.defaultView.Event("change"));
  await waitFor(() => doc.querySelectorAll(".timeline li").length === 6, "timeline of 6 records");
  ok(true, "tracking shows full 6-step journey for product #1");

  console.log("Persona 2: Manufacturer registers a product through the form");
  ({ doc, errors } = await openPage(1));
  await waitFor(() => doc.getElementById("roleBadge").textContent.includes("Manufacturer") && doc.getElementById("statTotal").textContent !== "0", "manufacturer loaded");
  doc.getElementById("regName").value = "Test Tea 100g";
  doc.getElementById("regBatch").value = "BATCH-E2E";
  doc.getElementById("regLoc").value = "Munnar";
  doc.getElementById("regBtn").click();
  await waitFor(() => doc.getElementById("statTotal").textContent === "3", "product #3 registered via UI");
  ok(true, "Register form created product #3 on-chain");

  console.log("Persona 3: Distributor receives the in-transit product #2 via the Receive button");
  ({ doc, errors } = await openPage(2));
  await waitFor(() => doc.querySelector('button[data-act="receive"]'), "Receive button visible");
  doc.querySelector('button[data-act="receive"]').click();
  await waitFor(() => doc.getElementById("dlg").hasAttribute("open"), "dialog opened");
  doc.querySelector("#dlgFields input").value = "Mysuru Hub";
  doc.getElementById("dlgOk").click();
  await waitFor(() => !doc.querySelector('button[data-act="receive"]'), "product received, button gone");
  ok(true, "Receive flow works (dialog -> tx -> UI refresh)");

  console.log("Persona 4: Retailer without stock sees a readable error when forced to act wrongly");
  ({ doc, errors } = await openPage(3));
  await waitFor(() => doc.getElementById("roleBadge").textContent.includes("Retailer"), "retailer loaded");
  doc.getElementById("regName").value = "x"; doc.getElementById("regBatch").value = "y";
  doc.getElementById("regBtn").click();
  await waitFor(() => /Manufacturer role/.test(doc.getElementById("toast").textContent), "friendly MissingRole message");
  ok(true, "Unauthorized action shows: " + doc.getElementById("toast").textContent);

  ok(errors.length === 0, "no uncaught page errors (" + errors.join("; ") + ")");
  console.log("\nAll frontend end-to-end checks passed.");
}
main().then(() => process.exit(0)).catch((e) => { console.error("\n" + e.message); process.exit(1); });
