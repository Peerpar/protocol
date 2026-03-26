/**
 * server.js — PeerPar Relayer HTTP Server
 *
 * Exposes a single POST /anchor endpoint. The mobile app submits
 * a signed proof payload here; this server verifies and anchors it on-chain.
 *
 * Rate limiting: 10 requests per minute per IP.
 * CORS: Locked to registered origins (portal URL + mobile apps).
 */

require("dotenv").config();

const express = require("express");
const rateLimit = require("express-rate-limit");
const cors = require("cors");
const helmet = require("helmet");
const { ethers } = require("ethers");
const { processAnchorRequest } = require("./relayer");

// ── Environment validation ────────────────────────────────────────────────────
const REQUIRED_ENV = [
    "RELAYER_PRIVATE_KEY",
    "CONTRACT_ADDRESS",
    "RPC_URL",
    "CHAIN_ID",
];
for (const key of REQUIRED_ENV) {
    if (!process.env[key]) {
        console.error(`[server] Fatal: missing environment variable: ${key}`);
        process.exit(1);
    }
}

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3001;
const CHAIN_ID = parseInt(process.env.CHAIN_ID, 10);

// WHY: Reconstruct the wallet from the private key at startup.
// The wallet object is kept in memory — it is never serialised or logged.
const relayerWallet = new ethers.Wallet(process.env.RELAYER_PRIVATE_KEY);
console.log(`[server] Relayer wallet: ${relayerWallet.address}`);

// Relayer config passed to processAnchorRequest
const relayerConfig = {
    contractAddress: process.env.CONTRACT_ADDRESS,
    rpcUrl: process.env.RPC_URL,
    relayerWallet,
    chainId: CHAIN_ID,
};

// ── Middleware ─────────────────────────────────────────────────────────────────

// WHY helmet: sets security-relevant HTTP headers (X-Frame-Options, etc.)
// with minimal configuration.
app.use(helmet());

// WHY cors with allowlist: the verification portal and mobile app should be
// the only callers. Restricting CORS also limits the blast radius if our
// API key leaks.
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);

app.use(
    cors({
        origin: (origin, callback) => {
            // Allow no-origin (mobile apps, curl) or explicitly allowed origins
            if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
                callback(null, true);
            } else {
                callback(new Error(`CORS: origin ${origin} not allowed`));
            }
        },
        methods: ["GET", "POST"],
    })
);

app.use(express.json({ limit: "64kb" })); // WHY limit: prevent large-body DoS

// WHY rate limit per IP: the relayer pays gas. Without rate limiting,
// a single client could drain the relayer wallet.
const anchorLimiter = rateLimit({
    windowMs: 60_000,    // 1 minute
    max: 10,             // 10 proofs per minute per IP
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        error: "Too many proof requests from this IP, please wait 1 minute.",
    },
});

// ── Routes ─────────────────────────────────────────────────────────────────────

/**
 * GET /health
 * Simple liveness probe for load balancers / uptime monitors.
 */
app.get("/health", (req, res) => {
    res.json({
        status: "ok",
        relayerAddress: relayerWallet.address,
        contractAddress: process.env.CONTRACT_ADDRESS,
        chainId: CHAIN_ID,
        timestamp: Math.floor(Date.now() / 1000),
    });
});

/**
 * POST /anchor
 *
 * Body (JSON):
 *   merkleRoot      — bytes32 hex (0x...)
 *   sha256Hex       — string (64 hex chars)
 *   pHashHex        — string (16 hex chars, 64-bit perceptual hash)
 *   ntpTimestamp    — number (Unix seconds)
 *   ntpOffsetMs     — number (device-reported NTP offset, ms)
 *   gpsLat          — number (×10^6 integer, e.g. 40712800 = 40.7128°)
 *   gpsLon          — number (×10^6 integer)
 *   gpsAcc          — number (×10^3 integer, metres)
 *   deviceModel     — string
 *   osVersion       — string
 *   appVersion      — string
 *   deviceAddress   — string (Ethereum address of device key)
 *   signature       — string (EIP-712 signature, 0x...)
 *
 * Response (JSON):
 *   txHash          — string
 *   blockNumber     — number
 *   networkId       — number
 *   ntpValidation   — object (relayer's timestamp cross-check result)
 */
app.post("/anchor", anchorLimiter, async (req, res) => {
    try {
        const result = await processAnchorRequest(req.body, relayerConfig);
        res.json({ success: true, ...result });
    } catch (err) {
        const statusCode = err.statusCode || 500;
        console.error(`[server] /anchor error [${statusCode}]:`, err.message);
        res.status(statusCode).json({
            success: false,
            error: err.message,
        });
    }
});

// ── 404 handler ────────────────────────────────────────────────────────────────
app.use((req, res) => {
    res.status(404).json({ error: "Not found" });
});

// ── Start ──────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
    console.log(`[server] PeerPar Relayer listening on port ${PORT}`);
    console.log(`[server] Chain ID: ${CHAIN_ID}`);
    console.log(`[server] Contract: ${process.env.CONTRACT_ADDRESS}`);
});

module.exports = app; // exported for testing
