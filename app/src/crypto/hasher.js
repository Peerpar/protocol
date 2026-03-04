/**
 * hasher.js — SHA-256 + Perceptual Hash (pHash) of raw media bytes
 *
 * CORE PRINCIPLE: Hashing happens HERE, in memory, BEFORE the file is saved
 * to the device gallery or any permanent storage. This is the foundation of
 * the chain of custody guarantee.
 *
 * WHY TWO HASHES?
 *
 *   SHA-256 (cryptographic):
 *     - Bit-perfect fingerprint. A single changed pixel → completely different hash.
 *     - Used for: exact-match verification ("is this the SAME file?")
 *     - Limitation: compression artifacts or re-encoding change the hash.
 *
 *   pHash (perceptual):
 *     - Based on DCT (Discrete Cosine Transform) of a downscaled grayscale image.
 *     - Two visually identical images → nearly identical pHash (Hamming distance ≈ 0).
 *     - NOT YET IMPLEMENTED — see TODO below.
 *     - Deferred to v0.2.0 pending selection of a robust native library.
 *
 * TOGETHER: SHA-256 proves exact byte identity. pHash will prove visual content
 * identity even across format conversions. For v0.1.0, SHA-256 alone is used.
 *
 * TRUST MODEL NOTE: The absence of pHash in v0.1.0 means the system cannot
 * detect re-compressed or re-encoded versions of the same video. This is
 * documented in TRUST_MODEL.md and will be addressed in v0.2.0.
 */

import * as Crypto from "expo-crypto";

/**
 * Compute SHA-256 of a file given its URI.
 *
 * @param {string} fileUri  — local file:// URI of the media file
 * @returns {Promise<string>} — lowercase hex SHA-256 (64 chars)
 */
export async function computeSha256(fileUri) {
    const digest = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        fileUri,
        {
            encoding: Crypto.CryptoEncoding.HEX,
            inputEncoding: Crypto.CryptoEncoding.FILE,
        }
    );
    return digest.toLowerCase();
}

/**
 * Compute a 64-bit perceptual hash (pHash) of an image.
 *
 * TODO v0.2.0: Implement using a robust native library.
 * Candidates: react-native-phash@0.2.1 (requires Dev Build, not Expo Go).
 * For v0.1.0 we return a zero pHash and rely on SHA-256 for identity proof.
 *
 * @param {string} fileUri  — local file:// URI
 * @returns {Promise<string>} — 16-char hex pHash (64-bit), zero in v0.1.0
 */
export async function computePHash(fileUri) {
    // TODO v0.2.0 — replace with native DCT-based pHash implementation
    console.warn("[hasher] pHash not implemented in v0.1.0. Using zero pHash.");
    return "0".repeat(16);
}

/**
 * Compute a SHA-256 hash of a metadata object for inclusion as a Merkle leaf.
 *
 * @param {object} metadata
 * @returns {Promise<string>} — lowercase hex SHA-256
 */
export async function computeMetadataHash(metadata) {
    const canonical = JSON.stringify(metadata, Object.keys(metadata).sort());
    return Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        canonical,
        { encoding: Crypto.CryptoEncoding.HEX }
    ).then((h) => h.toLowerCase());
}

/**
 * Compute all three hashes for a captured media file.
 *
 * @param {string} fileUri
 * @param {object} metadata — { ntpTimestamp, gpsLat, gpsLon, ... }
 * @returns {Promise<{ sha256Hex, pHashHex, metadataHashHex }>}
 */
export async function hashMedia(fileUri, metadata) {
    const [sha256Hex, pHashHex, metadataHashHex] = await Promise.all([
        computeSha256(fileUri),
        computePHash(fileUri),
        computeMetadataHash(metadata),
    ]);

    return { sha256Hex, pHashHex, metadataHashHex };
}