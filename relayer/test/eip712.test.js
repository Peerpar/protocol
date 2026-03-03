/**
 * eip712.test.js — Tests for EIP-712 payload verification
 *
 * We test that:
 *   1. A correctly signed payload recovers the expected signer
 *   2. A tampered payload produces a DIFFERENT signer (verification fails)
 *   3. The encodeMetadata function produces deterministic ABI output
 */

const { ethers } = require("ethers");
const { buildDomain, verifyPayload, encodeMetadata, PROOF_TYPES } = require("../src/eip712");

// A deterministic test wallet (never use in production — mnemonic is public)
const TEST_WALLET = ethers.Wallet.fromPhrase(
    "test test test test test test test test test test test junk"
);

const TEST_CHAIN_ID = 84532; // Base Sepolia
const TEST_CONTRACT = "0x1234567890123456789012345678901234567890";
const TEST_MERKLE_ROOT = ethers.keccak256(ethers.toUtf8Bytes("test-payload-1"));

const BASE_PAYLOAD = {
    merkleRoot: TEST_MERKLE_ROOT,
    sha256Hex: "a".repeat(64),
    pHashHex: "b".repeat(16),
    ntpTimestamp: BigInt(1700000000),
    ntpOffsetMs: -120,
    gpsLat: BigInt(40712800),
    gpsLon: BigInt(-74006000),
    gpsAcc: BigInt(5000),
    deviceModel: "Test Device",
    osVersion: "iOS 17.0",
    appVersion: "1.0.0",
};

async function signPayload(wallet, domain, payload) {
    return wallet.signTypedData(domain, PROOF_TYPES, payload);
}

describe("EIP-712 Verification", () => {
    let domain;

    beforeEach(() => {
        domain = buildDomain(TEST_CHAIN_ID, TEST_CONTRACT);
    });

    test("recovers correct signer for a valid signature", async () => {
        const sig = await signPayload(TEST_WALLET, domain, BASE_PAYLOAD);
        const { valid, recovered } = verifyPayload(domain, BASE_PAYLOAD, sig, TEST_WALLET.address);

        expect(valid).toBe(true);
        expect(recovered.toLowerCase()).toBe(TEST_WALLET.address.toLowerCase());
    });

    test("fails verification when payload is tampered", async () => {
        const sig = await signPayload(TEST_WALLET, domain, BASE_PAYLOAD);

        // Tamper: change merkleRoot after signing
        const tampered = {
            ...BASE_PAYLOAD,
            merkleRoot: ethers.keccak256(ethers.toUtf8Bytes("different-root")),
        };
        const { valid } = verifyPayload(domain, tampered, sig, TEST_WALLET.address);

        expect(valid).toBe(false);
    });

    test("fails verification when wrong signer is expected", async () => {
        const anotherWallet = ethers.Wallet.createRandom();
        const sig = await signPayload(TEST_WALLET, domain, BASE_PAYLOAD);
        const { valid } = verifyPayload(domain, BASE_PAYLOAD, sig, anotherWallet.address);

        expect(valid).toBe(false);
    });

    test("domain separation: different chainId produces different hash", async () => {
        const domain1 = buildDomain(84532, TEST_CONTRACT);
        const domain2 = buildDomain(8453, TEST_CONTRACT);

        const sig1 = await signPayload(TEST_WALLET, domain1, BASE_PAYLOAD);
        const { valid } = verifyPayload(domain2, BASE_PAYLOAD, sig1, TEST_WALLET.address);

        expect(valid).toBe(false); // signature for chain 84532 ≠ valid for chain 8453
    });

    test("encodeMetadata produces deterministic output for same inputs", () => {
        const encoded1 = encodeMetadata(BASE_PAYLOAD);
        const encoded2 = encodeMetadata(BASE_PAYLOAD);
        expect(encoded1).toBe(encoded2);
    });

    test("encodeMetadata produces different output for different GPS", () => {
        const alt = { ...BASE_PAYLOAD, gpsLat: BigInt(51508550) }; // London
        const enc1 = encodeMetadata(BASE_PAYLOAD);
        const enc2 = encodeMetadata(alt);
        expect(enc1).not.toBe(enc2);
    });
});
