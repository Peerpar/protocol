/**
 * relayer.js — Core Relayer Logic
 *
 * This module:
 *   1. Validates the incoming EIP-712 signed payload from the device
 *   2. Cross-checks the timestamp against our own NTP
 *   3. Submits anchor() to the ProofRegistry contract on-chain
 *   4. Returns the transaction hash to the client
 *
 * TRUST POSITION
 * The relayer is a trusted intermediary. It can:
 *   - Verify or reject any proof (censorship risk)
 *   - Observe all proof metadata (privacy consideration)
 * The relayer CANNOT:
 *   - Forge a device signature (EIP-712)
 *   - Alter an accepted Merkle root (it's the raw value from the device)
 *   - Backdate a proof (block timestamp is set by L2 sequencer, not us)
 */

const { ethers } = require("ethers");
const { buildDomain, verifyPayload, encodeMetadata } = require("./eip712");
const { validateTimestamp } = require("./ntpClient");
const { createAnchorStore } = require("./anchorStore");

// Lazily-created module-level default store, shared across requests in this
// process (and persisted to disk across restarts). Created on first use
// rather than at require-time so requiring this module (e.g. from tests,
// which always inject their own config.anchorStore) never touches the real
// default store file.
let defaultAnchorStore = null;
function getDefaultAnchorStore() {
    if (!defaultAnchorStore) defaultAnchorStore = createAnchorStore();
    return defaultAnchorStore;
}

// ── Minimal ABI (only the anchor function) ────────────────────────────────────
// WHY minimal ABI: we only call one function. A full ABI would be larger
// and could import unnecessary dependencies. Keep it explicit.
const REGISTRY_ABI = [
    "function anchor(bytes32 merkleRoot, address submitter, uint64 ntpTimestamp, bytes calldata metadata) external",
    "event Anchored(address indexed submitter, bytes32 indexed merkleRoot, uint64 ntpTimestamp, bytes metadata)",
];

/**
 * Validate and process an incoming proof submission request.
 *
 * @param {object} body — Request body from POST /anchor
 * @param {object} config — { contractAddress, rpcUrl, relayerWallet, chainId, anchorStore? }
 *   anchorStore defaults to a shared on-disk store (see anchorStore.js) if omitted.
 * @returns {Promise<object>} — { txHash, blockNumber, networkId, ntpValidation }
 */
async function processAnchorRequest(body, config) {
    const { contractAddress, rpcUrl, relayerWallet, chainId } = config;

    // ── Step 1: Input validation ───────────────────────────────────────────────
    const required = [
        "merkleRoot", "sha256Hex", "pHashHex",
        "ntpTimestamp", "ntpOffsetMs",
        "gpsLat", "gpsLon", "gpsAcc",
        "deviceModel", "osVersion", "appVersion",
        "deviceAddress", "signature",
    ];
    for (const field of required) {
        if (body[field] === undefined || body[field] === null || body[field] === "") {
            throw Object.assign(new Error(`Missing required field: ${field}`), { statusCode: 400 });
        }
    }

    // Validate ntpTimestamp is a safe integer
    const ts = Number(body.ntpTimestamp);
    if (!Number.isInteger(ts) || ts < 1000000000 || ts > 9999999999) {
        throw Object.assign(
            new Error("ntpTimestamp must be a valid Unix timestamp in seconds"),
            { statusCode: 400 }
        );
    }
    // ── Step 2: Validate merkleRoot format ────────────────────────────────────
    // WHY: ethers.isHexString(value, 32) checks it's exactly 32 bytes hex.
    //      A malformed root would cause a contract revert and waste gas.
    if (!ethers.isHexString(body.merkleRoot, 32)) {
        throw Object.assign(
            new Error("merkleRoot must be a 0x-prefixed 32-byte hex string"),
            { statusCode: 400 }
        );
    }

    // ── Step 2b: Reject a merkleRoot we've already anchored ───────────────────
    // WHY: a POST /anchor body is a self-contained, validly signed request —
    // replaying it verbatim (whether by accident, a client retry bug, or a
    // captured request being resent) verifies again on every resubmission.
    // Per-IP rate limiting (server.js) only bounds how fast that can happen,
    // not whether it can — this is what actually stops it, by refusing to
    // spend gas anchoring the same root twice. See anchorStore.js for why a
    // local store rather than an on-chain events query.
    const anchorStore = config.anchorStore || getDefaultAnchorStore();
    if (anchorStore.has(body.merkleRoot)) {
        throw Object.assign(
            new Error(`merkleRoot ${body.merkleRoot} has already been anchored`),
            { statusCode: 409 }
        );
    }

    // ── Step 3: Verify EIP-712 signature ──────────────────────────────────────
    // WHY: This proves the proof was submitted by the device that holds the
    //      private key matching deviceAddress. Without this check, anyone
    //      could submit proofs on behalf of any device address.
    const domain = buildDomain(chainId, contractAddress);
    const payload = {
        merkleRoot: body.merkleRoot,
        sha256Hex: body.sha256Hex,
        pHashHex: body.pHashHex,
        ntpTimestamp: BigInt(body.ntpTimestamp),
        ntpOffsetMs: body.ntpOffsetMs,
        gpsLat: BigInt(body.gpsLat),
        gpsLon: BigInt(body.gpsLon),
        gpsAcc: BigInt(body.gpsAcc),
        deviceModel: body.deviceModel,
        osVersion: body.osVersion,
        appVersion: body.appVersion,
    };

    const { valid, recovered } = verifyPayload(
        domain, payload, body.signature, body.deviceAddress
    );
    if (!valid) {
        throw Object.assign(
            new Error(
                `Signature does not match declared deviceAddress (recovered ${recovered}, expected ${body.deviceAddress})`
            ),
            { statusCode: 401 }
        );
    }
    const effectiveDeviceAddress = recovered;
    console.log(`[relayer] Signer verified: ${recovered}`);

    // ── Step 4: Cross-validate timestamp against NTP ──────────────────────────
    // WHY: Device can self-report any timestamp. Our independent NTP check
    //      gives verifiers a second reference point. We don't BLOCK on drift —
    //      we RECORD the validation result in the response and on-chain metadata.
    const deviceTimestampMs = Number(body.ntpTimestamp) * 1000;
    const ntpValidation = await validateTimestamp(deviceTimestampMs);

    // Warn but don't reject on timestamp drift — the user may be off-grid.
    if (!ntpValidation.reliable) {
        console.warn("[relayer] Timestamp drift warning:", ntpValidation.warning);
    }

    // ── Step 5: Encode metadata for calldata ──────────────────────────────────
    const metadataBytes = encodeMetadata(payload);

    // ── Step 6: Submit on-chain ───────────────────────────────────────────────
    // WHY: We use the relayer's own ethers.Wallet (funded by us) to pay gas.
    //      The `submitter` argument is the DEVICE address — this is what gets
    //      indexed in the Anchored event, preserving the chain of custody.
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const signer = relayerWallet.connect(provider);
    const registry = new ethers.Contract(contractAddress, REGISTRY_ABI, signer);

    // Estimate gas first so we can detect failures before spending gas.
    let gasEstimate;
    try {
        gasEstimate = await registry.anchor.estimateGas(
            body.merkleRoot,
            effectiveDeviceAddress,
            BigInt(body.ntpTimestamp),
            metadataBytes
        );
    } catch (err) {
        throw Object.assign(
            new Error(`Gas estimation failed — contract likely rejected: ${err.message}`),
            { statusCode: 422 }
        );
    }

    // Add 20% buffer to gas estimate
    // WHY: L2 gas pricing can fluctuate between estimation and inclusion.
    const gasLimit = (gasEstimate * 120n) / 100n;

    const tx = await registry.anchor(
        body.merkleRoot,
        effectiveDeviceAddress,
        BigInt(body.ntpTimestamp),
        metadataBytes,
        { gasLimit }
    );

    console.log(`[relayer] Submitted txHash=${tx.hash} merkleRoot=${body.merkleRoot}`);

    // WHY wait for 1 confirmation: gives the client a confirmed block number.
    // We don't wait for more — on L2s, 1 confirmation is typically sufficient
    // for finality purposes (proven batch finality follows later on L1).
    const receipt = await tx.wait(1);

    // WHY only after confirmation: dedup means "already anchored", not
    // "already attempted" — a failed/crashed submission that never actually
    // confirmed on-chain should still be retryable.
    anchorStore.record(body.merkleRoot);

    // Notificar al social layer para indexar la prueba
    const socialApiUrl = process.env.SOCIAL_API_URL;
    if (socialApiUrl) {
        fetch(`${socialApiUrl}/api/anchor`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${process.env.SOCIAL_API_SECRET}`,
            },
            body: JSON.stringify({
                merkleRoot: body.merkleRoot,
                sha256Hex: body.sha256Hex,
                pHashHex: body.pHashHex,
                txHash: receipt.hash,
                blockNumber: receipt.blockNumber,
                submitter: effectiveDeviceAddress,
                timestamp: Number(body.ntpTimestamp),
            }),
        }).catch(err => {
            // WHY fire-and-forget: la prueba ya está en la blockchain.
            // Si el social layer falla, la prueba no se pierde — solo
            // no aparece en el índice hasta el próximo retry.
            console.warn("[relayer] Social layer index failed:", err.message);
        });
    }

    return {
        txHash: receipt.hash,
        blockNumber: receipt.blockNumber,
        networkId: chainId,
        ntpValidation: {
            relayerNtpTimestampMs: ntpValidation.ntpTimestampMs,
            driftMs: ntpValidation.driftMs,
            reliable: ntpValidation.reliable,
            warning: ntpValidation.warning,
        },
    };
}

module.exports = { processAnchorRequest };
