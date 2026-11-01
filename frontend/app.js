/* ChainTrace frontend - ethers v6 + MetaMask. No build step needed. */
(() => {
  const STAGES = [
    "Manufactured",
    "Shipped to distributor",
    "At distributor",
    "Shipped to retailer",
    "At retailer",
    "Sold",
  ];
  const ROLES = ["None", "Manufacturer", "Distributor", "Retailer"];
  const NETWORKS = { 1: "Ethereum", 11155111: "Sepolia", 17000: "Holesky", 31337: "Local (Hardhat)", 1337: "Local", 5777: "Ganache" };

  // ---------- presentation data ----------
  const STEPS = [
    { l: "Made", i: "factory" },
    { l: "Shipped", i: "truck" },
    { l: "Distributor", i: "warehouse" },
    { l: "Shipped", i: "truck" },
    { l: "Retailer", i: "storefront" },
    { l: "Sold", i: "bag" },
  ];
  const TL_TITLES = ["Manufactured", "Shipped to distributor", "Received by distributor", "Shipped to retailer", "Received by retailer", "Sold to customer"];
  const KEYS = ["", "manufacturer", "distributor", "retailer"];
  const ROLE_META = {
    admin: { label: "Admin", icon: "crown", can: "Assign roles, pause the contract, recall any product." },
    manufacturer: { label: "Manufacturer", icon: "factory", can: "Register products, ship to a distributor, recall own products." },
    distributor: { label: "Distributor", icon: "warehouse", can: "Receive from a manufacturer, ship on to a retailer." },
    retailer: { label: "Retailer", icon: "storefront", can: "Receive from a distributor, mark products as sold." },
    visitor: { label: "Visitor", icon: "eye", can: "View and track any product. Read-only." },
  };
  const PERSONAS = [
    { key: "admin", label: "Admin" },
    { key: "manufacturer", label: "Manufacturer" },
    { key: "distributor", label: "Distributor" },
    { key: "retailer", label: "Retailer" },
    { key: "visitor", label: "Visitor" },
  ];
  const FILTERS = [
    { id: "all", label: "All", test: () => true },
    { id: "made", label: "Manufactured", test: (p) => !p.recalled && p.stage === 0 },
    { id: "transit", label: "In transit", test: (p) => !p.recalled && (p.stage === 1 || p.stage === 3) },
    { id: "dist", label: "At distributor", test: (p) => !p.recalled && p.stage === 2 },
    { id: "ret", label: "At retailer", test: (p) => !p.recalled && p.stage === 4 },
    { id: "sold", label: "Sold", test: (p) => !p.recalled && p.stage === 5 },
    { id: "recalled", label: "Recalled", test: (p) => p.recalled },
  ];

  // What each contract call does, in one line (used in tooltips, dialogs and the transaction detail).
  const FN = {
    registerProduct: "Creates the product, stores its first history record and emits ProductRegistered.",
    shipProduct: "Marks the product as in transit and names the recipient as pending owner. The sender stays owner until the recipient confirms.",
    receiveProduct: "The pending owner confirms arrival, becomes the owner and the stage moves forward.",
    cancelShipment: "The sender takes the product back before the recipient has confirmed it.",
    markSold: "The retailer closes the journey. The product reaches its final stage.",
    recallProduct: "Permanently flags the product as recalled and stores the reason. A recalled product is frozen.",
    setRole: "Admin only. Writes a role for an address into the contract, so later calls can check who may do what.",
    pause: "Admin only. Flips a switch in the contract: while paused, every state-changing call is rejected.",
    unpause: "Admin only. Switches the contract back on after a pause.",
    transferAdmin: "Admin only. Hands the admin rights to another address.",
    deploy: "Creates the SupplyChainTracker contract on the chain. It happens once.",
  };
  const COST = " It is a transaction, so it is mined into a block and costs gas.";

  const REG_SAMPLES = [
    { name: "Organic Coffee 250g", batch: "BATCH-2026-001", loc: "Coorg Estate, Karnataka", cid: "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG" },
    { name: "Cold-Press Olive Oil 1L", batch: "BATCH-2026-002", loc: "Kochi Plant, Kerala", cid: "QmT78zSuBmuS4z925WZfrqQ1qHaJ56DQaTfyMUF7F8ff5o" },
    { name: "Basmati Rice 5kg", batch: "BATCH-2026-003", loc: "Karnal Mill, Haryana", cid: "QmRAQB6YaCyidP37UdDnjFY5vQuiBrcqdyoW1CuDgwxkD4" },
    { name: "Paracetamol 500mg Strips (cold chain)", batch: "BATCH-PH-2026-104", loc: "Hyderabad Pharma Park", cid: "QmNLei78zWmzUdbeRB3CiUfAizWUrbeeZh5K1rhAQKCh51" },
    { name: "Cotton T-Shirt Lot (500 pcs)", batch: "BATCH-TX-2026-077", loc: "Tiruppur Garment Unit", cid: "QmZ4tDuvesekSs4qM5ZBKpXiZGun7S2CYtEZRB3DYXkjGx" },
    { name: "Lithium Battery Pack 48V", batch: "BATCH-EV-2026-019", loc: "Pune Cell Assembly", cid: "QmPZ9gcCEpqKTo6aq61g2nXGUhM4iCL3ewB6LDXZCtioEB" },
  ];
  const LOCS = ["Warehouse", "Port", "Distribution Hub", "Store #12"];
  const SOLD_LOCS = ["Store #12", "Store #7, City Mall", "Online fulfilment centre"];
  const REASONS = ["Quality defect", "Contamination", "Regulatory order", "Temperature excursion (cold chain)", "Counterfeit suspected"];
  const ADMIN_SAMPLES = [
    { label: "Make the Visitor a Retailer", acct: 4, role: 3 },
    { label: "Make the Visitor a Distributor", acct: 4, role: 2 },
    { label: "Make the Visitor a Manufacturer", acct: 4, role: 1 },
    { label: "Revoke the Distributor", acct: 2, role: 0 },
  ];

  const $ = (id) => document.getElementById(id);
  const short = (a) => (a && a !== ethers.ZeroAddress ? a.slice(0, 6) + "..." + a.slice(-4) : "-");
  const shortHash = (h) => (h ? h.slice(0, 10) + "..." + h.slice(-6) : "-");
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmtTime = (t) => new Date(Number(t) * 1000).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
  const lc = (a) => String(a || "").toLowerCase();

  const ICONS = window.ICONS || {};
  const icon = (n) => `<svg class="ic" viewBox="0 0 256 256" aria-hidden="true" focusable="false">${ICONS[n] || ""}</svg>`;
  const ico = (n) => `<span class="ico" aria-hidden="true">${icon(n)}</span>`;
  function hydrateIcons(root = document) {
    root.querySelectorAll("[data-icon]").forEach((el) => { el.innerHTML = icon(el.dataset.icon); });
  }
  const tip = (fn, titleText) => `<button type="button" class="tip" data-tip="${esc(FN[fn])}" data-tipt="${esc(titleText || fn + "()")}" aria-label="What is happening on-chain: ${esc(FN[fn])}">${ico("info")}</button>`;

  let provider, signer, account, contract, contractAddr = "";
  let me = { role: 0, isAdmin: false };
  let adminAddr = "";
  let products = [];
  let loaded = false;
  let filter = "all";
  let query = "";
  let personaIdx = 1;
  let netName = "";
  let demo = null; // set when running on the built-in in-browser blockchain
  const roleOf = new Map(); // lowercase address -> role key, refreshed on every data load
  const seenIds = new Set();

  // ---------- UI helpers ----------
  function toast(msg, kind = "ok", ms = 4500) {
    const host = $("toast");
    const el = document.createElement("div");
    el.className = "toast " + kind;
    el.innerHTML = ico(kind === "err" ? "warning-octagon" : kind === "info" ? "info" : "check-circle") + `<span></span>`;
    el.lastChild.textContent = msg;
    host.appendChild(el);
    while (host.children.length > 3) host.firstChild.remove();
    el._t = setTimeout(() => dismiss(el), ms);
    return el;
  }
  function dismiss(el) {
    if (!el || !el.parentNode) return;
    clearTimeout(el._t);
    el.classList.add("out");
    setTimeout(() => el.remove(), 320);
  }

  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); }
    catch (_) {
      const ta = document.createElement("textarea");
      ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); } catch (__) {}
      ta.remove();
    }
  }

  // Interface used to decode revert data and transactions (available even before a contract is loaded).
  const IFACE = new ethers.Interface(window.SUPPLY_CHAIN_ABI);

  // Turn contract custom errors into readable text.
  function explain(err) {
    const decoded = window.decodeContractError(IFACE, err);
    const name = decoded?.name;
    const args = decoded?.args || [];
    const map = {
      NotAdmin: "Only the admin can do this.",
      MissingRole: () => `Your account needs the ${ROLES[Number(args[0])] || "required"} role.`,
      ContractPaused: "The contract is paused by the admin.",
      ProductNotFound: "That product does not exist.",
      NotCurrentOwner: "You are not the current holder of this product.",
      NotPendingOwner: "This shipment is not addressed to your account.",
      InvalidStage: "The product is not in the right stage for this action.",
      ProductIsRecalled: "This product has been recalled and is frozen.",
      ZeroAddress: "Address cannot be empty.",
      EmptyInput: "A required field is empty.",
      WrongRecipientRole: () => `The recipient must have the ${ROLES[Number(args[0])] || "right"} role.`,
      NotAllowedToRecall: "Only the manufacturer or admin can recall.",
      AlreadyRecalled: "Already recalled.",
    };
    if (name && map[name]) return typeof map[name] === "function" ? map[name]() : map[name];
    if (err?.code === "ACTION_REJECTED" || err?.code === 4001) return "Transaction rejected in MetaMask.";
    return err?.shortMessage || err?.reason || err?.message || String(err);
  }

  // ---------- dialog (forms + details). Opening pushes a history entry so Back closes it. ----------
  let dlgOpen = false, dlgSettle = null, skipPop = 0, popDone = null;

  window.addEventListener("popstate", () => {
    if (skipPop > 0) { skipPop--; if (popDone) { popDone(); popDone = null; } return; }
    if (dlgOpen && dlgSettle) dlgSettle(false, true);
  });

  // fields: {type:"text"|"select", label, placeholder, mono, value, options:[{label,value}], other}
  // samples: [{label, values:{fieldIndex: value}}]  ->  "Fill sample" dropdown at the top of the form
  function openDialog({ title, hint, fields = [], samples = null, okLabel = "Confirm", info = null, wide = false, closeOnly = false }) {
    return new Promise((resolve) => {
      const dlg = $("dlg");
      $("dlgTitle").textContent = title;
      const h = $("dlgHint");
      h.classList.toggle("hidden", !hint);
      h.innerHTML = hint ? ico("info") + `<span>${esc(hint)}</span>` : "";
      dlg.classList.toggle("wide", !!wide);

      const sampleHtml = samples
        ? `<label><span class="lbl">Fill sample</span><select data-sample><option value="">Choose a sample...</option>${samples.map((s, i) => `<option value="${i}">${esc(s.label)}</option>`).join("")}</select></label>`
        : "";
      const fieldHtml = fields.map((f, i) => {
        if (f.type === "select") {
          const opts = (f.options || []).map((o) => `<option value="${esc(o.value)}"${o.value === f.value ? " selected" : ""}>${esc(o.label)}</option>`).join("");
          return `<div data-f="${i}"><span class="lbl">${esc(f.label)}</span><select data-sel>${opts}${f.other ? `<option value="__other">Other address...</option>` : ""}</select>${f.other ? `<input data-other class="mono hidden" placeholder="0x..." autocomplete="off" spellcheck="false">` : ""}</div>`;
        }
        return `<label data-f="${i}"><span class="lbl">${esc(f.label)}</span><input data-in class="${f.mono ? "mono" : ""}" placeholder="${esc(f.placeholder || "")}" value="${esc(f.value || "")}" autocomplete="off" spellcheck="false"></label>`;
      }).join("");
      $("dlgFields").innerHTML = sampleHtml + fieldHtml + (info || "");

      const box = $("dlgFields");
      const fieldEl = (i) => box.querySelector(`[data-f="${i}"]`);
      box.onchange = (e) => {
        const t = e.target;
        if (t.matches("[data-sample]")) {
          const s = samples[Number(t.value)];
          if (!s) return;
          for (const [i, v] of Object.entries(s.values)) {
            const el = fieldEl(i);
            const inp = el?.querySelector("[data-in]");
            if (inp) inp.value = v;
          }
        }
        if (t.matches("[data-sel]")) {
          const o = t.parentElement.querySelector("[data-other]");
          if (o) { o.classList.toggle("hidden", t.value !== "__other"); if (t.value === "__other") o.focus(); }
        }
      };

      $("dlgCancel").classList.toggle("hidden", closeOnly);
      $("dlgOk").textContent = okLabel;

      let settled = false;
      const done = async (ok, fromPop) => {
        if (settled) return;
        settled = true;
        const vals = ok
          ? fields.map((f, i) => {
              const el = fieldEl(i);
              if (f.type === "select") {
                const s = el.querySelector("[data-sel]");
                return s.value === "__other" ? el.querySelector("[data-other]").value.trim() : s.value;
              }
              return el.querySelector("[data-in]").value.trim();
            })
          : null;
        dlgOpen = false;
        dlgSettle = null;
        if (dlg.hasAttribute("open")) dlg.close();
        dlg.onclose = null; dlg.oncancel = null;
        if (!fromPop) {
          // remove the history entry that was pushed when the dialog opened, and wait until that is done
          await new Promise((r) => { skipPop++; popDone = r; history.back(); setTimeout(() => { if (popDone === r) { popDone = null; skipPop = Math.max(0, skipPop - 1); } r(); }, 500); });
        }
        resolve(vals);
      };
      $("dlgOk").onclick = (e) => { e.preventDefault(); done(true); };
      $("dlgCancel").onclick = (e) => { e.preventDefault(); done(false); };
      dlg.oncancel = (e) => { e.preventDefault(); done(false); };
      dlgSettle = done;
      dlgOpen = true;
      history.pushState({ dlg: 1 }, "", location.href);
      dlg.showModal();
    });
  }

  async function sendTx(label, fn) {
    let pending = null;
    try {
      pending = toast(demo ? `${label}: sending...` : `${label}: confirm in MetaMask...`, "info", 60000);
      const tx = await fn();
      dismiss(pending);
      pending = toast(`${label}: waiting for the block...`, "info", 60000);
      await tx.wait();
      dismiss(pending);
      toast(`${label} confirmed.`, "ok");
      await refreshAll();
      return true;
    } catch (e) {
      console.error(e);
      dismiss(pending);
      toast(`${label} failed: ${explain(e)}`, "err", 8000);
      return false;
    }
  }

  // ---------- routing: #/products #/register #/track #/track/3 #/blocks #/admin ----------
  const TABS = ["products", "register", "track", "blocks", "admin"];
  function parseHash() {
    const m = location.hash.replace(/^#\/?/, "").split("/");
    return { tab: TABS.includes(m[0]) ? m[0] : "products", id: m[1] && /^\d+$/.test(m[1]) ? Number(m[1]) : null };
  }
  function go(path) {
    const h = "#" + path;
    if (location.hash === h) route();
    else location.hash = h; // pushes a history entry; hashchange renders it
  }
  function showTab(name) {
    document.querySelectorAll(".tab").forEach((t) => {
      const on = t.dataset.tab === name;
      t.classList.toggle("active", on);
      t.setAttribute("aria-selected", on);
      t.tabIndex = on ? 0 : -1;
    });
    document.querySelectorAll(".panel").forEach((p) => p.classList.toggle("hidden", p.id !== "tab-" + name));
  }
  function route() {
    const { tab, id } = parseHash();
    showTab(tab);
    if (tab === "track") renderTrackRoute(id);
    if (tab === "blocks") loadBlocks();
  }
  window.addEventListener("hashchange", route);

  // ---------- Wallet / contract ----------
  const ssGet = (k) => { try { return sessionStorage.getItem(k); } catch (_) { return null; } };
  const ssSet = (k, v) => { try { v === null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, v); } catch (_) {} };
  function lsGet(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (_) {} }

  async function connect() {
    if (!window.ethereum) {
      toast("MetaMask not found. Using the simulated chain instead.", "err", 7000);
      return false;
    }
    try {
      provider = new ethers.BrowserProvider(window.ethereum);
      await provider.send("eth_requestAccounts", []);
      signer = await provider.getSigner();
      account = await signer.getAddress();
      showAccount();
      await showNetwork();
      window.ethereum.on?.("accountsChanged", () => location.reload());
      window.ethereum.on?.("chainChanged", () => location.reload());
      const saved = lsGet("chaintrace.address");
      if (saved && !$("addrInput").value) $("addrInput").value = saved;
      initPickers();
      $("setup").classList.toggle("hidden", !!$("addrInput").value);
      if ($("addrInput").value) await loadContract();
      else { $("app").classList.remove("booting"); updateStatus(); }
      return true;
    } catch (e) {
      toast(explain(e), "err");
      return false;
    }
  }

  function showAccount() {
    $("acct").textContent = short(account);
    $("acctBtn").classList.remove("hidden");
  }

  // ---------- Simulated chain: a private blockchain running inside this page ----------
  async function startDemo() {
    if (!window.Ganache || !window.SUPPLY_CHAIN_BYTECODE) {
      toast("The simulated chain is only in the standalone file. Use your wallet instead.", "err", 8000);
      return false;
    }
    renderProducts();
    await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 40)));
    try {
      const chain = window.Ganache.provider({
        wallet: { totalAccounts: 5, deterministic: true },
        chain: { chainId: 1337 },
        logging: { quiet: true },
      });
      const accts = await chain.request({ method: "eth_accounts", params: [] });
      let idx = 0;
      const shim = {
        isDemo: true,
        request: async ({ method, params }) => {
          if (method === "eth_requestAccounts" || method === "eth_accounts") return [accts[idx]];
          if (method === "eth_estimateGas") {
            // the in-browser chain can slightly under-estimate gas, so add a 30% safety margin
            const est = BigInt(await chain.request({ method, params }));
            return "0x" + ((est * 13n) / 10n).toString(16);
          }
          return chain.request({ method, params });
        },
        on() {},
      };
      window.ethereum = shim; // from here on the page behaves exactly as if MetaMask were connected

      provider = new ethers.BrowserProvider(shim);
      signer = await provider.getSigner();
      const factory = new ethers.ContractFactory(window.SUPPLY_CHAIN_ABI, window.SUPPLY_CHAIN_BYTECODE, signer);
      const sc = await factory.deploy();
      await sc.waitForDeployment();
      const addr = await sc.getAddress();

      // roles + a little sample data so the page is not empty
      const as = async (i, fn) => { idx = i; const s = await provider.getSigner(); return (await fn(sc.connect(s))).wait(); };
      await as(0, (c) => c.setRole(accts[1], 1));
      await as(0, (c) => c.setRole(accts[2], 2));
      await as(0, (c) => c.setRole(accts[3], 3));
      await as(1, (c) => c.registerProduct("Organic Coffee 250g", "BATCH-001", "", "Coorg Estate"));
      await as(1, (c) => c.shipProduct(1, accts[2], "Coorg Estate"));
      await as(2, (c) => c.receiveProduct(1, "Mysuru Hub"));
      await as(2, (c) => c.shipProduct(1, accts[3], "Mysuru Hub"));
      await as(3, (c) => c.receiveProduct(1, "Store #12, Bengaluru"));
      await as(3, (c) => c.markSold(1, "Store #12, Bengaluru"));
      await as(1, (c) => c.registerProduct("Cold-Press Olive Oil 1L", "BATCH-002", "", "Kochi Plant"));
      await as(1, (c) => c.shipProduct(2, accts[2], "Kochi Plant"));
      idx = personaIdx; // start as the Manufacturer so the first actions are available

      demo = { accts, setIdx: (i) => (idx = i) };
      signer = await provider.getSigner();
      account = await signer.getAddress();
      showAccount();
      $("addrInput").value = addr;

      buildRoleSwitch();
      $("roleSwitchWrap").classList.remove("hidden");
      initPickers();
      await showNetwork();
      await loadContract();
      return true;
    } catch (e) {
      console.error(e);
      $("app").classList.remove("booting");
      toast("Could not start the simulated chain: " + explain(e), "err", 9000);
      return false;
    }
  }

  function buildRoleSwitch() {
    const sw = $("roleSwitch");
    sw.innerHTML = PERSONAS.map((p, i) => {
      const m = ROLE_META[p.key];
      return `<button type="button" class="seg-btn role-${p.key}" role="radio" aria-checked="${i === personaIdx}" tabindex="${i === personaIdx ? 0 : -1}" data-i="${i}" data-key="${p.key}">${ico(m.icon)}${m.label}</button>`;
    }).join("");
    sw.onclick = (e) => {
      const b = e.target.closest(".seg-btn");
      if (b) switchPersona(Number(b.dataset.i));
    };
    sw.onkeydown = (e) => {
      const dir = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      if (!dir) return;
      e.preventDefault();
      const n = (personaIdx + dir + PERSONAS.length) % PERSONAS.length;
      switchPersona(n).then(() => sw.querySelector(`[data-i="${n}"]`)?.focus());
    };
  }
  function markPersona() {
    document.querySelectorAll("#roleSwitch .seg-btn").forEach((b) => {
      const on = Number(b.dataset.i) === personaIdx;
      b.setAttribute("aria-checked", on);
      b.tabIndex = on ? 0 : -1;
    });
  }

  let switching = false;
  async function switchPersona(i) {
    if (!demo || switching || i === personaIdx) return;
    switching = true;
    try {
      personaIdx = i;
      demo.setIdx(i);
      markPersona();
      signer = await provider.getSigner();
      account = await signer.getAddress();
      contract = contract.connect(signer);
      showAccount();
      await refreshAll();
      toast(`Now acting as ${PERSONAS[i].label}.`, "info", 2200);
    } catch (e) {
      toast(explain(e), "err");
    } finally {
      switching = false;
    }
  }

  async function showNetwork() {
    const net = await provider.getNetwork();
    netName = demo || window.ethereum?.isDemo ? "Simulated chain" : NETWORKS[Number(net.chainId)] || `Chain ${net.chainId}`;
    $("stNet").textContent = netName;
  }

  async function updateStatus() {
    try { $("stBlock").textContent = "#" + (await provider.getBlockNumber()); } catch (_) {}
    if (netName) $("stNet").textContent = netName;
    const a = $("stAddr");
    a.textContent = contractAddr ? short(contractAddr) : "not loaded";
    a.disabled = !contractAddr;
    $("stChange").classList.toggle("hidden", !!demo || !contractAddr);
  }

  async function loadContract() {
    const addr = $("addrInput").value.trim();
    const msg = $("setupMsg");
    if (!signer) return toast("Connect your wallet first.", "err");
    if (!ethers.isAddress(addr)) { msg.textContent = "That is not a valid address."; msg.className = "small err-text"; return; }
    try {
      const code = await provider.getCode(addr);
      if (code === "0x") throw new Error("No contract at this address on the selected network. Check the network in MetaMask.");
      contract = new ethers.Contract(addr, window.SUPPLY_CHAIN_ABI, signer);
      contractAddr = addr;
      await contract.admin(); // sanity check that the ABI matches
      if (!demo) lsSet("chaintrace.address", addr);
      msg.textContent = "";
      $("setup").classList.add("hidden");
      await refreshAll();
      $("app").classList.remove("booting");
      subscribe();
      route();
    } catch (e) {
      msg.textContent = explain(e);
      msg.className = "small err-text";
      $("setup").classList.remove("hidden");
      $("app").classList.remove("booting");
    }
  }

  let subscribed = false;
  function subscribe() {
    if (subscribed) return;
    subscribed = true;
    // Live refresh when anything happens on the contract (from any user).
    for (const ev of ["ProductRegistered", "ProductShipped", "ProductReceived", "ShipmentCancelled", "ProductSold", "ProductRecalled", "RoleUpdated", "Paused", "Unpaused"]) {
      contract.on(ev, () => { clearTimeout(subscribe._t); subscribe._t = setTimeout(refreshAll, 800); });
    }
  }

  // ---------- Data ----------
  const ensureRoles = (addrs) => Promise.all([...new Set(addrs.filter((a) => a && a !== ethers.ZeroAddress).map(lc))].filter((a) => !roleOf.has(a)).map(async (a) => {
    let r = 0;
    try { r = Number(await contract.roles(a)); } catch (_) {}
    roleOf.set(a, r ? KEYS[r] : lc(adminAddr) === a ? "admin" : "");
  }));

  async function refreshAll() {
    if (!contract) return;
    const [admin, role, paused, count] = await Promise.all([
      contract.admin(), contract.roles(account), contract.paused(), contract.productCount(),
    ]);
    adminAddr = admin;
    me = { role: Number(role), isAdmin: lc(admin) === lc(account) };

    $("pauseState").textContent = paused ? "PAUSED" : "Running";
    $("pauseState").className = paused ? "err-text" : "ok-text";
    $("adminNote").textContent = me.isAdmin ? "You are the admin." : "You are not the admin: the contract will reject these controls.";

    products = count > 0n ? (await contract.getProducts(1, count)).map((p) => ({
      id: Number(p.id), name: p.name, batch: p.batchNumber, cid: p.metadataCID,
      manufacturer: p.manufacturer, owner: p.currentOwner, pending: p.pendingOwner,
      stage: Number(p.stage), recalled: p.recalled, createdAt: p.createdAt, updatedAt: p.updatedAt,
    })) : [];

    roleOf.clear();
    await ensureRoles([account, ...(demo ? demo.accts : []), ...products.flatMap((p) => [p.owner, p.pending, p.manufacturer])]);
    loaded = true;

    renderRoleBar();
    renderProducts();
    renderTrackSel();
    renderRegNote();
    updateStatus();
    if (parseHash().tab === "blocks") loadBlocks();
  }

  const activeKeys = () => {
    const k = [];
    if (me.isAdmin) k.push("admin");
    if (me.role) k.push(KEYS[me.role]);
    return k.length ? k : ["visitor"];
  };
  const rchip = (key) => `<span class="rchip role-${key}">${ico(ROLE_META[key].icon)}${ROLE_META[key].label}</span>`;
  const nchip = (t) => `<span class="nchip">${esc(t)}</span>`;

  // a readable name for any address: its role, else its demo account name, else the short address
  function nameChip(addr) {
    if (!addr) return nchip("New contract");
    if (contractAddr && lc(addr) === lc(contractAddr)) return nchip("Contract");
    const key = roleOf.get(lc(addr));
    if (key) return rchip(key);
    const i = demo ? demo.accts.findIndex((x) => lc(x) === lc(addr)) : -1;
    return i >= 0 ? rchip(PERSONAS[i].key) : nchip(short(addr));
  }

  function renderRoleBar() {
    const keys = activeKeys();
    const rb = $("roleBadge");
    rb.innerHTML = keys.map(rchip).join(" ");
    rb.className = "pill " + (me.isAdmin ? "admin" : me.role ? "role" : "");
    $("rolePerms").innerHTML = keys.map((k) => `<span>${rchip(k)} ${esc(ROLE_META[k].can)}</span>`).join(" ");
  }

  function renderRegNote() {
    const n = $("regNote");
    if (me.role === 1) { n.classList.add("hidden"); return; }
    n.classList.remove("hidden");
    n.innerHTML = ico("info") + `<span>Only the Manufacturer role can register products.${demo ? " Switch to Manufacturer above." : ""}</span>`;
  }

  // who: a role chip (when known) plus the short address
  function whoHtml(addr, withCopy) {
    if (!addr || addr === ethers.ZeroAddress) return '<span class="muted">-</span>';
    const key = roleOf.get(lc(addr));
    const you = lc(addr) === lc(account);
    return `${key ? rchip(key) : ""}<span class="addr">${esc(short(addr))}</span>${you ? '<span class="muted small">(you)</span>' : ""}${withCopy ? copyBtn(addr, "Copy address") : ""}`;
  }
  const copyBtn = (v, label) => `<button type="button" class="copy" data-copy="${esc(v)}" title="${esc(label)}" aria-label="${esc(label)}">${ico("copy")}</button>`;

  function needsMyAction(p) {
    return lc(p.owner) === lc(account) || lc(p.pending) === lc(account);
  }

  // ---------- tracker ----------
  function trackerHtml(stage, recalled, big) {
    const moving = !recalled && (stage === 1 || stage === 3);
    const steps = STEPS.map((s, i) => {
      let c = i < stage ? "done" : i === stage ? "current" : "";
      if (i === stage && stage === 5 && !recalled) c = "current final";
      if (moving && i === stage + 1) c += " ahead";
      return `<li class="tk ${c}"><span class="tk-dot">${icon(s.i)}</span><span class="tk-lbl">${s.l}</span></li>`;
    }).join("");
    const cap = recalled
      ? `Recalled at step ${stage + 1} of 6: <b>${STAGES[stage]}</b>`
      : stage === 5 ? `Complete: <b>${STAGES[stage]}</b>` : `Step ${stage + 1} of 6: <b>${STAGES[stage]}</b>`;
    const label = (recalled ? "Recalled. " : "") + `Progress: step ${stage + 1} of 6, ${STAGES[stage]}`;
    return `<div><ol class="tracker${recalled ? " bad" : ""}${big ? " big" : ""}" role="img" aria-label="${esc(label)}">${steps}</ol><p class="tk-now">${cap}</p></div>`;
  }

  function badgeHtml(p) {
    if (p.recalled) return `<span class="badge recalled">${ico("warning-octagon")}Recalled</span>`;
    const cls = p.stage === 1 || p.stage === 3 ? "transit" : p.stage === 5 ? "done" : "";
    return `<span class="badge ${cls}">${STAGES[p.stage]}</span>`;
  }

  // ---------- products ----------
  const matches = (p, q) => `${p.name} ${p.batch} #${p.id} ${p.id}`.toLowerCase().includes(q.toLowerCase());

  function renderFilters() {
    const base = products.filter((p) => !query || matches(p, query));
    $("stageFilters").innerHTML = FILTERS.map((f) => {
      const n = base.filter(f.test).length;
      return `<button type="button" class="fchip" data-filter="${f.id}" aria-pressed="${filter === f.id}">${f.label} <i>${n}</i></button>`;
    }).join("");
  }

  function empty(iconName, title, text, btn) {
    return `<div class="empty"><span class="em-ic">${icon(iconName)}</span><h3>${esc(title)}</h3>${text ? `<p>${esc(text)}</p>` : ""}${btn || ""}</div>`;
  }
  const skeletonCards = (n) => Array.from({ length: n }, () =>
    `<div class="sk-card" aria-hidden="true"><div class="sk sk-line w60"></div><div class="sk sk-line w35"></div><div class="sk sk-bar"></div><div class="sk sk-line w35"></div></div>`).join("");

  function renderProducts() {
    if (!loaded) { $("productRows").innerHTML = skeletonCards(4); return; }
    $("statTotal").textContent = products.length;
    $("statTransit").textContent = products.filter((p) => p.stage === 1 || p.stage === 3).length;
    $("statSold").textContent = products.filter((p) => p.stage === 5).length;
    $("statRecalled").textContent = products.filter((p) => p.recalled).length;
    renderFilters();

    const f = FILTERS.find((x) => x.id === filter) || FILTERS[0];
    let list = products.filter((p) => f.test(p) && (!query || matches(p, query)));
    if ($("mineOnly").checked) list = list.filter(needsMyAction);

    if (!list.length) {
      const filtered = products.length && (filter !== "all" || query || $("mineOnly").checked);
      $("productRows").innerHTML = filtered
        ? empty("magnifying-glass", $("mineOnly").checked && filter === "all" && !query ? "Nothing needs your action" : "No matching products", "", `<button class="btn sm" type="button" data-clear="1">Clear filters</button>`)
        : empty("package", "No products yet", me.role === 1 ? "" : "A Manufacturer registers the first product.", me.role === 1 ? `<button class="btn primary sm" type="button" data-goto="/register">Register a product</button>` : "");
      return;
    }

    $("productRows").innerHTML = list.slice().reverse().map((p, i) => {
      const isNew = !seenIds.has(p.id);
      seenIds.add(p.id);
      return pcardHtml(p, i, isNew);
    }).join("");
  }

  function pcardHtml(p, i, isNew) {
    const mineOwner = lc(p.owner) === lc(account);
    const mineIncoming = lc(p.pending) === lc(account);
    const grp = (btn, fn) => `<span class="btn-grp">${btn}${tip(fn)}</span>`;
    const acts = [`<button class="btn sm" data-act="track" data-id="${p.id}">${ico("path")}Track</button>`];
    if (!p.recalled) {
      if (mineOwner && (p.stage === 0 || p.stage === 2)) acts.push(grp(`<button class="btn sm primary" data-act="ship" data-id="${p.id}">${ico("truck")}Ship</button>`, "shipProduct"));
      if (mineOwner && (p.stage === 1 || p.stage === 3)) acts.push(grp(`<button class="btn sm" data-act="cancel" data-id="${p.id}">${ico("arrow-u-up-left")}Cancel shipment</button>`, "cancelShipment"));
      if (mineIncoming) acts.push(grp(`<button class="btn sm primary" data-act="receive" data-id="${p.id}">${ico("check")}Receive</button>`, "receiveProduct"));
      if (mineOwner && p.stage === 4 && me.role === 3) acts.push(grp(`<button class="btn sm primary" data-act="sold" data-id="${p.id}">${ico("bag")}Mark sold</button>`, "markSold"));
    }
    if (!p.recalled && (me.isAdmin || lc(p.manufacturer) === lc(account))) acts.push(grp(`<button class="btn sm danger" data-act="recall" data-id="${p.id}">${ico("warning-octagon")}Recall</button>`, "recallProduct"));

    const transit = p.stage === 1 || p.stage === 3;
    const holder = transit
      ? `${whoHtml(p.owner)}<span class="muted" aria-label="to">${ico("arrow-right")}</span>${whoHtml(p.pending)}`
      : `<span>Held by</span>${whoHtml(p.owner)}`;
    const cls = ["pcard", p.recalled ? "is-recalled" : "", isNew && loaded ? "enter" : ""].join(" ");
    return `<article class="${cls}" data-id="${p.id}" style="--i:${Math.min(i, 8)}">
      <div class="pc-head">
        <div><div class="pc-name">${esc(p.name)}</div><div class="pc-meta"><span class="mono">#${p.id}</span><span class="mono">${esc(p.batch)}</span></div></div>
        ${badgeHtml(p)}
      </div>
      ${trackerHtml(p.stage, p.recalled)}
      <div class="pc-holder">${holder}</div>
      <div class="acts">${acts.join("")}</div>
    </article>`;
  }

  // ---------- Actions ----------
  const locSamples = (list, idx) => list.map((l) => ({ label: l, values: { [idx]: l } }));

  // demo accounts that may receive a shipment, listed by name with a short address
  function recipientOptions(target) {
    if (!demo) return null;
    const all = demo.accts.map((a, i) => ({ a, i, label: `${PERSONAS[i].label} ${short(a)}`, value: a }));
    const match = all.filter((x) => roleOf.get(lc(x.a)) === target);
    return (match.length ? match : all.filter((x) => lc(x.a) !== lc(account))).map(({ label, value }) => ({ label, value }));
  }

  async function onAction(act, id) {
    const p = products.find((x) => x.id === id);
    if (act === "track") return go("/track/" + id);

    if (act === "ship") {
      const target = p.stage === 0 ? "distributor" : "retailer";
      const opts = recipientOptions(target);
      const v = await openDialog({
        title: `Ship product #${id} to a ${target}`,
        hint: "On-chain: " + FN.shipProduct + COST,
        samples: locSamples(LOCS, 1),
        okLabel: "Ship",
        fields: [
          opts
            ? { type: "select", label: `Recipient (${target})`, options: opts, other: true }
            : { type: "text", label: `${target[0].toUpperCase() + target.slice(1)} wallet address`, placeholder: "0x...", mono: true },
          { type: "text", label: "Dispatch location", placeholder: "Choose a sample or type" },
        ],
      });
      if (!v) return;
      if (!ethers.isAddress(v[0])) return toast("Invalid recipient address.", "err");
      return sendTx("Ship", () => contract.shipProduct(id, v[0], v[1]));
    }
    if (act === "receive") {
      const v = await openDialog({
        title: `Receive product #${id}`, hint: "On-chain: " + FN.receiveProduct + COST, okLabel: "Receive",
        samples: locSamples(LOCS, 0),
        fields: [{ type: "text", label: "Where was it received?", placeholder: "Choose a sample or type" }],
      });
      if (!v) return;
      return sendTx("Receive", () => contract.receiveProduct(id, v[0]));
    }
    if (act === "cancel") {
      const v = await openDialog({
        title: `Cancel shipment of #${id}`, hint: "On-chain: " + FN.cancelShipment + COST, okLabel: "Cancel shipment",
        samples: locSamples(LOCS, 0),
        fields: [{ type: "text", label: "Location", placeholder: "Choose a sample or type" }],
      });
      if (!v) return;
      return sendTx("Cancel shipment", () => contract.cancelShipment(id, v[0]));
    }
    if (act === "sold") {
      const v = await openDialog({
        title: `Mark #${id} as sold`, hint: "On-chain: " + FN.markSold + COST, okLabel: "Mark sold",
        samples: locSamples(SOLD_LOCS, 0),
        fields: [{ type: "text", label: "Store / location", placeholder: "Choose a sample or type" }],
      });
      if (!v) return;
      return sendTx("Mark sold", () => contract.markSold(id, v[0]));
    }
    if (act === "recall") {
      const v = await openDialog({
        title: `Recall product #${id}`, hint: "On-chain: " + FN.recallProduct + COST, okLabel: "Recall",
        samples: REASONS.map((r) => ({ label: r, values: { 0: r } })),
        fields: [{ type: "text", label: "Reason (stored permanently on-chain)", placeholder: "Choose a sample or type" }],
      });
      if (!v) return;
      return sendTx("Recall", () => contract.recallProduct(id, v[0]));
    }
  }

  async function registerProduct() {
    const name = $("regName").value.trim(), batch = $("regBatch").value.trim();
    if (!name || !batch) return toast("Name and batch number are required.", "err");
    const ok = await sendTx("Register product", () => contract.registerProduct(name, batch, $("regCid").value.trim(), $("regLoc").value.trim()));
    if (ok) { ["regName", "regBatch", "regCid", "regLoc"].forEach((i) => ($(i).value = "")); $("regSample").value = ""; go("/products"); }
  }

  // ---------- Track ----------
  function renderTrackSel() {
    const sel = $("trackSel");
    const cur = parseHash().id || sel.value;
    sel.innerHTML = `<option value="">Choose a product...</option>` + products.slice().reverse().map((p) => `<option value="${p.id}">#${p.id} ${esc(p.name)}</option>`).join("");
    sel.value = cur && products.some((p) => p.id === Number(cur)) ? String(cur) : "";
  }

  let trackToken = 0;
  function renderTrackRoute(id) {
    const out = $("trackResult");
    if (!loaded) { out.innerHTML = `<div class="sk-card" aria-hidden="true"><div class="sk sk-line w60"></div><div class="sk sk-bar"></div></div>`; return; }
    $("trackSel").value = id && products.some((p) => p.id === id) ? String(id) : "";
    if (!id) { trackToken++; out.innerHTML = empty("compass", "Pick a product to follow", ""); return; }
    trackProduct(id);
  }

  // tx hash + block for each history record: the contract emits one event per record, in the same order
  async function txRefs(id) {
    try {
      const names = ["ProductRegistered", "ProductShipped", "ProductReceived", "ShipmentCancelled", "ProductSold", "ProductRecalled"];
      const logs = (await Promise.all(names.map((n) => contract.queryFilter(contract.filters[n](id), 0, "latest")))).flat();
      logs.sort((a, b) => a.blockNumber - b.blockNumber || a.index - b.index);
      return logs.map((l) => ({ hash: l.transactionHash, block: l.blockNumber }));
    } catch (_) { return []; }
  }

  async function trackProduct(id) {
    const out = $("trackResult");
    const token = ++trackToken;
    out.innerHTML = `<div class="sk-card" aria-hidden="true"><div class="sk sk-line w60"></div><div class="sk sk-bar"></div><div class="sk sk-line w35"></div><div class="sk sk-line w60"></div></div>`;
    try {
      const [p, hist, refs] = await Promise.all([contract.getProduct(id), contract.getHistory(id), txRefs(id)]);
      await ensureRoles([p.manufacturer, p.currentOwner, p.pendingOwner, ...hist.map((r) => r.actor)]);
      if (token !== trackToken) return;
      const stage = Number(p.stage);
      const cid = p.metadataCID
        ? `<a class="mono" target="_blank" rel="noopener" href="https://ipfs.io/ipfs/${encodeURIComponent(p.metadataCID)}">${esc(shortHash(p.metadataCID))}</a>${copyBtn(p.metadataCID, "Copy CID")}`
        : '<span class="muted">None</span>';
      const std = ["Product manufactured", "Shipment dispatched", "Shipment received", "Sold to customer", "Shipment cancelled by sender"];
      const steps = hist.map((r, i) => {
        const note = r.note || "";
        const isRecall = note && !std.includes(note);
        const cancelled = note === "Shipment cancelled by sender";
        const title = isRecall ? "Recalled" : cancelled ? "Shipment cancelled" : TL_TITLES[Number(r.stage)];
        const ic = isRecall ? "warning-octagon" : cancelled ? "arrow-u-up-left" : STEPS[Number(r.stage)].i;
        const ref = refs.length === hist.length ? refs[i] : null;
        return `<li class="${isRecall ? "recall" : cancelled ? "cancel" : ""}" style="--i:${Math.min(i, 10)}">
          <span class="tl-ic">${icon(ic)}</span>
          <div class="tl-body">
            <div class="tl-title">${esc(title)}</div>
            <div class="tl-note">${isRecall ? "Reason: " : ""}${esc(note)}</div>
            <div class="tl-meta">
              <span class="who">${whoHtml(r.actor, true)}</span>
              ${r.location ? `<span class="who">${ico("map-pin")}${esc(r.location)}</span>` : ""}
              <time datetime="${new Date(Number(r.timestamp) * 1000).toISOString()}">${ico("clock")}${fmtTime(r.timestamp)}</time>
            </div>
            ${ref ? `<div class="tl-meta"><span class="txref"><span class="blkno">Block ${ref.block}</span><button type="button" class="txlink" data-tx="${ref.hash}" title="Show transaction details">${shortHash(ref.hash)}</button>${copyBtn(ref.hash, "Copy transaction hash")}</span></div>` : ""}
          </div></li>`;
      }).join("");
      out.innerHTML = `<div class="trk">
        <div class="trk-top${p.recalled ? " is-recalled" : ""}">
          <div class="trk-head">
            <div><h3>${esc(p.name)}</h3><div class="pc-meta"><span class="mono">#${Number(p.id)}</span><span class="mono">${esc(p.batchNumber)}</span></div></div>
            ${badgeHtml({ stage, recalled: p.recalled })}
          </div>
          ${trackerHtml(stage, p.recalled, true)}
        </div>
        <div class="trk-cols">
          <div class="trk-sec"><h3>Journey</h3><ul class="timeline">${steps}</ul></div>
          <div class="trk-sec"><h3>Details</h3>
            <dl class="facts card">
              <div><dt>Manufacturer</dt><dd>${whoHtml(p.manufacturer, true)}</dd></div>
              <div><dt>Current holder</dt><dd>${whoHtml(p.currentOwner, true)}</dd></div>
              ${p.pendingOwner !== ethers.ZeroAddress ? `<div><dt>Shipping to</dt><dd>${whoHtml(p.pendingOwner, true)}</dd></div>` : ""}
              <div><dt>IPFS metadata</dt><dd>${cid}</dd></div>
              <div><dt>Created</dt><dd>${fmtTime(p.createdAt)}</dd></div>
            </dl>
          </div>
        </div>
      </div>`;
    } catch (e) {
      if (token === trackToken) out.innerHTML = empty("warning-octagon", "Could not find that product", explain(e));
    }
  }

  // ---------- Blocks ----------
  let blkToken = 0;
  async function loadBlocks() {
    const el = $("blockRows");
    if (!provider || !contract) { el.innerHTML = skeletonCards(3); return; }
    const token = ++blkToken;
    try {
      const head = await provider.getBlockNumber();
      const nums = [];
      for (let n = head; n >= Math.max(0, head - 19); n--) nums.push(n);
      const blocks = (await Promise.all(nums.map((n) => provider.getBlock(n, true)))).filter(Boolean);
      const rows = blocks.flatMap((b) => (b.prefetchedTransactions || []).map((tx) => ({ b, tx })));
      const receipts = await Promise.all(rows.map((r) => provider.getTransactionReceipt(r.tx.hash)));
      await ensureRoles(rows.flatMap((r) => [r.tx.from, r.tx.to]));
      if (token !== blkToken) return;
      if (!rows.length) { el.innerHTML = empty("cube", "No transactions yet", ""); return; }
      el.innerHTML = `<div class="blk head" aria-hidden="true"><span>Block</span><span>Function</span><span>From / To</span><span>Tx hash</span><span>Gas used</span><span>Time</span></div>` +
        rows.map((r, i) => {
          const fn = fnName(r.tx);
          return `<div class="blk">
            <span class="num" data-k="Block">#${r.b.number}</span>
            <span class="fn" data-k="Function">${esc(fn)}</span>
            <span class="ft" data-k="From / To">${nameChip(r.tx.from)}<span class="muted">${ico("arrow-right")}</span>${nameChip(r.tx.to)}</span>
            <span class="hash hashc" data-k="Tx"><button type="button" class="txlink" data-tx="${r.tx.hash}" title="Show transaction details">${shortHash(r.tx.hash)}</button>${copyBtn(r.tx.hash, "Copy transaction hash")}</span>
            <span class="gas" data-k="Gas">${Number(receipts[i]?.gasUsed || 0).toLocaleString()}</span>
            <span class="when" data-k="Time">${fmtTime(r.b.timestamp)}</span>
          </div>`;
        }).join("");
    } catch (e) {
      if (token === blkToken) el.innerHTML = empty("warning-octagon", "Could not load blocks", explain(e));
    }
  }

  function fnName(tx) {
    if (!tx.to) return "deploy()";
    try { return (IFACE.parseTransaction({ data: tx.data, value: tx.value })?.name || "call") + "()"; } catch (_) { return "unknown()"; }
  }

  async function openTx(hash) {
    try {
      const [tx, rc] = await Promise.all([provider.getTransaction(hash), provider.getTransactionReceipt(hash)]);
      const blk = await provider.getBlock(rc.blockNumber);
      let parsed = null;
      try { parsed = tx.to ? IFACE.parseTransaction({ data: tx.data, value: tx.value }) : null; } catch (_) {}
      const key = parsed ? parsed.name : "deploy";
      await ensureRoles([tx.from, tx.to]);
      const val = (inp, v) => (inp.type === "address" ? `${nameChip(v)} <span class="addr">${esc(short(v))}</span>` : `<span class="mono">${esc(String(v))}</span>`);
      const args = parsed ? parsed.fragment.inputs.map((inp, i) => `<div><dt>${esc(inp.name)}</dt><dd>${val(inp, parsed.args[i])}</dd></div>`).join("") : "";
      const info = `<dl class="kvs">
        <div><dt>Function</dt><dd><b>${esc(fnName(tx))}</b></dd></div>
        <div><dt>Block</dt><dd><span class="mono">#${rc.blockNumber}</span></dd></div>
        <div><dt>Tx hash</dt><dd><span class="mono">${esc(shortHash(hash))}</span>${copyBtn(hash, "Copy transaction hash")}</dd></div>
        <div><dt>From</dt><dd>${nameChip(tx.from)} <span class="addr">${esc(short(tx.from))}</span></dd></div>
        <div><dt>To</dt><dd>${nameChip(tx.to)} ${tx.to ? `<span class="addr">${esc(short(tx.to))}</span>` : ""}</dd></div>
        <div><dt>Gas used</dt><dd>${Number(rc.gasUsed).toLocaleString()}</dd></div>
        <div><dt>Status</dt><dd>${rc.status === 1 ? "Success" : "Failed"}</dd></div>
        <div><dt>Time</dt><dd>${fmtTime(blk.timestamp)}</dd></div>
        ${args}
      </dl>`;
      await openDialog({ title: "Transaction", hint: FN[key] || "", info, okLabel: "Close", wide: true, closeOnly: true });
    } catch (e) {
      toast("Could not load that transaction: " + explain(e), "err");
    }
  }

  // ---------- Admin ----------
  const PICKS = [["roleAddrSel", "roleAddr"], ["lookupAddrSel", "lookupAddr"], ["newAdminSel", "newAdmin"]];
  function initPickers() {
    for (const [s, i] of PICKS) {
      const sel = $(s), inp = $(i);
      if (!demo) { sel.classList.add("hidden"); inp.classList.remove("hidden"); continue; }
      sel.classList.remove("hidden");
      sel.innerHTML = demo.accts.map((a, n) => `<option value="${a}">${PERSONAS[n].label} ${short(a)}</option>`).join("") + `<option value="__other">Other address...</option>`;
      inp.classList.add("hidden");
      sel.onchange = () => { inp.classList.toggle("hidden", sel.value !== "__other"); };
    }
    $("roleAddrSel").value = demo ? demo.accts[4] : "";
    $("adminSample").innerHTML = `<option value="">Choose a sample...</option>` + ADMIN_SAMPLES.map((s, n) => `<option value="${n}">${esc(s.label)}</option>`).join("");
    $("adminSample").parentElement.classList.toggle("hidden", !demo);
  }
  const pickVal = (s, i) => ($(s).classList.contains("hidden") || $(s).value === "__other" ? $(i).value.trim() : $(s).value);

  async function setRole() {
    const a = pickVal("roleAddrSel", "roleAddr");
    if (!ethers.isAddress(a)) return toast("Invalid address.", "err");
    sendTx("Set role", () => contract.setRole(a, Number($("roleSel").value)));
  }
  async function lookupRole() {
    const a = pickVal("lookupAddrSel", "lookupAddr");
    if (!ethers.isAddress(a)) return ($("lookupOut").textContent = "Invalid address.");
    const r = await contract.roles(a);
    $("lookupOut").textContent = `${short(a)} has role: ${ROLES[Number(r)]}`;
  }

  // ---------- tooltips ----------
  const tipBox = $("tipBox");
  let tipTimer = null;
  function showTip(el) {
    const t = el.dataset.tip;
    if (!t) return;
    tipBox.innerHTML = (el.dataset.tipt ? `<b>${esc(el.dataset.tipt)}</b>` : "") + esc(t);
    tipBox.classList.remove("hidden");
    const r = el.getBoundingClientRect(), bw = tipBox.offsetWidth, bh = tipBox.offsetHeight;
    const left = Math.min(Math.max(8, r.left + r.width / 2 - bw / 2), window.innerWidth - bw - 8);
    const top = r.top - bh - 8 < 8 ? r.bottom + 8 : r.top - bh - 8;
    tipBox.style.left = left + "px";
    tipBox.style.top = top + "px";
  }
  const hideTip = () => tipBox.classList.add("hidden");
  document.addEventListener("mouseover", (e) => { const t = e.target.closest("[data-tip]"); if (t) showTip(t); });
  document.addEventListener("mouseout", (e) => { if (e.target.closest("[data-tip]")) hideTip(); });
  document.addEventListener("focusin", (e) => { const t = e.target.closest("[data-tip]"); if (t) showTip(t); });
  document.addEventListener("focusout", hideTip);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") hideTip(); });

  // ---------- events ----------
  $("loadBtn").onclick = loadContract;
  $("refreshBtn").onclick = async () => { if (contract) { await refreshAll(); toast("Products updated.", "info", 1800); } };
  $("blocksRefresh").onclick = () => loadBlocks();
  $("mineOnly").onchange = renderProducts;
  $("searchInput").oninput = (e) => { query = e.target.value.trim(); renderProducts(); };
  $("regBtn").onclick = registerProduct;
  $("regSample").innerHTML = `<option value="">Choose a sample product...</option>` + REG_SAMPLES.map((s, i) => `<option value="${i}">${esc(s.name)}</option>`).join("");
  $("regSample").onchange = (e) => {
    const s = REG_SAMPLES[Number(e.target.value)];
    if (!s) return;
    $("regName").value = s.name; $("regBatch").value = s.batch; $("regLoc").value = s.loc; $("regCid").value = s.cid;
  };
  $("trackSel").onchange = (e) => go(e.target.value ? "/track/" + e.target.value : "/track");
  $("adminSample").onchange = (e) => {
    const s = ADMIN_SAMPLES[Number(e.target.value)];
    if (!s || !demo) return;
    $("roleAddrSel").value = demo.accts[s.acct];
    $("roleAddrSel").onchange?.();
    $("roleSel").value = String(s.role);
  };
  $("roleBtn").onclick = setRole;
  $("lookupBtn").onclick = lookupRole;
  $("pauseBtn").onclick = () => sendTx("Pause", () => contract.pause());
  $("unpauseBtn").onclick = () => sendTx("Unpause", () => contract.unpause());
  $("adminBtn").onclick = async () => {
    const a = pickVal("newAdminSel", "newAdmin");
    if (!ethers.isAddress(a)) return toast("Invalid address.", "err");
    const ok = await openDialog({ title: "Transfer admin rights?", hint: "On-chain: " + FN.transferAdmin + " You will lose admin access.", okLabel: "Transfer", info: `<p class="small">New admin: <span class="mono">${esc(short(a))}</span></p>` });
    if (ok) sendTx("Transfer admin", () => contract.transferAdmin(a));
  };
  document.querySelectorAll(".tab").forEach((t) => {
    t.onclick = () => go("/" + t.dataset.tab);
    t.onkeydown = (e) => {
      const tabs = [...document.querySelectorAll(".tab")];
      const d = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
      if (!d) return;
      e.preventDefault();
      const n = tabs[(tabs.indexOf(t) + d + tabs.length) % tabs.length];
      n.focus(); go("/" + n.dataset.tab);
    };
  });
  $("productRows").onclick = (e) => {
    const b = e.target.closest("button");
    if (!b || b.classList.contains("tip")) return;
    if (b.dataset.act) return onAction(b.dataset.act, Number(b.dataset.id));
    if (b.dataset.goto) return go(b.dataset.goto);
    if (b.dataset.clear) {
      filter = "all"; query = ""; $("searchInput").value = ""; $("mineOnly").checked = false; renderProducts();
    }
  };
  $("stageFilters").onclick = (e) => {
    const b = e.target.closest("[data-filter]");
    if (b) { filter = b.dataset.filter; renderProducts(); }
  };
  document.addEventListener("click", async (e) => {
    const tp = e.target.closest(".tip");
    if (tp) { showTip(tp); clearTimeout(tipTimer); tipTimer = setTimeout(hideTip, 5000); return; }
    const c = e.target.closest("[data-copy]");
    if (c) {
      await copyText(c.dataset.copy);
      c.classList.add("copied");
      toast("Copied to clipboard.", "info", 1600);
      setTimeout(() => c.classList.remove("copied"), 1200);
      return;
    }
    const tx = e.target.closest("[data-tx]");
    if (tx) openTx(tx.dataset.tx);
  });
  $("acctBtn").onclick = async () => { await copyText(account); toast("Your address was copied.", "info", 1600); };
  $("stAddr").onclick = async () => { if (contractAddr) { await copyText(contractAddr); toast("Contract address copied.", "info", 1600); } };
  $("stChange").onclick = () => { $("setup").classList.remove("hidden"); $("addrInput").focus(); };
  $("netSel").onchange = (e) => {
    ssSet("chaintrace.net", e.target.value === "wallet" ? "wallet" : null);
    location.reload();
  };

  // ---------- start ----------
  async function boot() {
    hydrateIcons();
    renderProducts();
    $("trackResult").innerHTML = "";
    $("statTotal").textContent = "0";
    const saved = lsGet("chaintrace.address");
    if (saved) $("addrInput").value = saved;
    if (!location.hash || !TABS.includes(parseHash().tab) || !/^#\/(products|register|track|blocks|admin)(\/\d+)?$/.test(location.hash)) history.replaceState(null, "", "#/products");
    showTab(parseHash().tab);

    if (ssGet("chaintrace.net") === "wallet") {
      $("netSel").value = "wallet";
      if (await connect()) return;
      ssSet("chaintrace.net", null);
      $("netSel").value = "sim";
    }
    $("setup").classList.add("hidden");
    if (window.Ganache) { await startDemo(); return; }
    // plain frontend folder (no in-browser chain): MetaMask only
    $("netSel").value = "wallet";
    $("app").classList.remove("booting");
    await connect();
  }
  boot();
})();
