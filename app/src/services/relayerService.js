/**
 * relayerService.js — Submit proof payloads to the PeerPar relayer
 *
 * The relayer is a Node.js server that:
 *   1. Verifies the EIP-712 signature
 *   2. Cross-validates the timestamp via NTP
 *   3. Submits anchor() to the ProofRegistry contract (paying gas)
 *   4. Returns the transaction hash
 *
 * The app calls this service AFTER hashing and BEFORE saving the file
 * to the gallery. If submission fails, the proof is marked 'failed' in
 * SQLite but the file is still saved — the user can retry submission later.
 */

const RELAYER_URL = process.env.EXPO_PUBLIC_RELAYER_URL || "http://localhost:3001";
const TIMEOUT_MS = 30_000; // 30 seconds — L2 txns are fast but may queue

/**
 * Submit a proof payload to the relayer for on-chain anchoring.
 *
 * @param {object} payload
 * @param {string} signature    — EIP-712 hex signature from device
 * @param {string} deviceAddress
 * @returns {Promise<{
 *   txHash: string,
 *   blockNumber: number,
 *   networkId: number,
 *   ntpValidation: object
 * }>}
 * @throws {Error} on HTTP error, timeout, or relayer rejection
 */
export async function submitProof(payload, signature, deviceAddress) {
    const body = {
        ...payload,
        // Convert BigInt fields to numbers for JSON serialisation
        // WHY: JSON.stringify does not handle BigInt natively
        ntpTimestamp: Number(payload.ntpTimestamp),
        gpsLat: Number(payload.gpsLat),
        gpsLon: Number(payload.gpsLon),
        gpsAcc: Number(payload.gpsAcc),
        signature,
        deviceAddress,
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
        const res = await fetch(`${RELAYER_URL}/anchor`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            signal: controller.signal,
        });
        clearTimeout(timer);

        const json = await res.json();

        if (!res.ok || !json.success) {
            throw new Error(json.error || `Relayer returned HTTP ${res.status}`);
        }

        return {
            txHash: json.txHash,
            blockNumber: json.blockNumber,
            networkId: json.networkId,
            ntpValidation: json.ntpValidation,
        };
    } catch (err) {
        clearTimeout(timer);
        if (err.name === "AbortError") {
            throw new Error(`Relayer request timed out after ${TIMEOUT_MS / 1000}s`);
        }
        throw err;
    }
}

/**
 * Check relayer health (used at app startup to warn if relayer is down).
 *
 * @returns {Promise<boolean>}
 */
export async function checkRelayerHealth() {
    try {
        const res = await fetch(`${RELAYER_URL}/health`, { method: "GET" });
        return res.ok;
    } catch {
        return false;
    }
}
