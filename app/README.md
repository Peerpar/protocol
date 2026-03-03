# PeerPar App — Trust Assumptions & README

## What This Module Does

The React Native (Expo) app is the primary interface for capturing media and generating cryptographic proofs.

## Chain of Custody (Order is CRITICAL)

```
1. Camera captures frame → temp file in app sandbox
2. NTP timestamp acquired from Cloudflare
3. GPS acquired from device
4. SHA-256 + pHash computed from temp file bytes   ← CORE GUARANTEE
5. Metadata hash computed
6. Merkle tree built (3 leaves) on-device
7. EIP-712 signed with device Secure Enclave key
8. Proof saved to SQLite (status: pending)
9. Signed payload submitted to relayer (async)
10. File saved to device gallery                   ← LAST
```

**Steps 4–9 must always occur before step 10. Changing this order violates the chain of custody.**

## Trust Assumptions

| Assumption | Risk | Notes |
|---|---|---|
| Device OS is not compromised | 🔴 High | Root/jailbreak could allow key extraction or hash tampering |
| expo-secure-store uses hardware | 🟡 Medium | Hardware-backed on devices with Secure Enclave / StrongBox; software on others |
| **Private key enters JS memory during signing** | 🟡 Medium | **Documented limitation in v0.1.0** — true HSM signing requires a custom native module (v0.3 milestone) |
| NTP is reachable | 🟢 Low | Falls back to device clock with flag if offline |
| GPS is accurate | 🟡 Medium | Can be spoofed on rooted devices |

## Setup

```bash
npm install
cp .env.example .env   # set EXPO_PUBLIC_* vars
npx expo start
```

## Environment Variables

```env
EXPO_PUBLIC_RELAYER_URL=http://localhost:3001
EXPO_PUBLIC_CONTRACT_ADDRESS=0x...
EXPO_PUBLIC_CHAIN_ID=84532
EXPO_PUBLIC_PORTAL_URL=https://verify.peerpar.io
```

## License

MIT
