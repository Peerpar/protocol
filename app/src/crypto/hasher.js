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
 *     - Two different images → significantly different pHash.
 *     - Used for: similarity detection ("is this visually the same image?")
 *     - Limitation: not collision-resistant; not suitable as a sole identifier.
 *
 * TOGETHER: SHA-256 proves exact byte identity. pHash proves visual content
 * identity even across format conversions. Neither alone is sufficient.
 */

import * as Crypto from "expo-crypto";
import * as FileSystem from "expo-file-system";
import ImageHash from "react-native-image-hash";

/**
 * Compute SHA-256 of a file given its URI.
 *
 * WHY we read raw bytes via FileSystem.readAsStringAsync with base64 encoding:
 * expo-crypto's digestStringAsync works on strings. To hash BINARY content
 * faithfully, we read the file as base64, then decode to binary representation.
 * Note: expo-crypto also provides a file-path digest API — we use that here
 * for correctness (no intermediate base64 string allocation).
 *
 * @param {string} fileUri  — local file:// URI of the media file
 * @returns {Promise<string>} — lowercase hex SHA-256 (64 chars)
 */
export async function computeSha256(fileUri) {
    // WHY Crypto.Algorithm.SHA256: this calls the native platform's SHA-256
    // implementation (CryptoKit on iOS, MessageDigest on Android) via JSI bridge.
    // It is faster and more memory-efficient than a pure-JS implementation.
    const digest = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        fileUri,
        {
            encoding: Crypto.CryptoEncoding.HEX,
            // WHY FILE encoding: tells expo-crypto to hash the file at that path
            // as raw bytes, not the URI string itself.
            inputEncoding: Crypto.CryptoEncoding.FILE,
        }
    );
    return digest.toLowerCase();
}

/**
 * Compute a 64-bit perceptual hash (pHash) of an image.
 *
 * The pHash algorithm:
 *   1. Resize image to 32×32 pixels
 *   2. Convert to grayscale
 *   3. Apply 2D DCT
 *   4. Take top-left 8×8 block (low-frequency components)
 *   5. Compute mean of the 64 values
 *   6. For each value: bit = 1 if value > mean, else 0
 *   7. Pack 64 bits into a 16-char hex string
 *
 * WHY DCT-based pHash: it is robust against:
 *   - Minor JPEG compression changes
 *   - Gamma correction differences
 *   - Minor brightness/contrast adjustments
 * It is NOT robust against:
 *   - Cropping, flipping, or rotation
 *   - Heavy manipulation (filters, face blurring)
 *
 * @param {string} fileUri  — local file:// URI
 * @returns {Promise<string>} — 16-char hex pHash (64-bit)
 */
export async function computePHash(fileUri) {
    // react-native-image-hash uses native DCT-based pHash implementation.
    // Hamming distance ≤ 10 on a 64-bit hash typically indicates visual similarity.
    const hash = await ImageHash.hash(fileUri, 16, "phash");
    return hash.toLowerCase();
}

/**
 * Compute a SHA-256 hash of a metadata object for inclusion as a Merkle leaf.
 *
 * WHY we hash metadata separately: this allows a verifier to check that
 * the GPS, timestamp, and device info match without revealing the full
 * metadata blob (privacy-preserving Merkle proof).
 *
 * @param {object} metadata
 * @returns {Promise<string>} — lowercase hex SHA-256
 */
export async function computeMetadataHash(metadata) {
    // Canonical serialisation: sort keys so hash is deterministic regardless
    // of JS object key insertion order.
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
    // WHY parallel: sha256 and metadataHash are independent computations.
    // pHash can also run in parallel on images (but skip for video — pHash
    // of videos is not supported; use first-frame extraction in future work).
    const [sha256Hex, metadataHashHex] = await Promise.all([
        computeSha256(fileUri),
        computeMetadataHash(metadata),
    ]);

    let pHashHex;
    try {
        pHashHex = await computePHash(fileUri);
    } catch {
        // WHY we don't throw: pHash is a best-effort visual fingerprint.
        // If the file is a video or an unsupported format, we record a
        // zero pHash rather than blocking the entire proof.
        // The SHA-256 alone is sufficient for cryptographic proof.
        console.warn("[hasher] pHash unavailable for this file type. Using zero pHash.");
        pHashHex = "0".repeat(16);
    }

    return { sha256Hex, pHashHex, metadataHashHex };
}
