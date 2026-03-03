/**
 * signer.js — EIP-712 Device Signing via Secure Enclave / Android Keystore
 *
 * WHY use the device's hardware security module?
 *
 * The device keypair is the chain-of-custody anchor for "who captured this".
 * If we stored the private key in app memory or AsyncStorage, an attacker
 * with app access could extract it and sign fake proofs under the device's
 * identity. Hardware-backed keystores prevent key extraction:
 *
 *   iOS Secure Enclave:  The private key is generated inside the SEP
 *     (Secure Enclave Processor) and never leaves it. Signing operations
 *     are performed inside the SEP; we only receive the signature.
 *
 *   Android StrongBox / Keymaster:  Similar hardware isolation on certified
 *     Android devices. expo-secure-store uses the Android Keystore system
 *     which can be backed by StrongBox (discrete HSM chip) or TEE.
 *
 * LIMITATION: expo-secure-store provides KEY-VALUE STORAGE backed by the
 * platform's secure element, but it does NOT provide raw Secp256k1 key
 * generation. We use ethers.js to generate the keypair, store the PRIVATE KEY
 * in the secure store, and perform signing in JS (not inside the HSM).
 *
 * TRUE HSM SIGNING (where the private key never enters JS memory) requires
 * a custom native module or TEE integration — this is documented as a
 * future milestone in TRUST_MODEL.md.
 *
 * CURRENT TRUST LEVEL: The private key is encrypted at rest by the OS's
 * hardware-backed keystore (AES-256-GCM with hardware-protected key material
 * on devices that support it). It enters JS memory only during signing and
 * is not persisted in plain text anywhere.
 */

import * as SecureStore from "expo-secure-store";
import { ethers } from "ethers";

const DEVICE_KEY_STORE_KEY = "peerpar_device_private_key";
const DEVICE_ADDR_STORE_KEY = "peerpar_device_address";

// EIP-712 domain and types — must match relayer/src/eip712.js exactly
const DOMAIN_NAME = "PeerParProtocol";
const DOMAIN_VERSION = "1";

const PROOF_TYPES = {
    Proof: [
        { name: "merkleRoot", type: "bytes32" },
        { name: "sha256Hex", type: "string" },
        { name: "pHashHex", type: "string" },
        { name: "ntpTimestamp", type: "uint64" },
        { name: "ntpOffsetMs", type: "int32" },
        { name: "gpsLat", type: "int64" },
        { name: "gpsLon", type: "int64" },
        { name: "gpsAcc", type: "uint32" },
        { name: "deviceModel", type: "string" },
        { name: "osVersion", type: "string" },
        { name: "appVersion", type: "string" },
    ],
};

/**
 * Retrieve the device keypair from secure storage, generating it if needed.
 *
 * WHY generate on first launch: we need a stable Ethereum address to
 * identify "this device" across all proofs it creates. Generating fresh
 * per session would make proofs unlinkable to a device, breaking the
 * chain of custody. The user can optionally export/backup their key.
 *
 * @returns {Promise<ethers.Wallet>}
 */
async function getOrCreateDeviceWallet() {
    let privateKey = await SecureStore.getItemAsync(DEVICE_KEY_STORE_KEY, {
        // WHY requireAuthentication: false for the key itself — we want signing
        // to be fast (background, no biometric prompt). Biometric confirmation
        // is a UX choice surfaced at the app level (camera capture button).
        requireAuthentication: false,
    });

    if (!privateKey) {
        // Generate a new random wallet. ethers.Wallet.createRandom() uses
        // a cryptographically secure random number generator.
        const wallet = ethers.Wallet.createRandom();
        privateKey = wallet.privateKey;

        // WHY keychainAccessible: AFTER_FIRST_UNLOCK — key is available as
        // soon as the user authenticates with their device PIN/biometric once
        // after a reboot. This prevents signing requests while the device is
        // locked but does not require re-authentication per signing.
        await SecureStore.setItemAsync(DEVICE_KEY_STORE_KEY, privateKey, {
            keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
        });
        await SecureStore.setItemAsync(DEVICE_ADDR_STORE_KEY, wallet.address, {
            keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
        });

        console.log("[signer] New device keypair generated:", wallet.address);
    }

    return new ethers.Wallet(privateKey);
}

/**
 * Sign a proof payload using EIP-712 structured data signing.
 *
 * @param {object} payload   — the Proof struct (must match PROOF_TYPES)
 * @param {number|bigint} chainId
 * @param {string} contractAddress  — ProofRegistry address
 * @returns {Promise<{ signature: string, deviceAddress: string }>}
 */
export async function signProof(payload, chainId, contractAddress) {
    const wallet = await getOrCreateDeviceWallet();

    const domain = {
        name: DOMAIN_NAME,
        version: DOMAIN_VERSION,
        chainId: Number(chainId),
        verifyingContract: contractAddress,
    };

    const signature = await wallet.signTypedData(domain, PROOF_TYPES, payload);

    return { signature, deviceAddress: wallet.address };
}

/**
 * Return the device's Ethereum address (creates keypair if not yet created).
 * Safe to call without triggering a signing operation.
 *
 * @returns {Promise<string>}
 */
export async function getDeviceAddress() {
    const addr = await SecureStore.getItemAsync(DEVICE_ADDR_STORE_KEY);
    if (addr) return addr;
    const wallet = await getOrCreateDeviceWallet();
    return wallet.address;
}
