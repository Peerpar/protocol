/**
 * anchorStore.js — Local, persistent record of merkleRoots this relayer
 * has already anchored, to reject replayed /anchor requests before
 * spending any gas.
 *
 * WHY this exists: a POST /anchor body is a self-contained, validly signed
 * request. Nothing about it changes if it's replayed — the same signature
 * verifies again on a second, third, or thousandth submission. Per-IP rate
 * limiting (server.js) bounds how FAST a single source can replay, but
 * doesn't stop replay itself, and a distributed replay (many IPs, or the
 * same IP spread across the rate-limit window) would still force the
 * relayer to pay gas anchoring the exact same merkleRoot repeatedly —
 * exactly the "drain the relayer wallet" risk server.js's own comments
 * describe. Rejecting a merkleRoot we've already anchored closes that,
 * independent of who's replaying it or how fast.
 *
 * WHY a local file instead of querying the chain for existing Anchored
 * events: querying is authoritative (only this relayer's key can call
 * anchor() per the contract), but a correctness-preserving implementation
 * has to page through the whole log history with eth_getLogs, and many
 * RPC endpoints (especially free/public ones) cap how large a block range
 * a single call may span — making an exhaustive on-chain check either slow
 * (many chunked round-trips) or unreliable (provider-specific range caps)
 * on the common path, which is a brand-new root that's never been seen
 * before. A local append-only log is O(1) per check, has no range limits,
 * and persists across restarts — it only "forgets" a prior anchor if this
 * exact store file is lost or a different relayer key takes over without
 * migrating it, which is an operational concern, not a correctness gap in
 * the replay defense this is meant to provide.
 */
const fs = require("fs");
const path = require("path");

const DEFAULT_STORE_PATH = path.join(__dirname, "..", "data", "anchored-roots.log");

/**
 * @param {string} [storePath] — file to load from / append to.
 * @returns {{ has: (merkleRoot: string) => boolean, record: (merkleRoot: string) => void }}
 */
function createAnchorStore(storePath = DEFAULT_STORE_PATH) {
    const seen = new Set();

    try {
        const contents = fs.readFileSync(storePath, "utf8");
        for (const line of contents.split("\n")) {
            const root = line.trim().toLowerCase();
            if (root) seen.add(root);
        }
    } catch (err) {
        if (err.code !== "ENOENT") throw err;
        // No store file yet — nothing anchored by this relayer instance so far.
    }

    return {
        /** @returns {boolean} whether this merkleRoot has already been anchored */
        has(merkleRoot) {
            return seen.has(merkleRoot.toLowerCase());
        },

        /** Marks a merkleRoot as anchored, persisting it for future process restarts. */
        record(merkleRoot) {
            const normalized = merkleRoot.toLowerCase();
            if (seen.has(normalized)) return;
            seen.add(normalized);
            fs.mkdirSync(path.dirname(storePath), { recursive: true });
            fs.appendFileSync(storePath, normalized + "\n");
        },
    };
}

module.exports = { createAnchorStore, DEFAULT_STORE_PATH };
