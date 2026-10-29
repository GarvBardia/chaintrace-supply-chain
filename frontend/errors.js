// Decodes contract custom errors from many error shapes (MetaMask, Hardhat, ethers v6).
// Works in the browser (window.decodeContractError) and in Node (module.exports).
(function (root) {
  function decodeContractError(iface, err) {
    // 1) ethers already decoded it
    const rname = err?.revert?.name || err?.errorName;
    if (rname) return { name: rname, args: err?.revert?.args || err?.errorArgs || [] };

    // 2) raw revert data on the error (different providers nest it differently)
    const candidates = [err?.data, err?.error?.data, err?.info?.error?.data, err?.error?.error?.data, err?.data?.data];
    for (const d of candidates) {
      if (typeof d === "string" && d.startsWith("0x") && d.length >= 10) {
        try {
          const parsed = iface.parseError(d);
          if (parsed) return { name: parsed.name, args: [...parsed.args] };
        } catch (_) { /* not one of our errors */ }
      }
    }

    // 3) last resort: parse the human-readable message, e.g. "custom error 'MissingRole(1)'"
    const m = /custom error '(\w+)\(([^)]*)\)'/.exec(err?.message || "");
    if (m) return { name: m[1], args: m[2] === "" ? [] : m[2].split(",").map((s) => s.trim()) };
    return null;
  }

  if (typeof module !== "undefined" && module.exports) module.exports = { decodeContractError };
  else root.decodeContractError = decodeContractError;
})(typeof window !== "undefined" ? window : globalThis);
