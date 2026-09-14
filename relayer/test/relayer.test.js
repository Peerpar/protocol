/**
 * relayer.test.js — Tests for processAnchorRequest()
 *
 * Focus: the signature-validity gate. verifyPayload() computes { valid,
 * recovered }, and processAnchorRequest() must actually reject the request
 * when valid is false instead of silently anchoring under the recovered
 * address anyway. This mocks out the network-touching parts (the on-chain
 * contract call and the NTP query) so the test exercises real EIP-712
 * signing/verification without hitting a real RPC endpoint or UDP socket.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { ethers } = require("ethers");
const { createAnchorStore } = require("../src/anchorStore");

jest.mock("ethers", () => {
    const actual = jest.requireActual("ethers");
    // ethers v6 exposes its classes both as top-level named exports AND
    // nested under an `ethers` namespace object (`require("ethers").ethers`)
    // — relayer.js and this test both do `const { ethers } = require("ethers")`,
    // so the overrides must replace the classes on THAT nested object too,
    // not just the top-level exports.
    const JsonRpcProvider = jest.fn().mockImplementation(() => ({}));
    const Contract = jest.fn();
    return {
        ...actual,
        JsonRpcProvider,
        Contract,
        ethers: { ...actual.ethers, JsonRpcProvider, Contract },
    };
});

jest.mock("../src/ntpClient", () => ({
    validateTimestamp: jest.fn().mockResolvedValue({
        ntpTimestampMs: Date.now(),
        deviceTimestampMs: Date.now(),
        driftMs: 5,
        reliable: true,
        warning: null,
    }),
}));

const { processAnchorRequest } = require("../src/relayer");
const { buildDomain, PROOF_TYPES } = require("../src/eip712");

const TEST_WALLET = ethers.Wallet.fromPhrase(
    "test test test test test test test test test test test junk"
);
const OTHER_WALLET = ethers.Wallet.createRandom();

const CHAIN_ID = 84532;
const CONTRACT_ADDRESS = "0x1234567890123456789012345678901234567890";

// WHY a fresh anchorStore per test (see beforeEach below): without this,
// every test in this file would share relayer.js's real on-disk default
// store, so a merkleRoot recorded by one test run would make a later run
// of "anchors when the signature matches" fail with a false 409 — the
// exact persistence-across-restarts behavior anchorStore.js is supposed to
// have, just landing on the wrong (real) file if we don't isolate it here.
const RELAYER_CONFIG = {
    contractAddress: CONTRACT_ADDRESS,
    rpcUrl: "http://localhost:8545",
    relayerWallet: ethers.Wallet.createRandom(),
    chainId: CHAIN_ID,
};

function useIsolatedAnchorStore() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "relayer-test-"));
    RELAYER_CONFIG.anchorStore = createAnchorStore(path.join(dir, "roots.log"));
}

function makeBody(overrides = {}) {
    return {
        merkleRoot: ethers.keccak256(ethers.toUtf8Bytes("test-merkle-root")),
        sha256Hex: "a".repeat(64),
        pHashHex: "b".repeat(16),
        ntpTimestamp: 1_700_000_000,
        ntpOffsetMs: -120,
        gpsLat: 40712800,
        gpsLon: -74006000,
        gpsAcc: 5000,
        deviceModel: "Test Device",
        osVersion: "iOS 17.0",
        appVersion: "1.0.0",
        deviceAddress: TEST_WALLET.address,
        ...overrides,
    };
}

/** Sign the EIP-712 payload derived from `body` with the given wallet. */
async function signBody(wallet, body) {
    const domain = buildDomain(CHAIN_ID, CONTRACT_ADDRESS);
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
    return wallet.signTypedData(domain, PROOF_TYPES, payload);
}

function mockContractSuccess() {
    const anchorFn = jest.fn().mockResolvedValue({
        hash: "0xfeed000000000000000000000000000000000000000000000000000000000",
        wait: jest.fn().mockResolvedValue({
            hash: "0xfeed000000000000000000000000000000000000000000000000000000000",
            blockNumber: 12345,
        }),
    });
    anchorFn.estimateGas = jest.fn().mockResolvedValue(80_000n);

    ethers.Contract.mockImplementation(() => ({ anchor: anchorFn }));
    return anchorFn;
}

describe("processAnchorRequest — signature validation", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        delete process.env.SOCIAL_API_URL;
        useIsolatedAnchorStore();
    });

    test("anchors when the signature matches the declared deviceAddress", async () => {
        const anchorFn = mockContractSuccess();
        const body = makeBody();
        body.signature = await signBody(TEST_WALLET, body);

        const result = await processAnchorRequest(body, RELAYER_CONFIG);

        expect(result.txHash).toBe(
            "0xfeed000000000000000000000000000000000000000000000000000000000"
        );
        expect(result.blockNumber).toBe(12345);
        expect(anchorFn).toHaveBeenCalledWith(
            body.merkleRoot,
            TEST_WALLET.address,
            BigInt(body.ntpTimestamp),
            expect.any(String),
            expect.any(Object)
        );
    });

    test("rejects with 401 when the signer does not match the declared deviceAddress, without anchoring", async () => {
        const anchorFn = mockContractSuccess();
        const body = makeBody({ deviceAddress: OTHER_WALLET.address });
        // Signed by TEST_WALLET but claims to be OTHER_WALLET's proof.
        body.signature = await signBody(TEST_WALLET, body);

        await expect(processAnchorRequest(body, RELAYER_CONFIG)).rejects.toMatchObject({
            statusCode: 401,
        });
        expect(anchorFn).not.toHaveBeenCalled();
        expect(anchorFn.estimateGas).not.toHaveBeenCalled();
    });

    test("rejects with 401 when the payload was tampered with after signing", async () => {
        const anchorFn = mockContractSuccess();
        const body = makeBody();
        body.signature = await signBody(TEST_WALLET, body);
        // Tamper with a signed field after signing.
        body.sha256Hex = "c".repeat(64);

        await expect(processAnchorRequest(body, RELAYER_CONFIG)).rejects.toMatchObject({
            statusCode: 401,
        });
        expect(anchorFn).not.toHaveBeenCalled();
    });

    test("rejects with 400 on a missing required field, before touching the chain", async () => {
        const anchorFn = mockContractSuccess();
        const body = makeBody();
        body.signature = await signBody(TEST_WALLET, body);
        delete body.sha256Hex;

        await expect(processAnchorRequest(body, RELAYER_CONFIG)).rejects.toMatchObject({
            statusCode: 400,
        });
        expect(anchorFn).not.toHaveBeenCalled();
    });
});

describe("processAnchorRequest — replay / duplicate-anchor rejection", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        delete process.env.SOCIAL_API_URL;
        useIsolatedAnchorStore();
    });

    test("rejects a second submission of the same merkleRoot with 409, without spending gas again", async () => {
        const anchorFn = mockContractSuccess();
        const body = makeBody();
        body.signature = await signBody(TEST_WALLET, body);

        const first = await processAnchorRequest(body, RELAYER_CONFIG);
        expect(first.txHash).toBe(
            "0xfeed000000000000000000000000000000000000000000000000000000000"
        );
        expect(anchorFn).toHaveBeenCalledTimes(1);

        // Replay the exact same (still validly signed) request.
        await expect(processAnchorRequest(body, RELAYER_CONFIG)).rejects.toMatchObject({
            statusCode: 409,
        });
        // No second on-chain call — this is what actually stops the
        // relayer wallet from being drained by a replayed request.
        expect(anchorFn).toHaveBeenCalledTimes(1);
        expect(anchorFn.estimateGas).toHaveBeenCalledTimes(1);
    });

    test("a merkleRoot is not recorded until the transaction actually confirms", async () => {
        const failingAnchor = jest.fn().mockRejectedValue(new Error("network error"));
        failingAnchor.estimateGas = jest.fn().mockResolvedValue(80_000n);
        ethers.Contract.mockImplementation(() => ({ anchor: failingAnchor }));

        const body = makeBody();
        body.signature = await signBody(TEST_WALLET, body);

        await expect(processAnchorRequest(body, RELAYER_CONFIG)).rejects.toThrow("network error");

        // A retry of the same root after a failed submission must still be
        // allowed — dedup means "already anchored", not "already attempted".
        expect(RELAYER_CONFIG.anchorStore.has(body.merkleRoot)).toBe(false);
    });

    test("a different merkleRoot from the same device is unaffected", async () => {
        const anchorFn = mockContractSuccess();
        const bodyA = makeBody();
        bodyA.signature = await signBody(TEST_WALLET, bodyA);
        await processAnchorRequest(bodyA, RELAYER_CONFIG);

        const bodyB = makeBody({
            merkleRoot: ethers.keccak256(ethers.toUtf8Bytes("a-different-root")),
        });
        bodyB.signature = await signBody(TEST_WALLET, bodyB);

        const second = await processAnchorRequest(bodyB, RELAYER_CONFIG);
        expect(second.txHash).toBe(
            "0xfeed000000000000000000000000000000000000000000000000000000000"
        );
        expect(anchorFn).toHaveBeenCalledTimes(2);
    });
});
