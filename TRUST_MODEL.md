# PeerPar Protocol — Trust Model

> **Plain-language summary:** PeerPar proves that a specific file existed in exactly this binary form
> at approximately this moment in time. It does **not** prove the content is real, accurate, or
> unmanipulated prior to the moment of capture.

---

## What the System PROVES

| Claim | How it is proven |
|---|---|
| **This exact file existed** | SHA-256 hash of binary content anchored to a public blockchain. Any bit-change produces a completely different hash. |
| **At approximately this time** | NTP-synchronized timestamp included in the signed payload. The relayer cross-validates against its own NTP clock. Both are recorded. |
| **By this device** | The device generates a keypair on first launch, backed by iOS Secure Enclave / Android Keystore. The device signature is included in the relayer payload. |
| **With this location** | GPS coordinates from `expo-location` included in metadata. |
| **The file was not altered after anchoring** | SHA-256 is collision-resistant. Re-computing the hash of the file at any future date will match the on-chain anchor if and only if the file is byte-identical. In addition, **Perceptual Hashing (p-Hash) & Merkle Timelines** allow partial-video verification: a snippet on social media can be verified against the original Merkle Root to prove that specific section is authentic, even if the video was compressed. |
| **The record is permanent** | Calldata on Base L2 / Polygon zkEVM is immutable; it cannot be deleted. |

---

## What the System Does NOT PROVE

| Claim | Why it is NOT proven |
|---|---|
| **The content is real or accurate** | PeerPar cannot verify what the camera was pointed at. A generated or pre-edited image can be anchored just as easily as an authentic one. (Additionally, while p-hashes survive social media compression, heavy adversarial manipulation or deepfake filters may alter the p-hash, causing verification against the Merkle Root to safely fail). |
| **Nothing happened before you pressed record** | Chain of custody begins at the moment `record()` is called. We make no claim about the origin or pre-processing of the raw frames. |
| **The device clock was not spoofed** | NTP offset is flagged if > 30 seconds, but a determined adversary with OS-level access can manipulate the system clock before NTP sync. |
| **The GPS coordinates are accurate** | GPS can be spoofed on rooted (Android) or jailbroken (iOS) devices. Accuracy is reported alongside the coordinates, but is self-reported by the OS. |
| **The relayer is neutral** | The relayer is currently a single EOA controlled by the PeerPar team. It could delay, reorder, or drop submissions. This is an acknowledged centralisation risk (see `/relayer/README.md`). |
| **The device was not compromised** | If an attacker has root access or has replaced the app binary, the Secure Enclave / Keystore key could have been extracted or the hash computed over different data. |
| **IPFS content is preserved** | IPFS pinning is opt-in and not guaranteed. The on-chain anchor is the authoritative record; IPFS is a convenience backup only. |

---

## Trust Assumptions by Layer

### Device Layer
- The OS has not been compromised (no root / jailbreak).
- The app binary has not been tampered with.
- The Secure Enclave (iOS) / StrongBox Keymaster (Android) is functioning correctly.
- The camera hardware has not been modified to inject fake frames.

### Network / Time Layer
- The NTP pool (`pool.ntp.org`) is contactable and returning honest time.
- Device clock drift is < 30 seconds (flagged if not).
- The network path to the relayer has not been man-in-the-middle attacked (TLS).

### Relayer Layer
- The relayer submits transactions promptly and does not censor specific users.
- The relayer's private key is not compromised.
- **Mitigation path:** Replace single-EOA relayer with a decentralised OpenGSN-style relay network in v0.2.

### Blockchain Layer
- The L2 sequencer for Base / Polygon zkEVM is not including fraudulent state transitions.
- The L1 (Ethereum mainnet) finality provides ultimate security for calldata permanence.
- Block timestamps are within ±15 minutes of real time (Ethereum consensus guarantee).

### Verification Portal Layer & Social Ecosystem
- The verifier re-hashes the uploaded file entirely in-browser. The portal never sends the file to a server.
- Block explorer APIs queried by the portal could be temporarily unavailable or return stale data.
- **The Social Layer (Next.js Application)** provides contextual human and AI evaluations of the media. The Protocol proves *existence*; the Social Layer debates *meaning*.

---

## Disclaimer (displayed in-app and on portal)

> "This record proves that the file shown existed in exactly this form at approximately the time
> shown. It does **not** prove that the content is genuine, unedited prior to capture, or that
> it accurately depicts real events. Chain of custody begins at the moment of capture by this app."
