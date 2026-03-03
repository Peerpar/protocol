/**
 * merkle.js — On-Device Merkle Tree Builder
 *
 * WHY a Merkle tree instead of a single hash?
 *
 * A Merkle tree over [sha256, pHash, metadataHash] provides two key benefits:
 *
 *   1. SELECTIVE DISCLOSURE: A verifier can prove that a specific leaf
 *      (e.g., just the SHA-256) is part of the anchored root WITHOUT
 *      revealing the other leaves (e.g., GPS coordinates). This is privacy-
 *      preserving Merkle proof — important for journalists who may not want
 *      to disclose their location while still proving file authenticity.
 *
 *   2. EXTENSIBILITY: Future versions can add leaves (audio fingerprint,
 *      frame hash, etc.) without changing the root format for old proofs.
 *
 * TREE STRUCTURE (3 leaves, balanced):
 *
 *          ROOT
 *         /    \
 *       H(0,1)  H(2,2)    ← H(2,2) is leaf[2] hashed with itself (odd leaf)
 *       /    \
 *    leaf[0] leaf[1]
 *
 *   leaf[0] = sha256Hex
 *   leaf[1] = pHashHex
 *   leaf[2] = metadataHashHex
 *
 * WHY we hash pairs: double-SHA256 at each level is standard Bitcoin/Ethereum
 * practice. However, we use single SHA-256 to reduce computation on device
 * (the double-hash defence against length-extension attacks is not relevant
 * here since all leaves are fixed 32-byte values).
 *
 * COMPATIBILITY: This tree implementation is intentionally simple and
 * self-contained. The verification portal reimplements the SAME algorithm in
 * browser JS to independently verify roots without trusting any server.
 */

import * as Crypto from "expo-crypto";

/**
 * Hash two hex strings together as a single SHA-256 leaf pair.
 * If only one leaf is present (odd tree), hash it with itself.
 *
 * WHY concatenation then hash: this is the standard Merkle pair-hash approach.
 * We sort the pair before hashing (lexicographic) to make the tree
 * order-independent — any permutation of leaves produces the SAME root.
 * (This is the approach used by OpenZeppelin's MerkleTree library.)
 *
 * @param {string} left   — 64-char hex
 * @param {string} right  — 64-char hex (pass same as left for odd nodes)
 * @returns {Promise<string>} — 64-char hex
 */
async function hashPair(left, right) {
    // Sort so tree is commutative (order of leaves doesn't change root)
    const [a, b] = [left, right].sort();
    const combined = a + b; // 128 hex chars = 64 bytes
    return Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        combined,
        { encoding: Crypto.CryptoEncoding.HEX }
    ).then((h) => h.toLowerCase());
}

/**
 * Build a Merkle tree from an array of leaf hashes (hex strings).
 *
 * @param {string[]} leaves  — array of 64-char hex strings
 * @returns {Promise<{
 *   root: string,          — 64-char hex Merkle root
 *   layers: string[][],    — all tree layers [leaves, ..., [root]]
 * }>}
 */
async function buildTree(leaves) {
    if (!leaves || leaves.length === 0) {
        throw new Error("Cannot build Merkle tree from empty leaves");
    }

    const layers = [leaves.slice()]; // Start with leaf layer
    let current = leaves.slice();

    while (current.length > 1) {
        const nextLayer = [];
        for (let i = 0; i < current.length; i += 2) {
            const left = current[i];
            const right = i + 1 < current.length ? current[i + 1] : current[i]; // duplicate odd leaf
            // eslint-disable-next-line no-await-in-loop
            nextLayer.push(await hashPair(left, right));
        }
        layers.push(nextLayer);
        current = nextLayer;
    }

    return {
        root: current[0],
        layers,
    };
}

/**
 * Generate a Merkle proof for a specific leaf by index.
 *
 * A proof is the list of sibling hashes needed to reconstruct the root
 * from just the target leaf. Verifiers use this to confirm inclusion
 * without seeing all leaves.
 *
 * @param {string[][]} layers  — from buildTree().layers
 * @param {number} leafIndex   — index of the leaf to prove
 * @returns {Array<{ sibling: string, position: 'left'|'right' }>}
 */
function generateProof(layers, leafIndex) {
    const proof = [];
    let idx = leafIndex;

    for (let i = 0; i < layers.length - 1; i++) {
        const layer = layers[i];
        const isLeft = idx % 2 === 0;
        const siblingIdx = isLeft ? idx + 1 : idx - 1;

        // If sibling doesn't exist (odd layer), use the node itself
        const sibling = siblingIdx < layer.length ? layer[siblingIdx] : layer[idx];
        proof.push({ sibling, position: isLeft ? "right" : "left" });

        // Move up to the parent index
        idx = Math.floor(idx / 2);
    }

    return proof;
}

/**
 * Verify a Merkle proof for a given leaf.
 * Used by the verification portal to confirm inclusion.
 *
 * @param {string} leaf        — 64-char hex
 * @param {Array<{ sibling: string, position: 'left'|'right' }>} proof
 * @param {string} expectedRoot — 64-char hex
 * @returns {Promise<boolean>}
 */
export async function verifyProof(leaf, proof, expectedRoot) {
    let current = leaf;
    for (const { sibling, position } of proof) {
        const [left, right] =
            position === "right" ? [current, sibling] : [sibling, current];
        current = await hashPair(left, right);
    }
    return current.toLowerCase() === expectedRoot.toLowerCase();
}

/**
 * Build the PeerPar proof Merkle tree from the three computed hashes.
 *
 * @param {string} sha256Hex
 * @param {string} pHashHex
 * @param {string} metadataHashHex
 * @returns {Promise<{
 *   root: string,
 *   leaves: string[],
 *   proofs: object[],    — proof for each leaf
 *   layers: string[][],
 * }>}
 */
export async function buildProofTree(sha256Hex, pHashHex, metadataHashHex) {
    const leaves = [sha256Hex, pHashHex, metadataHashHex];
    const { root, layers } = await buildTree(leaves);

    const proofs = leaves.map((_, i) => generateProof(layers, i));

    return { root, leaves, proofs, layers };
}
