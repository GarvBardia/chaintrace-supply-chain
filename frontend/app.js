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
    admin: { label: "Admin", icon: "crown", can: "Assign roles, pause or unpause the contract, and recall any product." },
    manufacturer: { label: "Manufacturer", icon: "factory", can: "Register products, ship them to a distributor, and recall your own products." },
    distributor: { label: "Distributor", icon: "warehouse", can: "Receive shipments from a manufacturer and ship them on to a retailer." },
    retailer: { label: "Retailer", icon: "storefront", can: "Receive shipments from a distributor and mark products as sold." },
    visitor: { label: "Visitor", icon: "eye", can: "View and track any product. You cannot change anything." },
  };
  const FILTERS = [
    { id: "all", label: "All", test: () => true },
    { id: "made", label: "Manufactured", test: (p) => !p.recalled && p.stage === 0 },
    { id: "transit", label: "In transit", test: (p) => !p.recalled && (p.stage === 1 || p.stage === 3) },
    { id: "dist", label: "At distributor", test: (p) => !p.recalled && p.stage === 2 },
    { id: "ret", label: "At retailer", test: (p) => !p.recalled && p.stage === 4 },
    { id: "sold", label: "Sold", test: (p) => !p.recalled && p.stage === 5 },
    { id: "recalled", label: "Recalled", test: (p) => p.recalled },
  ];

  const $ = (id) => document.getElementById(id);
  const short = (a) => (a && a !== ethers.ZeroAddress ? a.slice(0, 6) + "..." + a.slice(-4) : "-");
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmtTime = (t) => new Date(Number(t) * 1000).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
  const lc = (a) => String(a || "").toLowerCase();
  const reduceMotion = () => window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const ICONS = window.ICONS || {};
  const icon = (n) => `<svg class="ic" viewBox="0 0 256 256" aria-hidden="true" focusable="false">${ICONS[n] || ""}</svg>`;
  const ico = (n) => `<span class="ico" aria-hidden="true">${icon(n)}</span>`;
  function hydrateIcons(root = document) {
    root.querySelectorAll("[data-icon]").forEach((el) => { el.innerHTML = icon(el.dataset.icon); });
  }

  let provider, signer, account, contract;
  let me = { role: 0, isAdmin: false };
  let adminAddr = "";
  let products = [];
  let loaded = false;
  let filter = "all";
  let query = "";
  let curTab = "products";
  let personaIdx = 0;
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

  // Input dialog. A field may carry `chips` (quick-fill values) and a prefilled `value`.
  function askFields(title, fields) {
    return new Promise((resolve) => {
      const dlg = $("dlg");
      $("dlgTitle").textContent = title;
      $("dlgFields").innerHTML = fields
        .map((f, i) => `<label><span class="lbl">${esc(f.label)}</span><input data-i="${i}" class="${f.mono ? "mono" : ""}" placeholder="${esc(f.placeholder || "")}" value="${esc(f.value || "")}" autocomplete="off" spellcheck="false">${
          f.chips ? `<span class="quick">${f.chips.map((c) => `<button type="button" class="fchip${c.nudge ? " nudge" : ""}" data-fill="${i}" data-value="${esc(c.value)}">${esc(c.label)}</button>`).join("")}</span>` : ""
        }</label>`)
        .join("");
      let settled = false;
      const done = (ok) => {
        if (settled) return;
        settled = true;
        const vals = ok ? [...$("dlgFields").querySelectorAll("input")].map((i) => i.value.trim()) : null;
        if (dlg.hasAttribute("open")) dlg.close();
        dlg.onclose = null;
        setTimeout(updateTour, 0);
        resolve(vals);
      };
      $("dlgFields").onclick = (e) => {
        const c = e.target.closest("[data-fill]");
        if (!c) return;
        $("dlgFields").querySelector(`input[data-i="${c.dataset.fill}"]`).value = c.dataset.value;
        c.classList.remove("nudge");
      };
      $("dlgOk").onclick = (e) => { e.preventDefault(); done(true); };
      $("dlgCancel").onclick = (e) => { e.preventDefault(); done(false); };
      dlg.onclose = () => done(false);
      dlg.oncancel = () => done(false);
      dlg.showModal();
    });
  }

  async function sendTx(label, fn) {
    let pending = null;
    try {
      pending = toast(demo ? `${label}: sending...` : `${label}: confirm in MetaMask...`, "info", 60000);
      const tx = await fn();
      dismiss(pending);
      pending = toast(`${label}: waiting for confirmation...`, "info", 60000);
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

  // ---------- views ----------
  function setView(v) {
    document.body.dataset.view = v;
    $("landing").classList.toggle("hidden", v !== "landing");
    $("setup").classList.toggle("hidden", v !== "connect");
    $("app").classList.toggle("hidden", v !== "app");
  }

  // ---------- Wallet / contract ----------
  let demo = null; // set when running on the built-in in-browser blockchain

  async function connect() {
    if (!window.ethereum) {
      toast("MetaMask not found. Start the demo instead, or install MetaMask.", "err", 9000);
      return;
    }
    try {
      provider = new ethers.BrowserProvider(window.ethereum);
      await provider.send("eth_requestAccounts", []);
      signer = await provider.getSigner();
      account = await signer.getAddress();
      showAccount();
      $("connectBtn").innerHTML = ico("check") + "Connected";
      await showNetwork();
      window.ethereum.on?.("accountsChanged", () => location.reload());
      window.ethereum.on?.("chainChanged", () => location.reload());
      const saved = lsGet("chaintrace.address");
      if (saved && !$("addrInput").value) $("addrInput").value = saved;
      if (!loaded) setView("connect");
      if ($("addrInput").value) await loadContract();
    } catch (e) {
      toast(explain(e), "err");
    }
  }

  function showAccount() {
    $("acct").textContent = short(account);
    $("acctBtn").classList.remove("hidden");
  }

  // ---------- Demo mode: a private blockchain running inside this page ----------
  const PERSONAS = [
    { key: "admin", label: "Admin" },
    { key: "manufacturer", label: "Manufacturer" },
    { key: "distributor", label: "Distributor" },
    { key: "retailer", label: "Retailer" },
    { key: "visitor", label: "Visitor" },
  ];

  function setDemoButton(busy) {
    const b = $("demoBtn");
    b.disabled = busy;
    b.innerHTML = busy ? `<span class="spin"></span>Starting...` : ico("play") + "Start demo";
  }

  async function startDemo() {
    if (!window.Ganache || !window.SUPPLY_CHAIN_BYTECODE) {
      return toast("Demo mode is only in the standalone file (ChainTrace-Standalone.html).", "err", 8000);
    }
    setDemoButton(true);
    // show the app shell with skeletons straight away; booting the chain takes a few seconds
    $("app").classList.add("booting");
    setView("app");
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
      idx = 0;

      demo = { accts, setIdx: (i) => (idx = i) };
      signer = await provider.getSigner();
      account = await signer.getAddress();
      showAccount();
      $("addrInput").value = addr;
      $("tourBtn").classList.remove("hidden");
      $("tourBtn").innerHTML = ico("compass") + "Take the tour";

      buildRoleSwitch();
      $("roleSwitchWrap").classList.remove("hidden");
      $("demoBar").innerHTML = `<span class="demo-note"><b>Demo mode.</b> A private test blockchain runs inside this page and resets when you refresh.</span>`;
      $("demoBar").classList.remove("hidden");
      await showNetwork();
      await loadContract();
      $("app").classList.remove("booting");
      toast("Demo blockchain is ready. Try the tour, or switch roles yourself.", "ok", 6000);
    } catch (e) {
      console.error(e);
      $("app").classList.remove("booting");
      setView("landing");
      setDemoButton(false);
      toast("Could not start demo: " + explain(e), "err", 9000);
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

  function lsGet(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (_) {} }

  async function showNetwork() {
    const net = await provider.getNetwork();
    const b = $("netBadge");
    b.textContent = demo || window.ethereum?.isDemo ? "Demo chain" : NETWORKS[Number(net.chainId)] || `Chain ${net.chainId}`;
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
      if (!demo) {
        $("demoBar").innerHTML = `<span class="demo-note">Contract <span class="mono">${esc(short(addr))}</span></span><button id="changeContract" class="btn sm ghost" type="button">Change</button>`;
        $("demoBar").classList.remove("hidden");
      }
      setView("app");
      await refreshAll();
      subscribe();
    } catch (e) {
      msg.textContent = explain(e);
      msg.className = "small err-text";
      if (document.body.dataset.view === "app" && !loaded) setView("connect");
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
    $("adminNote").textContent = me.isAdmin
      ? "You are the admin."
      : "You are not the admin: these controls will be rejected by the contract.";

    products = count > 0n ? (await contract.getProducts(1, count)).map((p) => ({
      id: Number(p.id), name: p.name, batch: p.batchNumber, cid: p.metadataCID,
      manufacturer: p.manufacturer, owner: p.currentOwner, pending: p.pendingOwner,
      stage: Number(p.stage), recalled: p.recalled, createdAt: p.createdAt, updatedAt: p.updatedAt,
    })) : [];

    roleOf.clear();
    await ensureRoles([account, ...products.flatMap((p) => [p.owner, p.pending, p.manufacturer])]);
    loaded = true;

    if (tour.on && !tour.id && products.length > tour.baseCount) tour.id = products[products.length - 1].id;

    renderRoleBar();
    renderProducts();
    renderTrackQuick();
    renderRegNote();
    updateTour();
  }

  const activeKeys = () => {
    const k = [];
    if (me.isAdmin) k.push("admin");
    if (me.role) k.push(KEYS[me.role]);
    return k.length ? k : ["visitor"];
  };
  const rchip = (key) => `<span class="rchip role-${key}">${ico(ROLE_META[key].icon)}${ROLE_META[key].label}</span>`;

  function renderRoleBar() {
    const keys = activeKeys();
    const rb = $("roleBadge");
    rb.innerHTML = keys.map(rchip).join(" ").replace(/<span class="rchip/g, '<span class="rchip');
    rb.className = "pill " + (me.isAdmin ? "admin" : me.role ? "role" : "");
    $("rolePerms").innerHTML = keys.map((k) => `<span>${rchip(k)} ${esc(ROLE_META[k].can)}</span>`).join(" ");
  }

  function renderRegNote() {
    const n = $("regNote");
    if (me.role === 1) { n.classList.add("hidden"); return; }
    n.classList.remove("hidden");
    n.innerHTML = ico("info") + `<span>Only the Manufacturer role can register products.${demo ? " Switch to Manufacturer in the Acting as control above." : ""}</span>`;
  }

  // who: a role chip (when known) plus the short address
  function whoHtml(addr, withCopy) {
    if (!addr || addr === ethers.ZeroAddress) return '<span class="muted">-</span>';
    const key = roleOf.get(lc(addr));
    const you = lc(addr) === lc(account);
    return `${key ? rchip(key) : ""}<span class="addr">${esc(short(addr))}</span>${you ? '<span class="muted small">(you)</span>' : ""}${withCopy ? copyBtn(addr) : ""}`;
  }
  const copyBtn = (v) => `<button type="button" class="copy" data-copy="${esc(v)}" title="Copy address" aria-label="Copy address">${ico("copy")}</button>`;

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
  function renderFilters() {
    const base = products.filter((p) => !query || matches(p, query));
    $("stageFilters").innerHTML = FILTERS.map((f) => {
      const n = base.filter(f.test).length;
      return `<button type="button" class="fchip" data-filter="${f.id}" aria-pressed="${filter === f.id}">${f.label} <i>${n}</i></button>`;
    }).join("");
  }
  const matches = (p, q) => `${p.name} ${p.batch} #${p.id} ${p.id}`.toLowerCase().includes(q.toLowerCase());

  function empty(iconName, title, text, btn) {
    return `<div class="empty"><span class="em-ic">${icon(iconName)}</span><h3>${esc(title)}</h3><p>${esc(text)}</p>${btn || ""}</div>`;
  }

  function renderProducts() {
    if (!loaded) {
      $("productRows").innerHTML = Array.from({ length: 4 }, () =>
        `<div class="sk-card" aria-hidden="true"><div class="sk sk-line w60"></div><div class="sk sk-line w35"></div><div class="sk sk-bar"></div><div class="sk sk-line w35"></div></div>`).join("");
      return;
    }
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
        ? empty("magnifying-glass", $("mineOnly").checked && filter === "all" && !query ? "Nothing needs your action" : "No matching products", "Try a different search or stage, or clear the filters.", `<button class="btn sm" type="button" data-clear="1">Clear filters</button>`)
        : empty("package", "No products yet", me.role === 1 ? "Register the first product to start its journey." : "A Manufacturer registers the first product.", me.role === 1 ? `<button class="btn primary sm" type="button" data-goto="register">Register a product</button>` : "");
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
    const acts = [`<button class="btn sm" data-act="track" data-id="${p.id}">${ico("path")}Track</button>`];
    if (!p.recalled) {
      if (mineOwner && (p.stage === 0 || p.stage === 2)) acts.push(`<button class="btn sm primary" data-act="ship" data-id="${p.id}">${ico("truck")}Ship</button>`);
      if (mineOwner && (p.stage === 1 || p.stage === 3)) acts.push(`<button class="btn sm" data-act="cancel" data-id="${p.id}">${ico("arrow-u-up-left")}Cancel shipment</button>`);
      if (mineIncoming) acts.push(`<button class="btn sm primary" data-act="receive" data-id="${p.id}">${ico("check")}Receive</button>`);
      if (mineOwner && p.stage === 4 && me.role === 3) acts.push(`<button class="btn sm primary" data-act="sold" data-id="${p.id}">${ico("bag")}Mark sold</button>`);
    }
    if (!p.recalled && (me.isAdmin || lc(p.manufacturer) === lc(account))) acts.push(`<button class="btn sm danger" data-act="recall" data-id="${p.id}">${ico("warning-octagon")}Recall</button>`);

    const transit = p.stage === 1 || p.stage === 3;
    const holder = transit
      ? `${whoHtml(p.owner)}<span class="muted" aria-label="to">${ico("arrow-right")}</span>${whoHtml(p.pending)}`
      : `<span>Held by</span>${whoHtml(p.owner)}`;
    const cls = ["pcard", p.recalled ? "is-recalled" : "", tour.on && tour.id === p.id ? "is-tour" : "", isNew && loaded ? "enter" : ""].join(" ");
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

  function heroSample() {
    const el = $("heroSample");
    if (!el) return;
    el.innerHTML = `<article class="pcard enter">
      <div class="pc-head">
        <div><div class="pc-name">Single-Origin Coffee 250g</div><div class="pc-meta"><span class="mono">#7</span><span class="mono">BATCH-2026-014</span></div></div>
        <span class="badge transit">Shipped to retailer</span>
      </div>
      ${trackerHtml(3, false)}
      <div class="pc-holder">${rchip("distributor")}<span class="muted">${ico("arrow-right")}</span>${rchip("retailer")}</div>
    </article>`;
  }

  // ---------- Actions ----------
  const suggest = {
    ship0: { to: 2, loc: "Wayanad Apiary" },
    ship2: { to: 3, loc: "Mysuru Hub" },
    receive1: { loc: "Mysuru Hub" },
    receive3: { loc: "Store #12, Bengaluru" },
    sold: { loc: "Store #12, Bengaluru" },
  };

  async function onAction(act, id) {
    const p = products.find((x) => x.id === id);
    if (act === "track") { switchTab("track"); $("trackId").value = id; return trackProduct(); }
    const touring = tour.on && tour.id === id;

    if (act === "ship") {
      const target = p.stage === 0 ? "distributor" : "retailer";
      const s = suggest["ship" + p.stage];
      const chips = demo ? [{ label: `Use the demo ${target}`, value: demo.accts[s.to], nudge: touring }] : null;
      const v = await askFields(`Ship product #${id} to a ${target}`, [
        { label: `${target[0].toUpperCase() + target.slice(1)} wallet address`, placeholder: "0x...", mono: true, chips, value: touring && demo ? demo.accts[s.to] : "" },
        { label: "Dispatch location", placeholder: "Bengaluru warehouse", value: touring ? s.loc : "" },
      ]);
      if (!v) return;
      if (!ethers.isAddress(v[0])) return toast("Invalid recipient address.", "err");
      return sendTx("Ship", () => contract.shipProduct(id, v[0], v[1]));
    }
    if (act === "receive") {
      const v = await askFields(`Receive product #${id}`, [{ label: "Where was it received?", placeholder: "Mysuru hub", value: touring ? suggest["receive" + p.stage].loc : "" }]);
      if (!v) return;
      return sendTx("Receive", () => contract.receiveProduct(id, v[0]));
    }
    if (act === "cancel") {
      const v = await askFields(`Cancel shipment of #${id}`, [{ label: "Location", placeholder: "Warehouse" }]);
      if (!v) return;
      return sendTx("Cancel shipment", () => contract.cancelShipment(id, v[0]));
    }
    if (act === "sold") {
      const v = await askFields(`Mark #${id} as sold`, [{ label: "Store / location", placeholder: "Store #12", value: touring ? suggest.sold.loc : "" }]);
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

  // ---------- Track ----------
  function renderTrackQuick() {
    const el = $("trackQuick");
    el.innerHTML = products.length
      ? products.slice().reverse().slice(0, 6).map((p) => `<button type="button" class="fchip" data-track="${p.id}">#${p.id} ${esc(p.name)}</button>`).join("")
      : "";
    if (!$("trackResult").innerHTML.trim()) {
      $("trackResult").innerHTML = empty("compass", "Pick a product to follow", "Enter a product ID above, or choose one of the recent products.");
    }
  }

  async function trackProduct() {
    const id = Number($("trackId").value);
    const out = $("trackResult");
    if (!id) return toast("Enter a product ID.", "err");
    out.innerHTML = `<div class="sk-card" aria-hidden="true"><div class="sk sk-line w60"></div><div class="sk sk-bar"></div><div class="sk sk-line w35"></div><div class="sk sk-line w60"></div></div>`;
    try {
      const [p, hist] = await Promise.all([contract.getProduct(id), contract.getHistory(id)]);
      await ensureRoles([p.manufacturer, p.currentOwner, p.pendingOwner, ...hist.map((r) => r.actor)]);
      const stage = Number(p.stage);
      const prod = { id: Number(p.id), stage, recalled: p.recalled };
      const cid = p.metadataCID
        ? `<a class="mono" target="_blank" rel="noopener" href="https://ipfs.io/ipfs/${encodeURIComponent(p.metadataCID)}">${esc(p.metadataCID)}</a>${copyBtn(p.metadataCID).replace("Copy address", "Copy CID")}`
        : '<span class="muted">None</span>';
      const std = ["Product manufactured", "Shipment dispatched", "Shipment received", "Sold to customer", "Shipment cancelled by sender"];
      const steps = hist.map((r, i) => {
        const note = r.note || "";
        const isRecall = note && !std.includes(note);
        const cancelled = note === "Shipment cancelled by sender";
        const title = isRecall ? "Recalled" : cancelled ? "Shipment cancelled" : TL_TITLES[Number(r.stage)];
        const ic = isRecall ? "warning-octagon" : cancelled ? "arrow-u-up-left" : STEPS[Number(r.stage)].i;
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
      if (tour.on && tour.id === prod.id && stage === 5) { tour.tracked = true; updateTour(); }
    } catch (e) {
      out.innerHTML = empty("warning-octagon", "Could not find that product", explain(e));
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
    curTab = name;
    document.querySelectorAll(".tab").forEach((t) => {
      const on = t.dataset.tab === name;
      t.classList.toggle("active", on);
      t.setAttribute("aria-selected", on);
      t.tabIndex = on ? 0 : -1;
    });
    document.querySelectorAll(".panel").forEach((p) => p.classList.toggle("hidden", p.id !== "tab-" + name));
    updateTour();
  }

  // ---------- Guided tour (demo only) ----------
  const tour = { on: false, id: null, baseCount: 0, tracked: false, lastTarget: null };
  const TOUR_TOTAL = 7;

  function tourPlan() {
    const p = tour.id ? products.find((x) => x.id === tour.id) : null;
    if (!p) return { n: 1, role: "manufacturer", tab: "register", title: "Register a product", act: "register" };
    if (p.recalled) return { n: 8, done: true, title: "This product was recalled", text: "A recall freezes the product on the blockchain, so the tour ends here." };
    switch (p.stage) {
      case 0: return { n: 2, role: "manufacturer", tab: "products", title: "Ship it to the distributor", act: "ship" };
      case 1: return { n: 3, role: "distributor", tab: "products", title: "Receive the shipment", act: "receive" };
      case 2: return { n: 4, role: "distributor", tab: "products", title: "Ship it to the retailer", act: "ship" };
      case 3: return { n: 5, role: "retailer", tab: "products", title: "Receive it at the store", act: "receive" };
      case 4: return { n: 6, role: "retailer", tab: "products", title: "Mark it sold", act: "sold" };
      default:
        return tour.tracked
          ? { n: 8, done: true, title: "That is the full journey", text: "Every hand-over is now a permanent record on the blockchain. Anyone can verify it, with no account." }
          : { n: 7, role: null, tab: "track", title: "Track the journey", act: "track" };
    }
  }

  const ACT_TEXT = {
    ship: "Press the highlighted <b>Ship</b> button on your product. The recipient is filled in for you, so just confirm.",
    receive: "Press the highlighted <b>Receive</b> button, then confirm the dialog.",
    sold: "Press the highlighted <b>Mark sold</b> button, then confirm the dialog.",
    track: "Press the highlighted <b>Track</b> button to see every hand-over of your product.",
  };

  function updateTour() {
    document.querySelectorAll(".nudge").forEach((x) => x.classList.remove("nudge"));
    document.querySelectorAll(".pcard.is-tour").forEach((x) => x.classList.remove("is-tour"));
    const panel = $("tour");
    if (!tour.on || !demo) {
      panel.classList.add("hidden");
      document.body.classList.remove("tour-on");
      return;
    }
    panel.classList.remove("hidden");
    document.body.classList.add("tour-on");
    if (tour.id) document.querySelector(`.pcard[data-id="${tour.id}"]`)?.classList.add("is-tour");

    const plan = tourPlan();
    const curKey = PERSONAS[personaIdx].key;
    const acts = [];
    let target = null, text;
    $("tourTitle").textContent = plan.title;
    $("tourStep").textContent = plan.done ? "Tour complete" : `Step ${plan.n} of ${TOUR_TOTAL}`;
    $("tourProg").style.width = (plan.done ? 100 : ((plan.n - 1) / TOUR_TOTAL) * 100) + "%";

    if (plan.done) {
      text = plan.text;
      acts.push(`<button class="btn sm primary" type="button" data-tour="finish">Finish</button>`);
    } else if (plan.role && curKey !== plan.role) {
      const lbl = ROLE_META[plan.role].label;
      target = $("roleSwitch").querySelector(`[data-key="${plan.role}"]`);
      text = `Switch to <b>${lbl}</b> with the highlighted "Acting as" control. Only this role can do the next step.`;
      acts.push(`<button class="btn sm" type="button" data-tour="switch" data-i="${PERSONAS.findIndex((x) => x.key === plan.role)}">Switch for me</button>`);
    } else if (curTab !== plan.tab) {
      const names = { products: "Products", register: "Register", track: "Track" };
      target = document.querySelector(`.tab[data-tab="${plan.tab}"]`);
      text = `Open the highlighted <b>${names[plan.tab]}</b> tab.`;
    } else if (plan.act === "register") {
      if (!$("regName").value.trim()) {
        target = $("regFill");
        text = "Press <b>Fill an example</b>, then <b>Register product</b>. The product is written to the blockchain.";
      } else {
        target = $("regBtn");
        text = "Now press the highlighted <b>Register product</b> button.";
      }
    } else if (plan.act === "track") {
      $("trackId").value = tour.id;
      target = $("trackBtn");
      text = ACT_TEXT.track;
    } else {
      target = document.querySelector(`.pcard[data-id="${tour.id}"] [data-act="${plan.act}"]`);
      text = ACT_TEXT[plan.act];
    }
    $("tourBody").innerHTML = text;
    $("tourActions").innerHTML = acts.join("");
    if (target) {
      target.classList.add("nudge");
      if (target !== tour.lastTarget) target.scrollIntoView({ block: "center", behavior: reduceMotion() ? "auto" : "smooth" });
    }
    tour.lastTarget = target;
  }

  function startTour() {
    if (!demo) return toast("The tour runs in the demo. Press Start demo first.", "info");
    Object.assign(tour, { on: true, id: null, baseCount: products.length, tracked: false, lastTarget: null });
    $("trackResult").innerHTML = "";
    renderTrackQuick();
    switchTab(curTab === "register" ? "register" : "products");
  }
  function stopTour() {
    tour.on = false;
    updateTour();
  }

  // ---------- events ----------
  $("connectBtn").onclick = connect;
  $("loadBtn").onclick = loadContract;
  $("refreshBtn").onclick = async () => { if (contract) { await refreshAll(); toast("Products updated.", "info", 1800); } };
  $("mineOnly").onchange = renderProducts;
  $("searchInput").oninput = (e) => { query = e.target.value.trim(); renderProducts(); };
  $("regBtn").onclick = registerProduct;
  $("regFill").onclick = () => {
    $("regName").value = "Single-Origin Honey 500g";
    $("regBatch").value = "BATCH-2026-003";
    $("regLoc").value = "Wayanad Apiary, Kerala";
    updateTour();
  };
  $("regName").addEventListener("input", updateTour);
  $("trackBtn").onclick = trackProduct;
  $("trackId").onkeydown = (e) => { if (e.key === "Enter") trackProduct(); };
  $("roleBtn").onclick = setRole;
  $("lookupBtn").onclick = lookupRole;
  $("pauseBtn").onclick = () => sendTx("Pause", () => contract.pause());
  $("unpauseBtn").onclick = () => sendTx("Unpause", () => contract.unpause());
  $("adminBtn").onclick = () => {
    const a = $("newAdmin").value.trim();
    if (!ethers.isAddress(a)) return toast("Invalid address.", "err");
    if (confirm("Transfer admin rights? You will lose admin access.")) sendTx("Transfer admin", () => contract.transferAdmin(a));
  };
  document.querySelectorAll(".tab").forEach((t) => {
    t.onclick = () => switchTab(t.dataset.tab);
    t.onkeydown = (e) => {
      const tabs = [...document.querySelectorAll(".tab")];
      const d = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
      if (!d) return;
      e.preventDefault();
      const n = tabs[(tabs.indexOf(t) + d + tabs.length) % tabs.length];
      n.focus(); switchTab(n.dataset.tab);
    };
  });
  $("productRows").onclick = (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.act) return onAction(b.dataset.act, Number(b.dataset.id));
    if (b.dataset.goto) return switchTab(b.dataset.goto);
    if (b.dataset.clear) {
      filter = "all"; query = ""; $("searchInput").value = ""; $("mineOnly").checked = false; renderProducts();
    }
  };
  $("stageFilters").onclick = (e) => {
    const b = e.target.closest("[data-filter]");
    if (b) { filter = b.dataset.filter; renderProducts(); }
  };
  $("trackQuick").onclick = (e) => {
    const b = e.target.closest("[data-track]");
    if (b) { $("trackId").value = b.dataset.track; trackProduct(); }
  };
  document.addEventListener("click", async (e) => {
    const c = e.target.closest("[data-copy]");
    if (c) {
      await copyText(c.dataset.copy);
      c.classList.add("copied");
      toast("Copied to clipboard.", "info", 1600);
      setTimeout(() => c.classList.remove("copied"), 1200);
      return;
    }
    if (e.target.closest("#changeContract")) { setView("connect"); return; }
    const t = e.target.closest("[data-tour]");
    if (t) {
      if (t.dataset.tour === "finish") stopTour();
      if (t.dataset.tour === "switch") switchPersona(Number(t.dataset.i));
    }
  });
  $("acctBtn").onclick = async () => { await copyText(account); toast("Your address was copied.", "info", 1600); };
  $("brandLink").onclick = (e) => { e.preventDefault(); window.scrollTo({ top: 0, behavior: reduceMotion() ? "auto" : "smooth" }); };
  $("tourBtn").onclick = startTour;
  $("tourClose").onclick = stopTour;

  $("demoBtn").onclick = startDemo;
  hydrateIcons();
  heroSample();
  setDemoButton(false);
  $("connectBtn").innerHTML = ico("wallet") + "Connect MetaMask";
  if (!window.Ganache) $("demoBtn").classList.add("hidden");
  renderProducts();
  renderTrackQuick();
  const saved = lsGet("chaintrace.address");
  if (saved) $("addrInput").value = saved;
})();
