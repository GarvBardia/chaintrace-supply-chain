**Live demo:** https://garvbardia.github.io/chaintrace-supply-chain/

# ChainTrace - Ethereum Supply Chain Tracker

Course project for **Ethereum Smart Contract Using Solidity (IT_4421)**.
A smart contract plus a web frontend that tracks a product from **Manufacturer -> Distributor -> Retailer -> Customer**, with every hand-over recorded permanently on-chain.

```
supply-chain-tracker/
  contracts/SupplyChainTracker.sol   <- the smart contract (open this in Remix)
  dist/ChainTrace-Standalone.html    <- one-file demo, runs anywhere by double-click
  frontend/                          <- the DApp source (index.html, app.js, style.css, abi.js, ethers lib)
  test/SupplyChainTracker.test.js    <- 29 automated tests
  scripts/                           <- deploy + demo data, ABI check, frontend end-to-end test
```

## Quickest way: run it on ANY laptop (no install)

Open **`dist/ChainTrace-Standalone.html`** (a single file) by double-clicking it in Chrome, Edge, Firefox or Safari, then click **Try demo (no wallet)**.

- No Node, MetaMask, Remix, internet or server needed. The file contains the DApp, ethers.js and a private Ethereum chain that runs inside the browser tab.
- It deploys the contract, assigns roles and loads two sample products automatically.
- Use the **Acting as** menu to switch between Admin, Manufacturer, Distributor, Retailer and a role-less Visitor and walk through the whole flow.
- Everything resets when the page is refreshed (it is a demo chain). To rebuild the file after changing the contract: `npm install && npm run build:standalone`.
- For the "real Ethereum" demo (Remix + MetaMask + testnet) follow the Remix section below. The same contract is used in both.

## How it works

| Role | Can do |
| --- | --- |
| **Admin** (deployer) | Assign roles, pause/unpause, recall, transfer admin |
| **Manufacturer** | Register products, ship to a Distributor, recall own products |
| **Distributor** | Receive shipments, ship to a Retailer |
| **Retailer** | Receive shipments, mark product as sold |
| **Anyone** | Track any product's full history (no wallet role needed) |

Lifecycle (strict state machine, only moves forward):
`Manufactured -> ShippedToDistributor -> ReceivedByDistributor -> ShippedToRetailer -> ReceivedByRetailer -> Sold`

Shipping is a **two-step hand-over**: the sender names the recipient, and the recipient must confirm receipt. Ownership only changes when the recipient confirms, so a product can never be lost by shipping it to a wrong address (the sender can also cancel before it is received).

## Run it in Remix (step by step)

### 1. Compile
1. Open https://remix.ethereum.org
2. In the File Explorer create `SupplyChainTracker.sol` and paste the contents of `contracts/SupplyChainTracker.sol` (or drag the file in).
3. **Solidity Compiler** tab: pick compiler **0.8.20 or newer** (0.8.24 recommended), click **Compile**.

### 2. Deploy
You have two options.

**Option A - Remix VM (quickest, to test the contract only)**
- Deploy tab -> Environment: **Remix VM (Prague/Cancun)** -> Deploy.
- Use the *Account* dropdown to switch between fake accounts. Note that **MetaMask and the frontend cannot talk to the Remix VM**, so use this to demo the contract functions directly in Remix.

**Option B - Real testnet so the frontend works (needed for the full demo)**
1. Install MetaMask, switch it to **Sepolia**, and get free test ETH from a Sepolia faucet.
2. Remix -> Deploy tab -> Environment: **Injected Provider - MetaMask** -> Deploy -> confirm in MetaMask.
3. Copy the deployed contract address (Deployed Contracts -> copy icon).

**Option C - Local blockchain (no faucet needed)**
1. `npm install` then `npx hardhat node` (keeps running; prints 20 test accounts and their private keys).
2. In MetaMask add a custom network: RPC `http://127.0.0.1:8545`, Chain ID `31337`, symbol ETH. Import 3-4 of the printed private keys as accounts (these keys are public test keys, never use them on a real network).
3. In Remix choose Environment **Dev - Hardhat Provider** (endpoint `http://127.0.0.1:8545`) and deploy, **or** run `npm run deploy` to deploy and auto-seed demo roles and products.

### 3. Give people roles (in Remix, or later in the frontend's Admin tab)
Call `setRole(address, role)` from the deployer account:
`1 = Manufacturer, 2 = Distributor, 3 = Retailer, 0 = revoke`.

### 4. Try the whole flow in Remix
1. Switch to the manufacturer account -> `registerProduct("Organic Coffee", "BATCH-001", "", "Coorg Estate")`
2. `shipProduct(1, <distributor address>, "Warehouse")`
3. Switch to distributor -> `receiveProduct(1, "Mysuru Hub")` -> `shipProduct(1, <retailer address>, "Mysuru Hub")`
4. Switch to retailer -> `receiveProduct(1, "Store 12")` -> `markSold(1, "Store 12")`
5. Anyone: `getProduct(1)` and `getHistory(1)` show the complete journey.

## Run the frontend

MetaMask only injects into pages served over http, so do **not** double-click `index.html`.

```bash
cd frontend
python3 -m http.server 8080      # or: python -m http.server 8080 on Windows
```
Open http://localhost:8080, click **Connect MetaMask**, paste the deployed contract address, click **Load contract**.
Switch accounts in MetaMask to act as the manufacturer, distributor and retailer (the page reloads automatically).

Frontend features: role badge, product table with live stage badges and per-role action buttons, register form, public tracking page with a timeline and IPFS link, admin panel (roles, pause, transfer admin), readable error messages for every contract rule.

If you change the contract, regenerate the ABI the frontend uses: `npm run abi`.

## Tests

```bash
npm install
npx hardhat test                     # 29 contract tests
npx hardhat run scripts/check-frontend-abi.js
# full frontend end-to-end test (simulated browser + local node):
npx hardhat node                                   # terminal 1
npx hardhat run scripts/deploy.js --network localhost   # terminal 2, copy the address
node scripts/e2e-frontend.js <address>             # terminal 3
```

## Syllabus mapping (for your report / viva)

| Module | Where it shows up |
| --- | --- |
| 1. Ethereum basics (accounts, transactions, gas, ETH) | Every state-changing function is a transaction with gas; roles are tied to account addresses; read functions (`getProduct`, `getHistory`) are free calls |
| 2. Solidity basics, ABI | `enum`, `struct`, `mapping`, arrays, events, modifiers, custom errors; `frontend/abi.js` is the generated ABI the DApp uses to encode calls and decode results |
| 3. Design patterns, gas, secure contracts | **Access control** (`onlyAdmin`, `onlyRole`), **state machine** (`Stage` enum), **pull-over-push custody transfer** (ship then receive), **circuit breaker** (`pause`), custom errors instead of revert strings, `calldata` strings, packed struct fields (`stage`, `recalled`, timestamps), storage pointers, optimizer enabled |
| 4. DApp architecture | Client side = HTML/JS + ethers.js + MetaMask; "server side" = the contract on-chain; workflow = wallet signs tx -> contract validates -> event emitted -> UI refreshes; IPFS CID stored on-chain, files off-chain |
| 5. Security | Trust-in-code: rules enforced by the contract, not by people. Data permanence: history is append-only (even a cancelled shipment or a recall adds a record, never erases one). Security countermeasures: no ETH handled (no reentrancy surface), zero-address checks, role checks on recipients, two-step transfer, emergency pause, Solidity 0.8 overflow checks |

Known limitations worth mentioning in a viva: the admin is a single trusted account (could be replaced by a multisig), on-chain data is public (selective obscurity would need hashing/encryption of sensitive fields), and the contract is not upgradeable (a proxy pattern could be added).
