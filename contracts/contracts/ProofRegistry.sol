// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ProofRegistry
 * @author PeerPar Protocol
 * @notice Anchors cryptographic proofs-of-existence for media files on-chain.
 *
 * DESIGN PHILOSOPHY
 * -----------------
 * We store NOTHING in contract state (no mappings, no arrays).
 * All proof data lives in the CALLDATA of the transaction, which is:
 * (a) permanently recorded in the Ethereum/L2 block history
 * (b) cheaper than SSTORE by ~20x
 * (c) readable by anyone who can access the block
 *
 * This contract's sole job is to emit a searchable event so that off-chain
 * verifiers (web portal, block explorers) can efficiently find proofs by
 * merkleRoot without scanning raw calldata.
 *
 * TRUST ASSUMPTIONS
 * -----------------
 * - The relayer address is a single EOA (centralisation risk, documented in TRUST_MODEL.md)
 * - We do not verify the *content* of the proof — only that it was submitted by the authorised relayer
 * - Block timestamps are within ±15 minutes of real time (Ethereum consensus guarantee)
 */
contract ProofRegistry {
    // ─── State ────────────────────────────────────────────────────────────────

    /// @notice The current address authorised to submit proofs.
    /// WHY: We restrict submissions to a known relayer to prevent griefing.
    address public relayer;

    /// @notice Contract owner — can update the relayer address or transfer ownership.
    address public owner;

    // ─── Events ───────────────────────────────────────────────────────────────

    /**
     * @dev Emitted for every proof anchored.
     *
     * WHY indexed: `merkleRoot` and `submitter` are indexed so that off-chain
     * verifiers can filter event logs efficiently (eth_getLogs with topics).
     * `ntpTimestamp` is NOT indexed — it's query context, not a lookup key.
     *
     * @param submitter    The device address that signed the EIP-712 payload.
     * @param merkleRoot   SHA-256 Merkle root of [sha256, pHash, metadataHash].
     * @param ntpTimestamp NTP-synchronised Unix timestamp in seconds (from device).
     * @param metadata     ABI-encoded: gpsLat, gpsLon, gpsAcc, deviceModel,
     * osVersion, appVersion, ntpOffsetMs — stored in calldata.
     */
    event Anchored(
        address indexed submitter,
        bytes32 indexed merkleRoot,
        uint64 ntpTimestamp,
        bytes metadata
    );

    /**
     * @dev Emitted when the owner updates the authorised relayer.
     */
    event RelayerUpdated(address indexed oldRelayer, address indexed newRelayer);

    /**
     * @dev Emitted when ownership of the contract is transferred.
     */
    event OwnershipTransferred(address indexed oldOwner, address indexed newOwner);

    // ─── Errors ───────────────────────────────────────────────────────────────

    /// @dev Reverts when anyone other than the relayer tries to anchor.
    error NotRelayer(address caller);

    /// @dev Reverts when anyone other than the owner calls administrative functions.
    error NotOwner(address caller);

    /// @dev Reverts when a zero address is passed where a real address is needed.
    error ZeroAddress();

    /// @dev Reverts when merkleRoot is the zero bytes32 (likely a client bug).
    error EmptyMerkleRoot();

    // ─── Constructor ──────────────────────────────────────────────────────────

    /**
     * @param _relayer  The initial authorised relayer EOA.
     */
    constructor(address _relayer) {
        if (_relayer == address(0)) revert ZeroAddress();
        
        relayer = _relayer;
        owner = msg.sender;
        
        emit OwnershipTransferred(address(0), msg.sender);
        emit RelayerUpdated(address(0), _relayer);
    }

    // ─── External Functions ───────────────────────────────────────────────────

    /**
     * @notice Anchor a Merkle root proof on-chain.
     *
     * @param merkleRoot   The Merkle root computed on-device.
     * @param submitter    The device signer address (recovered from EIP-712 sig by relayer).
     * @param ntpTimestamp NTP timestamp in seconds, as reported by device + cross-validated by relayer.
     * @param metadata     ABI-encoded proof metadata.
     */
    function anchor(
        bytes32 merkleRoot,
        address submitter,
        uint64 ntpTimestamp,
        bytes calldata metadata
    ) external {
        // WHY: Only the authorised relayer may submit proofs.
        if (msg.sender != relayer) revert NotRelayer(msg.sender);

        // WHY: A zero merkleRoot almost certainly indicates a client-side bug.
        if (merkleRoot == bytes32(0)) revert EmptyMerkleRoot();

        // WHY: A zero submitter address means the EIP-712 recovery failed.
        if (submitter == address(0)) revert ZeroAddress();

        // Emit the event. All proof data lives in the transaction's log bloom + block body.
        emit Anchored(submitter, merkleRoot, ntpTimestamp, metadata);
    }

    /**
     * @notice Owner can rotate the authorised relayer address.
     *
     * WHY: Operational key rotation should not require a full redeployment.
     */
    function setRelayer(address newRelayer) external {
        if (msg.sender != owner) revert NotOwner(msg.sender);
        if (newRelayer == address(0)) revert ZeroAddress();
        
        emit RelayerUpdated(relayer, newRelayer);
        relayer = newRelayer;
    }

    /**
     * @notice Transfers ownership of the contract to a new account.
     * * WHY: Allows the protocol deployer to eventually hand over control to a multi-sig or DAO.
     */
    function transferOwnership(address newOwner) external {
        if (msg.sender != owner) revert NotOwner(msg.sender);
        if (newOwner == address(0)) revert ZeroAddress();
        
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }
}