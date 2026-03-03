/**
 * database.js — SQLite Proof Storage via expo-sqlite
 *
 * WHY local SQLite instead of only relying on the blockchain?
 *
 *   1. The blockchain stores the Merkle root and emits an event.
 *      It does NOT store the full proof metadata (GPS, device model, etc.)
 *      because that would be expensive and a privacy concern.
 *
 *   2. The app needs to display proof history, including data that was
 *      never put on-chain (full sha256, pHash, GPS, etc.).
 *
 *   3. The local record is the user's personal evidence archive.
 *      Loss of the SQLite DB means losing the ability to do a full
 *      re-verification — the on-chain anchor still exists, but your
 *      leaf data is gone. This is documented in the app README.
 *
 * SCHEMA VERSIONING: We use a simple integer version in a meta table.
 * Migrations run in order when the DB version is lower than the expected version.
 */

import * as SQLite from "expo-sqlite";

const DB_NAME = "peerpar.db";
const SCHEMA_VERSION = 1;

let _db = null;

/**
 * Open (or create) the SQLite database and run pending migrations.
 * Call this once at app startup.
 *
 * @returns {Promise<SQLite.SQLiteDatabase>}
 */
export async function openDatabase() {
    if (_db) return _db;

    _db = await SQLite.openDatabaseAsync(DB_NAME);

    // Enable WAL mode for better concurrent read performance.
    // WHY: The proof history screen reads from SQLite while the camera
    // may be writing — WAL prevents reader/writer contention.
    await _db.execAsync("PRAGMA journal_mode = WAL;");

    await migrate(_db);
    return _db;
}

async function migrate(db) {
    // Create version tracking table if it doesn't exist
    await db.execAsync(`
    CREATE TABLE IF NOT EXISTS _schema_version (
      version INTEGER NOT NULL
    );
  `);

    const row = await db.getFirstAsync("SELECT version FROM _schema_version LIMIT 1");
    const currentVersion = row?.version ?? 0;

    if (currentVersion < 1) {
        await db.execAsync(`
      CREATE TABLE IF NOT EXISTS proofs (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,

        -- Media identifiers
        media_uri       TEXT NOT NULL,    -- local device URI (may become stale)
        sha256_hex      TEXT NOT NULL,    -- 64-char hex — the authoritative identifier
        p_hash_hex      TEXT NOT NULL,    -- 16-char hex — visual fingerprint
        metadata_hash   TEXT NOT NULL,    -- SHA-256 of metadata JSON

        -- Merkle tree
        merkle_root     TEXT NOT NULL,    -- 0x-prefixed 32-byte hex anchored on-chain
        merkle_leaves   TEXT NOT NULL,    -- JSON array of all 3 leaves
        merkle_proofs   TEXT NOT NULL,    -- JSON array of proof paths (selective disclosure)

        -- On-chain anchor
        tx_hash         TEXT,             -- NULL until confirmed
        block_number    INTEGER,          -- NULL until confirmed
        network_id      INTEGER,          -- NULL until confirmed

        -- Timestamps
        ntp_timestamp   INTEGER NOT NULL, -- Unix seconds, NTP-synced
        ntp_offset_ms   INTEGER NOT NULL, -- device clock drift at time of capture

        -- Location (may be NULL if user denied GPS permission)
        gps_lat         REAL,
        gps_lon         REAL,
        gps_acc         REAL,

        -- Device context
        device_address  TEXT NOT NULL,    -- device Ethereum address (signer)
        device_model    TEXT NOT NULL,
        os_version      TEXT NOT NULL,
        app_version     TEXT NOT NULL,

        -- Relayer response
        relayer_ntp_ms  INTEGER,          -- relayer's NTP timestamp (ms)
        relayer_drift   INTEGER,          -- relayer's measured drift (ms)
        ntp_reliable    INTEGER NOT NULL DEFAULT 1, -- BOOLEAN: 0=flagged, 1=ok

        -- Status flags
        status          TEXT NOT NULL DEFAULT 'pending',  -- pending | confirmed | failed
        created_at      INTEGER NOT NULL                  -- Unix seconds
      );

      CREATE INDEX IF NOT EXISTS idx_proofs_sha256       ON proofs (sha256_hex);
      CREATE INDEX IF NOT EXISTS idx_proofs_merkle_root  ON proofs (merkle_root);
      CREATE INDEX IF NOT EXISTS idx_proofs_created_at   ON proofs (created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_proofs_status       ON proofs (status);

      INSERT INTO _schema_version (version) VALUES (1);
    `);
    }

    // Future migrations: if (currentVersion < 2) { ... }
}

/**
 * Insert a new proof record (initially in 'pending' state, no tx_hash yet).
 *
 * @param {object} proof
 * @returns {Promise<number>} — the new row ID
 */
export async function insertProof(proof) {
    const db = await openDatabase();
    const result = await db.runAsync(
        `INSERT INTO proofs (
      media_uri, sha256_hex, p_hash_hex, metadata_hash,
      merkle_root, merkle_leaves, merkle_proofs,
      ntp_timestamp, ntp_offset_ms,
      gps_lat, gps_lon, gps_acc,
      device_address, device_model, os_version, app_version,
      ntp_reliable, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
        [
            proof.mediaUri,
            proof.sha256Hex,
            proof.pHashHex,
            proof.metadataHash,
            proof.merkleRoot,
            JSON.stringify(proof.merkleLeaves),
            JSON.stringify(proof.merkleProofs),
            proof.ntpTimestamp,
            proof.ntpOffsetMs,
            proof.gpsLat ?? null,
            proof.gpsLon ?? null,
            proof.gpsAcc ?? null,
            proof.deviceAddress,
            proof.deviceModel,
            proof.osVersion,
            proof.appVersion,
            proof.ntpReliable ? 1 : 0,
            Math.floor(Date.now() / 1000),
        ]
    );
    return result.lastInsertRowId;
}

/**
 * Update a proof record with on-chain confirmation data.
 *
 * @param {number} id
 * @param {{ txHash, blockNumber, networkId, relayerNtpMs, relayerDrift, ntpReliable }} data
 */
export async function confirmProof(id, data) {
    const db = await openDatabase();
    await db.runAsync(
        `UPDATE proofs
     SET tx_hash = ?, block_number = ?, network_id = ?,
         relayer_ntp_ms = ?, relayer_drift = ?, ntp_reliable = ?,
         status = 'confirmed'
     WHERE id = ?`,
        [
            data.txHash,
            data.blockNumber,
            data.networkId,
            data.relayerNtpMs ?? null,
            data.relayerDrift ?? null,
            data.ntpReliable ? 1 : 0,
            id,
        ]
    );
}

/**
 * Mark a proof as failed (relayer submission error).
 *
 * @param {number} id
 * @param {string} reason
 */
export async function failProof(id, reason) {
    const db = await openDatabase();
    await db.runAsync(
        `UPDATE proofs SET status = 'failed' WHERE id = ?`,
        [id]
    );
}

/**
 * Fetch the most recent proofs for the history screen.
 *
 * @param {number} [limit=50]
 * @param {number} [offset=0]
 * @returns {Promise<object[]>}
 */
export async function getProofs(limit = 50, offset = 0) {
    const db = await openDatabase();
    return db.getAllAsync(
        `SELECT * FROM proofs ORDER BY created_at DESC LIMIT ? OFFSET ?`,
        [limit, offset]
    );
}

/**
 * Fetch a single proof by ID.
 *
 * @param {number} id
 * @returns {Promise<object|null>}
 */
export async function getProofById(id) {
    const db = await openDatabase();
    return db.getFirstAsync(`SELECT * FROM proofs WHERE id = ?`, [id]);
}
