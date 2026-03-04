/**
 * eip712.js — EIP-712 Structured Data Verification
 *
 * WHY EIP-712: Standard structured-data signing ensures the device's
 * signature is over a SPECIFIC, human-readable payload — not an arbitrary
 * hash. This prevents relay attacks where a valid signature over one
 * PeerPar proof could be replayed for a different proof.
 *
 * EIP-712 domain-separation also ensures a signature produced by the
 * PeerPar app cannot be reused in any other EIP-712 application.
 */

const { ethers } = require("ethers");

// ── EIP-712 Domain ────────────────────────────────────────────────────────────
// WHY chainId in domain: ties the signature to a specific L2, preventing
// cross-chain replay of the same signed payload.
// WHY verifyingContract: even if another app uses the same type schema,
// our contract address makes the domain unique.
const DOMAIN_NAME = "PeerParProtocol";
const DOMAIN_VERSION = "1";

/**
 * Build the EIP-712 domain object for a given chain and contract.
 * @param {number|bigint} chainId
 * @param {string} verifyingContract  — the ProofRegistry contract address
 */
function buildDomain(chainId, verifyingContract) {
    return {
        name: DOMAIN_NAME,
        version: DOMAIN_VERSION,
        chainId: Number(chainId),
        verifyingContract,
    };
}

// ── EIP-712 Type Schema ───────────────────────────────────────────────────────
// WHY a flat schema: nested types add indirection and make type-hash
// computation harder to audit. We keep all fields at the top level.
const PROOF_TYPES = {
    Proof: [
        { name: "merkleRoot", type: "bytes32" },
        { name: "sha256Hex", type: "string" },
        { name: "pHashHex", type: "string" },
        { name: "ntpTimestamp", type: "uint64" },
        { name: "ntpOffsetMs", type: "int32" },
        { name: "gpsLat", type: "int64" }, // scaled ×10^6
        { name: "gpsLon", type: "int64" }, // scaled ×10^6
        { name: "gpsAcc", type: "uint32" }, // scaled ×10^3 (metres)
        { name: "deviceModel", type: "string" },
        { name: "osVersion", type: "string" },
        { name: "appVersion", type: "string" },
    ],
};

/**
 * Recover the signer address from an EIP-712 structured payload + signature.
 *
 * WHY we use ethers.verifyTypedData: it handles EIP-712 hash construction
 * (domain separator + structHash + prefix bytes) correctly. We do NOT
 * manually construct the hash — that is error-prone and has caused real
 * security bugs in the wild.
 *
 * @param {object} domain         — from buildDomain()
 * @param {object} payload        — the Proof struct values
 * @param {string} signature      — hex signature from device
 * @returns {string}              — recovered signer address (checksummed)
 */
function recoverSigner(domain, payload, signature) {
    return ethers.verifyTypedData(domain, PROOF_TYPES, payload, signature);
}

/**
 * Verify that the EIP-712 signature was produced by the expected signer.
 *
 * @param {object} domain
 * @param {object} payload
 * @param {string} signature
 * @param {string} expectedSigner  — device address registered in our system
 * @returns {{ valid: boolean, recovered: string }}
 */
function verifyPayload(domain, payload, signature, expectedSigner) {
    const recovered = recoverSigner(domain, payload, signature);
    const valid =
        recovered.toLowerCase() === expectedSigner.toLowerCase();
    return { valid, recovered };
}

/**
 * ABI-encode the metadata blob that goes into the contract as calldata.
 *
 * WHY ABI-encode at the relayer: the relayer is the one calling the contract,
 * so it constructs the calldata. The device sends structured JSON; the relayer
 * converts to the compact ABI form. This way the Solidity types stay canonical.
 *
 * @param {object} payload  — validated proof payload
 * @returns {string}        — hex-encoded ABI bytes
 */
function encodeMetadata(payload) {
    const abiCoder = ethers.AbiCoder.defaultAbiCoder();
    return abiCoder.encode(
        ["int64", "int64", "uint32", "string", "string", "string", "int32"],
        [
            BigInt(payload.gpsLat),
            BigInt(payload.gpsLon),
            BigInt(payload.gpsAcc),
            payload.deviceModel,
            payload.osVersion,
            payload.appVersion,
            Number(payload.ntpOffsetMs),
        ]
    );
}

module.exports = {
    DOMAIN_NAME,
    DOMAIN_VERSION,
    PROOF_TYPES,
    buildDomain,
    recoverSigner,
    verifyPayload,
    encodeMetadata,
};
