# PeerPar Protocol

> **"This record proves that a file existed in exactly this form at approximately this time."**
>
> It does **not** prove the content is genuine or unedited.

PeerPar is an open-source, mobile-first media authenticity protocol. It gives anyone — including journalists in conflict zones — a **free, instant, tamper-evident cryptographic record** of any photo or video they capture.

---

## 🏛 The Dual-Repository Strategy

PeerPar is strategically split into two repositories to keep the forensic hashing layer strictly separated from the broader social platform.

1. **The Protocol Layer (This Repo):** The mobile camera app, L2 smart contracts, and gas relayer. It generates the cryptographic proofs.
2. **The Social Layer (Next.js Repo):** The public square where users interact, verify, and map contextual truth onto these cryptographic proofs.

---

## How It Works

```
[Camera frame in memory]
    │
    ▼  SHA-256 + pHash + metadata hash
[Merkle Tree built on-device]
    │
    ▼  EIP-712 signed with device Secure Enclave key
[Relayer verifies & submits]
    │
    ▼  contract.anchor(merkleRoot) via calldata on Base L2
[TxHash stored in local SQLite DB]
    │
    ▼  File saved to device gallery
```

The file is **never sent to any server** (unless the user explicitly opts into optional IPFS backup). The on-chain anchor is paid by the relayer — free to the user.

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

## ⚠️ Read This First

Before using PeerPar in any legal, journalistic, or evidentiary context, read **[TRUST_MODEL.md](./TRUST_MODEL.md)**. It documents precisely what the system proves, what it does not prove, and where each trust assumption lives.

**Short version:**
- ✅ Proves the **exact file** existed at **approximately this time**
- ❌ Does NOT prove the content is real, original, or accurate
- ❌ Does NOT prove anything that happened before you pressed record

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
cp .env.example .env      # fill in keys
node src/server.js
```

### 3. Mobile App
```bash
cd app
npm install
npx expo start
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
4. **Honest scope** — the system makes no claim about what happened before record was pressed

---

## Roadmap

| Version | Milestone |
|---|---|
| v0.1.0 (now) | Core proof-of-existence, relayer, verification portal |
| v0.2.0 | Decentralised relayer network (OpenGSN), multi-sig |
| v0.3.0 | TEE / Secure Enclave raw frame interception |
| v0.4.0 | PeerPar Social Layer |

---

## License

MIT — see `LICENSE` in each subpackage.
