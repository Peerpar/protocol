/**
 * ipfsService.js — IPFS Upload (Optional, Opt-in)
 *
 * ─────────────────────────────────────────────────────────────────────
 * TODO: Premium feature — out of scope for v0.1.0
 * ─────────────────────────────────────────────────────────────────────
 *
 * WHAT THIS WILL DO (v0.2.0+):
 *   - Upload the captured media file to IPFS via web3.storage
 *   - Return the CID (Content Identifier) for inclusion in the proof record
 *   - Allow anyone with the CID to retrieve the original file and
 *     independently verify its SHA-256 against the on-chain anchor
 *
 * WHY OPT-IN ONLY:
 *   - Uploading to IPFS reveals the media content to the network.
 *     Journalists in sensitive situations may not want their footage
 *     publicly accessible. The on-chain anchor alone is sufficient proof.
 *   - IPFS pinning is not guaranteed to be permanent without a pinning
 *     service subscription.
 *
 * TRUST NOTE:
 *   - IPFS content is identified by its CID = SHA-256 of the file.
 *     If the CID matches the anchored SHA-256, the content is authentic.
 *   - If the CID does NOT match, the IPFS upload was of a different file.
 *
 * DEPENDENCY: web3.storage SDK (not installed in v0.1.0)
 */

/**
 * Upload media to IPFS and return CID.
 * NOT IMPLEMENTED in v0.1.0.
 *
 * @param {string} _fileUri
 * @returns {Promise<never>}
 */
// eslint-disable-next-line no-unused-vars
export async function uploadToIPFS(_fileUri) {
    throw new Error(
        "IPFS upload is not implemented in v0.1.0. This is an opt-in premium feature planned for v0.2.0."
    );
}
