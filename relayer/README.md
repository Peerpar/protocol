# Relayer — Trust Assumptions & README

## What This Module Does

The PeerPar relayer is a Node.js + Express server that:

1. Receives signed proof payloads from the mobile app (EIP-712 structured data)
2. Verifies the device signature is authentic
3. Cross-validates the device timestamp against its own NTP query
4. Submits `anchor()` to the ProofRegistry contract on-chain
5. Pays the gas — the user pays nothing
6. Returns the transaction hash and NTP validation result

## Why a Relayer?

Without a relayer, the user would need to:
- Hold ETH/MATIC in a self-custody wallet
- Pay variable gas fees
- Manage private keys outside the app's Secure Enclave

The relayer makes the system **free and frictionless** to the user. The tradeoff is centralization (see below).

## Trust Assumptions

| Assumption | Risk | Mitigation Path |
|---|---|---|
| Relayer submits proofs promptly | 🟡 Medium — relayer could delay or drop submissions | Decentralised relay network (OpenGSN) in v0.2 |
| Relayer key security | 🔴 High — if the relayer private key is compromised, attacker can submit any proof under the relayer's authority | Hardware wallet / HSM for relayer key; multi-sig ownership |
| Relayer privacy | 🟡 Medium — relayer sees all proof metadata (GPS, device model, etc.) | End-to-end encrypted metadata payload in v0.2 |
| Rate limiting is effective | 🟢 Low — 10 req/min/IP; gas cost is the ultimate throttle | |

**What the relayer CANNOT do:**
- Forge a device signature (EIP-712 signature is verified by the relayer and recoverable by anyone)
- Alter the Merkle root in a submitted proof (it's passed through, not reconstructed)
- Backdate a proof (block timestamp is set by the L2 sequencer, not the relayer)

## API

### `POST /anchor`

**Request body:**
```json
{
  "merkleRoot":    "0x<32-byte hex>",
  "sha256Hex":     "<64-char hex>",
  "pHashHex":      "<16-char hex>",
  "ntpTimestamp":  1700000000,
  "ntpOffsetMs":   -120,
  "gpsLat":        40712800,
  "gpsLon":        -74006000,
  "gpsAcc":        5000,
  "deviceModel":   "iPhone 15 Pro",
  "osVersion":     "iOS 17.2",
  "appVersion":    "1.0.0",
  "deviceAddress": "0x<device EOA>",
  "signature":     "0x<EIP-712 sig>"
}
```

**Response (success):**
```json
{
  "success": true,
  "txHash": "0x...",
  "blockNumber": 12345,
  "networkId": 84532,
  "ntpValidation": {
    "relayerNtpTimestampMs": 1700000000000,
    "driftMs": 120,
    "reliable": true,
    "warning": null
  }
}
```

### `GET /health`
Liveness probe — returns relayer address, contract address, chain ID, and current timestamp.

## Environment Variables

See `.env.example`.

## Running

```bash
npm install
cp .env.example .env   # fill in required vars
node src/server.js

# or, for development with auto-reload:
npm run dev
```

## Testing

```bash
npm test
```

Tests cover EIP-712 signer recovery, NTP drift validation, and payload structure validation.

## License

MIT
