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

  const $ = (id) => document.getElementById(id);
  const short = (a) => (a && a !== ethers.ZeroAddress ? a.slice(0, 6) + "..." + a.slice(-4) : "-");
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmtTime = (t) => new Date(Number(t) * 1000).toLocaleString();

  let provider, signer, account, contract, readContract;
  let me = { role: 0, isAdmin: false };
  let products = [];

  // ---------- UI helpers ----------
  function toast(msg, kind = "ok", ms = 4500) {
    const t = $("toast");
    t.textContent = msg;
    t.className = "toast " + kind;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.add("hidden"), ms);
  }

  // Interface used to decode revert data (available even before a contract is loaded).
  const IFACE = new ethers.Interface(window.SUPPLY_CHAIN_ABI);
  function readContract_iface() { return IFACE; }

  // Turn contract custom errors into readable text.
  function explain(err) {
    const decoded = readContract_iface() && window.decodeContractError(readContract_iface(), err);
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

  function askFields(title, fields) {
    return new Promise((resolve) => {
      const dlg = $("dlg");
      $("dlgTitle").textContent = title;
      $("dlgFields").innerHTML = fields
        .map((f, i) => `<label>${esc(f.label)}<input data-i="${i}" class="${f.mono ? "mono" : ""}" placeholder="${esc(f.placeholder || "")}" value="${esc(f.value || "")}"></label>`)
        .join("");
      const done = (ok) => {
        const vals = ok ? [...$("dlgFields").querySelectorAll("input")].map((i) => i.value.trim()) : null;
        dlg.close();
        $("dlgForm").onsubmit = null;
        resolve(vals);
      };
      $("dlgOk").onclick = (e) => { e.preventDefault(); done(true); };
      $("dlgCancel").onclick = (e) => { e.preventDefault(); done(false); };
      dlg.oncancel = () => resolve(null);
      dlg.showModal();
    });
  }

  async function sendTx(label, fn) {
    try {
      toast(`${label}: confirm in MetaMask...`, "ok", 60000);
      const tx = await fn();
      toast(`${label}: waiting for confirmation...`, "ok", 60000);
      await tx.wait();
      toast(`${label}: done`, "ok");
      await refreshAll();
      return true;
    } catch (e) {
      console.error(e);
      toast(`${label} failed: ${explain(e)}`, "err", 8000);
      return false;
    }
  }

  // ---------- Wallet / contract ----------
  let demo = null; // set when running on the built-in in-browser blockchain

  async function connect() {
    if (!window.ethereum) {
      toast("MetaMask not found. Use 'Try demo (no wallet)' or install MetaMask.", "err", 9000);
      return;
    }
    try {
      provider = new ethers.BrowserProvider(window.ethereum);
      await provider.send("eth_requestAccounts", []);
      signer = await provider.getSigner();
      account = await signer.getAddress();
      $("acct").textContent = short(account);
      $("connectBtn").textContent = "Connected";
      await showNetwork();
      window.ethereum.on?.("accountsChanged", () => location.reload());
      window.ethereum.on?.("chainChanged", () => location.reload());
      const saved = lsGet("chaintrace.address");
      if (saved && !$("addrInput").value) $("addrInput").value = saved;
      if ($("addrInput").value) await loadContract();
    } catch (e) {
      toast(explain(e), "err");
    }
  }

  // ---------- Demo mode: a private blockchain running inside this page ----------
  const DEMO_PEOPLE = ["Admin", "Manufacturer", "Distributor", "Retailer", "Visitor (no role)"];

  async function startDemo() {
    if (!window.Ganache || !window.SUPPLY_CHAIN_BYTECODE) {
      return toast("Demo mode is only in the standalone file (ChainTrace-Standalone.html).", "err", 8000);
    }
    $("demoBtn").disabled = true;
    $("demoBtn").textContent = "Starting...";
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
      idx = 0;

      demo = { accts, setIdx: (i) => (idx = i) };
      signer = await provider.getSigner();
      account = await signer.getAddress();
      $("acct").textContent = short(account);
      $("connectBtn").classList.add("hidden");
      $("demoBtn").classList.add("hidden");
      $("addrInput").value = addr;
      $("setup").classList.add("hidden");

      const sel = $("demoSel");
      sel.innerHTML = DEMO_PEOPLE.map((n, i) => `<option value="${i}">${n} - ${short(accts[i])}</option>`).join("");
      sel.onchange = async () => {
        demo.setIdx(Number(sel.value));
        signer = await provider.getSigner();
        account = await signer.getAddress();
        contract = contract.connect(signer);
        $("acct").textContent = short(account);
        await refreshAll();
        toast(`Now acting as: ${DEMO_PEOPLE[Number(sel.value)]}`, "ok", 2500);
      };
      $("demoBar").classList.remove("hidden");
      await showNetwork();
      await loadContract();
      toast("Demo blockchain started. Use the 'Acting as' menu to switch roles.", "ok", 6000);
    } catch (e) {
      console.error(e);
      $("demoBtn").disabled = false;
      $("demoBtn").textContent = "Try demo (no wallet)";
      toast("Could not start demo: " + explain(e), "err", 9000);
    }
  }

  function lsGet(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (_) {} }

  async function showNetwork() {
    const net = await provider.getNetwork();
    const b = $("netBadge");
    b.textContent = NETWORKS[Number(net.chainId)] || `Chain ${net.chainId}`;
    b.className = "pill net";
  }

  async function loadContract() {
    const addr = $("addrInput").value.trim();
    const msg = $("setupMsg");
    if (!signer) return toast("Connect MetaMask first.", "err");
    if (!ethers.isAddress(addr)) { msg.textContent = "That is not a valid address."; msg.className = "small err-text"; return; }
    try {
      const code = await provider.getCode(addr);
      if (code === "0x") throw new Error("No contract at this address on the selected network. Check the network in MetaMask.");
      contract = new ethers.Contract(addr, window.SUPPLY_CHAIN_ABI, signer);
      await contract.admin(); // sanity check that the ABI matches
      if (!demo) lsSet("chaintrace.address", addr);
      msg.textContent = "Contract loaded.";
      msg.className = "small ok-text";
      $("app").classList.remove("hidden");
      await refreshAll();
      subscribe();
    } catch (e) {
      msg.textContent = explain(e);
      msg.className = "small err-text";
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
  async function refreshAll() {
    if (!contract) return;
    const [admin, role, paused, count] = await Promise.all([
      contract.admin(), contract.roles(account), contract.paused(), contract.productCount(),
    ]);
    me = { role: Number(role), isAdmin: admin.toLowerCase() === account.toLowerCase() };

    const rb = $("roleBadge");
    const labels = [];
    if (me.isAdmin) labels.push("Admin");
    if (me.role) labels.push(ROLES[me.role]);
    rb.textContent = labels.length ? labels.join(" + ") : "No role";
    rb.className = "pill " + (me.isAdmin ? "admin" : me.role ? "role" : "");

    $("pauseState").textContent = paused ? "PAUSED" : "Running";
    $("pauseState").className = paused ? "err-text" : "ok-text";
    $("adminNote").textContent = me.isAdmin
      ? "You are the admin."
      : "You are not the admin: these controls will be rejected by the contract.";

    products = count > 0n ? (await contract.getProducts(1, count)).map((p) => ({
      id: Number(p.id), name: p.name, batch: p.batchNumber, cid: p.metadataCID,
      manufacturer: p.manufacturer, owner: p.currentOwner, pending: p.pendingOwner,
      stage: Number(p.stage), recalled: p.recalled, createdAt: p.createdAt, updatedAt: p.updatedAt,
    })) : [];
    renderProducts();
  }

  function needsMyAction(p) {
    const lc = (a) => a.toLowerCase();
    return lc(p.owner) === lc(account) || lc(p.pending) === lc(account);
  }

  function renderProducts() {
    const lc = (a) => a.toLowerCase();
    $("statTotal").textContent = products.length;
    $("statTransit").textContent = products.filter((p) => p.stage === 1 || p.stage === 3).length;
    $("statSold").textContent = products.filter((p) => p.stage === 5).length;
    $("statRecalled").textContent = products.filter((p) => p.recalled).length;

    let list = products;
    if ($("mineOnly").checked) list = list.filter(needsMyAction);
    if (!list.length) {
      $("productRows").innerHTML = `<tr><td colspan="6" class="muted">${products.length ? "Nothing needs your action." : "No products yet. A Manufacturer can register one in the Register tab."}</td></tr>`;
      return;
    }

    $("productRows").innerHTML = list.slice().reverse().map((p) => {
      const mineOwner = lc(p.owner) === lc(account);
      const mineIncoming = lc(p.pending) === lc(account);
      const acts = [`<button class="btn small" data-act="track" data-id="${p.id}">Track</button>`];
      if (!p.recalled) {
        if (mineOwner && (p.stage === 0 || p.stage === 2)) acts.push(`<button class="btn small primary" data-act="ship" data-id="${p.id}">Ship</button>`);
        if (mineOwner && (p.stage === 1 || p.stage === 3)) acts.push(`<button class="btn small" data-act="cancel" data-id="${p.id}">Cancel shipment</button>`);
        if (mineIncoming) acts.push(`<button class="btn small primary" data-act="receive" data-id="${p.id}">Receive</button>`);
        if (mineOwner && p.stage === 4 && me.role === 3) acts.push(`<button class="btn small primary" data-act="sold" data-id="${p.id}">Mark sold</button>`);
      }
      if (!p.recalled && (me.isAdmin || lc(p.manufacturer) === lc(account))) acts.push(`<button class="btn small danger" data-act="recall" data-id="${p.id}">Recall</button>`);

      const stageHtml = p.recalled
        ? `<span class="stage recalled">RECALLED</span>`
        : `<span class="stage s${p.stage}">${STAGES[p.stage]}</span>`;
      const holder = p.stage === 1 || p.stage === 3
        ? `${short(p.owner)} <span class="muted">to</span> ${short(p.pending)}`
        : short(p.owner) + (mineOwner ? ' <span class="muted">(you)</span>' : "");

      return `<tr>
        <td class="mono">#${p.id}</td>
        <td>${esc(p.name)}</td>
        <td class="mono">${esc(p.batch)}</td>
        <td>${stageHtml}</td>
        <td class="mono">${holder}</td>
        <td><div class="acts">${acts.join("")}</div></td></tr>`;
    }).join("");
  }

  // ---------- Actions ----------
  async function onAction(act, id) {
    const p = products.find((x) => x.id === id);
    if (act === "track") { switchTab("track"); $("trackId").value = id; return trackProduct(); }

    if (act === "ship") {
      const target = p.stage === 0 ? "distributor" : "retailer";
      const v = await askFields(`Ship product #${id} to a ${target}`, [
        { label: `${target[0].toUpperCase() + target.slice(1)} wallet address`, placeholder: "0x...", mono: true },
        { label: "Dispatch location", placeholder: "Bengaluru warehouse" },
      ]);
      if (!v) return;
      if (!ethers.isAddress(v[0])) return toast("Invalid recipient address.", "err");
      return sendTx("Ship", () => contract.shipProduct(id, v[0], v[1]));
    }
    if (act === "receive") {
      const v = await askFields(`Receive product #${id}`, [{ label: "Where was it received?", placeholder: "Mysuru hub" }]);
      if (!v) return;
      return sendTx("Receive", () => contract.receiveProduct(id, v[0]));
    }
    if (act === "cancel") {
      const v = await askFields(`Cancel shipment of #${id}`, [{ label: "Location", placeholder: "Warehouse" }]);
      if (!v) return;
      return sendTx("Cancel shipment", () => contract.cancelShipment(id, v[0]));
    }
    if (act === "sold") {
      const v = await askFields(`Mark #${id} as sold`, [{ label: "Store / location", placeholder: "Store #12" }]);
      if (!v) return;
      return sendTx("Mark sold", () => contract.markSold(id, v[0]));
    }
    if (act === "recall") {
      const v = await askFields(`Recall product #${id}`, [{ label: "Reason (stored permanently on-chain)", placeholder: "Quality defect" }]);
      if (!v) return;
      return sendTx("Recall", () => contract.recallProduct(id, v[0]));
    }
  }

  async function registerProduct() {
    const name = $("regName").value.trim(), batch = $("regBatch").value.trim();
    if (!name || !batch) return toast("Name and batch number are required.", "err");
    const ok = await sendTx("Register product", () => contract.registerProduct(name, batch, $("regCid").value.trim(), $("regLoc").value.trim()));
    if (ok) { ["regName", "regBatch", "regCid", "regLoc"].forEach((i) => ($(i).value = "")); switchTab("products"); }
  }

  async function trackProduct() {
    const id = Number($("trackId").value);
    const out = $("trackResult");
    if (!id) return toast("Enter a product ID.", "err");
    try {
      const [p, hist] = await Promise.all([contract.getProduct(id), contract.getHistory(id)]);
      const stage = Number(p.stage);
      const cid = p.metadataCID
        ? `<a class="mono" style="color:var(--blue)" target="_blank" rel="noopener" href="https://ipfs.io/ipfs/${encodeURIComponent(p.metadataCID)}">${esc(p.metadataCID)}</a>`
        : "-";
      out.innerHTML = `
        <dl class="kv">
          <dt>Product</dt><dd><b>${esc(p.name)}</b> (#${Number(p.id)})</dd>
          <dt>Batch</dt><dd class="mono">${esc(p.batchNumber)}</dd>
          <dt>Status</dt><dd>${p.recalled ? '<span class="stage recalled">RECALLED</span>' : `<span class="stage s${stage}">${STAGES[stage]}</span>`}</dd>
          <dt>Manufacturer</dt><dd class="mono">${p.manufacturer}</dd>
          <dt>Current holder</dt><dd class="mono">${p.currentOwner}</dd>
          ${p.pendingOwner !== ethers.ZeroAddress ? `<dt>Shipping to</dt><dd class="mono">${p.pendingOwner}</dd>` : ""}
          <dt>IPFS metadata</dt><dd>${cid}</dd>
          <dt>Created</dt><dd>${fmtTime(p.createdAt)}</dd>
        </dl>
        <ul class="timeline">
          ${hist.map((r) => {
            const isRecall = r.note && !["Product manufactured", "Shipment dispatched", "Shipment received", "Sold to customer", "Shipment cancelled by sender"].includes(r.note);
            return `<li class="${isRecall ? "recall" : ""}">
              <div class="t">${isRecall ? "RECALL: " + esc(r.note) : STAGES[Number(r.stage)]}</div>
              <div class="meta">${esc(r.note)}${r.location ? " - " + esc(r.location) : ""}</div>
              <div class="meta mono">${short(r.actor)} - ${fmtTime(r.timestamp)}</div></li>`;
          }).join("")}
        </ul>`;
    } catch (e) {
      out.innerHTML = `<p class="err-text">${esc(explain(e))}</p>`;
    }
  }

  // ---------- Admin ----------
  async function setRole() {
    const a = $("roleAddr").value.trim();
    if (!ethers.isAddress(a)) return toast("Invalid address.", "err");
    sendTx("Set role", () => contract.setRole(a, Number($("roleSel").value)));
  }
  async function lookupRole() {
    const a = $("lookupAddr").value.trim();
    if (!ethers.isAddress(a)) return ($("lookupOut").textContent = "Invalid address.");
    const r = await contract.roles(a);
    $("lookupOut").textContent = `${short(a)} has role: ${ROLES[Number(r)]}`;
  }

  // ---------- Tabs & wiring ----------
  function switchTab(name) {
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
    document.querySelectorAll(".panel").forEach((p) => p.classList.toggle("hidden", p.id !== "tab-" + name));
  }

  $("connectBtn").onclick = connect;
  $("loadBtn").onclick = loadContract;
  $("refreshBtn").onclick = refreshAll;
  $("mineOnly").onchange = renderProducts;
  $("regBtn").onclick = registerProduct;
  $("trackBtn").onclick = trackProduct;
  $("roleBtn").onclick = setRole;
  $("lookupBtn").onclick = lookupRole;
  $("pauseBtn").onclick = () => sendTx("Pause", () => contract.pause());
  $("unpauseBtn").onclick = () => sendTx("Unpause", () => contract.unpause());
  $("adminBtn").onclick = () => {
    const a = $("newAdmin").value.trim();
    if (!ethers.isAddress(a)) return toast("Invalid address.", "err");
    if (confirm("Transfer admin rights? You will lose admin access.")) sendTx("Transfer admin", () => contract.transferAdmin(a));
  };
  document.querySelectorAll(".tab").forEach((t) => (t.onclick = () => switchTab(t.dataset.tab)));
  $("productRows").onclick = (e) => {
    const b = e.target.closest("button[data-act]");
    if (b) onAction(b.dataset.act, Number(b.dataset.id));
  };

  $("demoBtn").onclick = startDemo;
  if (!window.Ganache) $("demoBtn").classList.add("hidden");
  const saved = lsGet("chaintrace.address");
  if (saved) $("addrInput").value = saved;
})();
