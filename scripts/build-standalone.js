// Builds dist/ChainTrace-Standalone.html: ONE self-contained file (no server, no install, no internet).
// Includes ethers.js and an in-browser Ethereum chain (Ganache) so it runs by double-clicking.
// Run: npm run build:standalone
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const f = (p) => fs.readFileSync(path.join(root, p), "utf8");
const safe = (js) => js.replace(/<\/script/gi, "<\\/script").replace(/<!--/g, "<\\!--");

let html = f("frontend/index.html");
html = html.replace('<link rel="stylesheet" href="style.css" />', `<style>\n${f("frontend/style.css")}\n</style>`);

const order = [
  "node_modules/ganache/dist/web/ganache.min.js",
  "frontend/ethers.umd.min.js",
  "frontend/abi.js",
  "frontend/icons.js",
  "frontend/bytecode.js",
  "frontend/errors.js",
  "frontend/app.js",
];
const inline = order.map((p) => `<script>\n${safe(f(p)).replace(/\/\/# sourceMappingURL=.*$/gm, "")}\n</script>`).join("\n");
html = html.replace(/<script src="ethers.umd.min.js"><\/script>[\s\S]*<script src="app.js"><\/script>/, () => inline);

fs.mkdirSync(path.join(root, "dist"), { recursive: true });
const out = path.join(root, "dist/ChainTrace-Standalone.html");
fs.writeFileSync(out, html);
console.log("Wrote", out, (fs.statSync(out).size / 1e6).toFixed(1) + " MB");
