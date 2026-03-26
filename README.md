# PeerPar Protocol

> **"This record proves that a file existed in exactly this form at approximately this time."**
>
> It does **not** prove the content is genuine or unedited.

PeerPar is an open-source, mobile-first media authenticity protocol. It gives anyone — including journalists in conflict zones — a **free, instant, tamper-evident cryptographic record** of any photo or video they capture.

---

## ⚠️ Read This First

Before using PeerPar in any legal, journalistic, or evidentiary context, read **[TRUST_MODEL.md](./TRUST_MODEL.md)**. It documents precisely what the system proves, what it does not prove, and where each trust assumption lives.

**Short version:**
- ✅ Proves the **exact file** existed at **approximately this time**
- ✅ Signed by a **specific device's hardware-secured key**
- ✅ Record is **permanent and immutable** on Base L2
- ❌ Does NOT prove the content is real, original, or accurate
- ❌ Does NOT prove anything that happened before you pressed record

---

## 🏛 The Tri-Repository Strategy

PeerPar is strategically split into three repositories to keep the forensic hashing layer strictly separated from the broader social platform and browser extensions.

1. **The Protocol Layer (This Repo):** The mobile camera app, L2 smart contracts, and gas relayer. It generates the cryptographic proofs.
2. **The Social Layer (Next.js Repo):** The public square where users interact, verify, and map contextual truth onto these cryptographic proofs.
3. **The Access Layer (Browser Extension Repo):** Translates these proofs directly into social media feeds (Twitter, etc.) and acts as a funnel pointing users towards the Social Layer for context.

---

## How It Works (v0.1.0)

```
[Camera captures photo → temp file:// URI in app sandbox]
    │
    ▼  NTP timestamp acquired
    ▼  GPS coordinates acquired
[SHA-256 computed from saved file]
[pHash — zero placeholder, see roadmap]
[Metadata hash computed — GPS, timestamp, device, app version]
    │
    ▼  3-leaf Merkle tree built on-device
    │  [sha256Hex, pHashHex, metadataHash]
    │
    ▼  EIP-712 signed with device Secure Enclave key
[Relayer verifies signature & submits]
    │
    ▼  contract.anchor(merkleRoot) via calldata on Base L2
[TxHash + proof stored in local SQLite DB]
[Social layer notified — AnchorIndex updated]
    │
    ▼  File saved to device gallery ← LAST STEP
```

The file is **never sent to any server** (unless the user explicitly opts into optional backup). The on-chain anchor is paid by the relayer — free to the user.

### Implementation note: hashing occurs post-codec (v0.1.0)

SHA-256 is computed from the saved file after the device codec writes to disk. The hash reflects the compressed output, not raw sensor frames. Pre-codec frame interception is planned for v0.3.0. See `TRUST_MODEL.md` for full implications.

---

## Roadmap

| Version | Milestone | Status |
|---|---|---|
| v0.1.0 | SHA-256 proof-of-existence, EIP-712 signing, relayer, SQLite, verification portal | ✅ Live on Base Sepolia |
| v0.2.0 | pHash (perceptual hash), Merkle Timeline, decentralised relayer (OpenGSN), multi-sig | 🔜 Planned |
| v0.3.0 | TEE / Secure Enclave raw frame interception — pre-codec hashing | 🔜 Planned |
| v0.4.0 | PeerPar Social Layer integration | 🔜 Planned |
| v1.0.0 | Browser Extension — verification directly on social networks via Merkle Proofs | 🔜 Planned |

---

## Repository Structure

```
peerpar/
├── contracts/      Solidity — ProofRegistry.sol (Base L2 / Polygon zkEVM)
├── relayer/        Node.js — EIP-712 verified gas relayer
├── app/            React Native (Expo) — iOS + Android client
├── portal/         React web — public file verification tool
├── TRUST_MODEL.md  ← read this first
└── README.md
```

---

## Quickstart

### Prerequisites
- Node.js ≥ 18
- Expo CLI: `npm install -g expo-cli`
- Hardhat (for contract work): installed in `/contracts`

### 1. Smart Contract (local dev)
```bash
cd contracts
npm install
npx hardhat node          # local chain
npx hardhat run scripts/deploy.js --network localhost
```

### 2. Relayer
```bash
cd relayer
npm install
cp .env.example .env      # fill in RELAYER_PRIVATE_KEY, CONTRACT_ADDRESS, RPC_URL, CHAIN_ID
node src/server.js
```

### 3. Mobile App
```bash
cd app
npm install
npx expo start            # Expo Go
npx expo start --tunnel   # for physical device on a different network
```

### 4. Verification Portal
```bash
cd portal
npm install
npm start
```

---

## Core Principles (Never Violated)

1. **Hash-before-store** — hashing happens before the file reaches the gallery
2. **Free to user** — the relayer pays all gas
3. **Open source** — no proprietary black boxes
4. **Honest scope** — the system makes no claim beyond what it can mathematically prove

---

## License

MIT — see `LICENSE` in each subpackage.