# Contracts — Trust Assumptions & README

## What This Module Does

`ProofRegistry.sol` is the on-chain anchor for PeerPar proofs. When a user captures a photo or video, the app:

1. Computes SHA-256 + pHash of the raw bytes
2. Builds a 3-leaf Merkle tree on-device
3. Signs the Merkle root with the device key (EIP-712)
4. Sends the signed payload to the relayer
5. **The relayer calls `anchor(merkleRoot, ...)` here**

The contract emits an `Anchored` event. All proof data lives in calldata — **zero state is written**.

---

## Architecture Decision: No On-Chain Storage

Traditional approaches store proofs in a `mapping(bytes32 => ProofData)`. We deliberately avoid this because:

- **Cost**: An SSTORE costs ~20,000 gas. A log entry costs ~375 gas base + ~8 gas/byte for non-zero calldata. For a 200-byte metadata payload, the log path is ~100x cheaper.
- **Permanence**: Calldata and event logs are equally permanent (they cannot be pruned from full nodes and are part of the canonical chain).
- **Simplicity**: No storage slots = no upgrade risk for stored data.

The tradeoff is that you cannot query on-chain state directly — you must use `eth_getLogs`. The verification portal and relayer both use this approach.

---

## Trust Assumptions

| Assumption | Risk Level | Notes |
|---|---|---|
| Relayer is a single EOA | 🟡 Medium | Single point of failure. Planned mitigation: OpenGSN / decentralised relay in v0.2. |
| Block timestamp within ±15 min | 🟢 Low | Ethereum consensus enforces this. |
| L2 sequencer honesty | 🟡 Medium | Base and Polygon zkEVM have fraud/validity proof mechanisms. Ultimately settles to L1. |
| Contract code is correct | 🟢 Low | Minimal logic (emit + two checks). Audit surface is tiny. |

---

## Deployment

```bash
npm install
# Start local node (for development)
npm run node

# Deploy locally
npm run deploy:local

# Deploy to Base Sepolia testnet
cp .env.example .env   # fill in DEPLOYER_PRIVATE_KEY, RELAYER_ADDRESS
npm run deploy:baseSepolia

# Run tests
npm test
npm run test:gas       # shows gas usage per function
```

---

## Environment Variables

See `.env.example`.

---

## Verification on Block Explorer

After deployment:
```bash
npx hardhat verify --network baseSepolia <CONTRACT_ADDRESS> <RELAYER_ADDRESS>
```

---

## License

MIT
