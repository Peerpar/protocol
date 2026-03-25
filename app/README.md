# PeerPar Mobile App (Expo)

This is the mobile client for the PeerPar protocol, built with **React Native** and **Expo**. It handles media capture, cryptographic hashing, and proof submission to the relayer.

## Features

- **Secure Capture**: Real-time hashing of camera frames.
- **On-Device Signing**: EIP-712 signing using the device's Secure Enclave (simulated in dev).
- **Proof-of-Existence**: Generates a Merkle Tree of photo/video hashes.
- **Local Storage**: SQL-lite database for storing transaction hashes and proof metadata.

## Directory Structure

- `src/components`: UI components (Camera, Buttons, etc.).
- `src/crypto`: Hashing and signing logic.
- `src/db`: Local database management.
- `src/screens`: App screens (Capture, Gallery, Settings).
- `src/services`: API clients for the relayer.

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [Expo Go](https://expo.dev/client) app on your physical device (optional, for testing)

### Installation

```bash
npm install
```

### Running the App

```bash
npx expo start
```

Use the Expo Go app to scan the QR code or run in an emulator (press `i` for iOS or `a` for Android).

## Trust Assumptions

The app assumes the device's Secure Enclave is untampered. For a full breakdown of the protocol's trust model, see **[TRUST_MODEL.md](../TRUST_MODEL.md)** in the root directory.

## License

MIT
