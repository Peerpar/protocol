/**
 * ntpClient.js — NTP Timestamp Cross-Validation
 *
 * WHY server-side NTP: the device self-reports a timestamp. A compromised
 * device could lie about the time. We cross-validate against our own NTP
 * query to give verifiers a second, independent time reference.
 *
 * We do NOT override the device timestamp — we attach our own so that
 * a verifier can see both and reason about them independently.
 *
 * Note: This uses UDP NTP (ntplib). In a serverless environment you would
 * replace this with an HTTPS time API (e.g., Cloudflare's /cdn-cgi/trace).
 */

const dgram = require("dgram");

// Maximum acceptable drift between device time and our NTP time.
// 30 seconds mirrors the client-side threshold.
const MAX_OFFSET_MS = 30_000;

/**
 * Query an NTP server and return the current Unix timestamp in seconds.
 *
 * WHY manual NTP implementation: avoids an additional npm dependency
 * (ntplib) while keeping the logic transparent and auditable.
 * The NTP packet structure is defined in RFC 5905.
 *
 * @param {string} [server='pool.ntp.org']
 * @param {number} [timeoutMs=3000]
 * @returns {Promise<{ timestampMs: number, offsetMs: number }>}
 *          timestampMs — NTP time in milliseconds
 *          offsetMs    — difference: NTP time - local Date.now()
 */
function queryNtp(server = "pool.ntp.org", timeoutMs = 3_000) {
    return new Promise((resolve, reject) => {
        const client = dgram.createSocket("udp4");
        let settled = false;

        const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            client.close();
            reject(new Error(`NTP query timed out after ${timeoutMs}ms`));
        }, timeoutMs);

        // WHY 48 bytes: minimum NTP request size per RFC 5905.
        // Byte 0: LI=0 (no leap second warning), VN=3 (NTP version 3), Mode=3 (client).
        const ntpPacket = Buffer.alloc(48, 0);
        ntpPacket[0] = 0x1b; // 0b_00_011_011

        const t1 = Date.now(); // Record T1 (time of send)

        client.send(ntpPacket, 0, 48, 123, server, (err) => {
            if (err) {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                client.close();
                reject(err);
            }
        });

        client.on("message", (msg) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            client.close();

            const t4 = Date.now(); // Record T4 (time of receive)

            // WHY bytes 40-43: this is the "Transmit Timestamp" field in the NTP response.
            // It contains seconds since 1 Jan 1900. We subtract the 70-year epoch delta
            // (2208988800 seconds) to get Unix time.
            const NTP_EPOCH_DELTA = 2_208_988_800;
            const secondsSince1900 =
                msg.readUInt32BE(40) + msg.readUInt32BE(44) / 2 ** 32;
            const ntpTimestampMs = (secondsSince1900 - NTP_EPOCH_DELTA) * 1000;

            // Round-trip correction: approximate true time as midpoint of send/receive
            const roundTripMs = t4 - t1;
            const correctedNtpMs = ntpTimestampMs + roundTripMs / 2;

            const offsetMs = correctedNtpMs - t4;

            resolve({ timestampMs: Math.round(correctedNtpMs), offsetMs: Math.round(offsetMs) });
        });

        client.on("error", (err) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            reject(err);
        });
    });
}

/**
 * Cross-validate a device-reported timestamp against NTP.
 *
 * @param {number} deviceTimestampMs  — milliseconds, from device
 * @returns {Promise<{
 *   ntpTimestampMs: number,
 *   deviceTimestampMs: number,
 *   driftMs: number,
 *   reliable: boolean,
 *   warning: string|null
 * }>}
 */
async function validateTimestamp(deviceTimestampMs) {
    let ntpResult;
    try {
        ntpResult = await queryNtp();
    } catch (err) {
        // If NTP is unreachable, we fall back gracefully but flag it.
        return {
            ntpTimestampMs: null,
            deviceTimestampMs,
            driftMs: null,
            reliable: false,
            warning: `NTP query failed: ${err.message}. Timestamp not independently verified.`,
        };
    }

    const driftMs = Math.abs(deviceTimestampMs - ntpResult.timestampMs);
    const reliable = driftMs <= MAX_OFFSET_MS;

    return {
        ntpTimestampMs: ntpResult.timestampMs,
        deviceTimestampMs,
        driftMs,
        reliable,
        warning: reliable
            ? null
            : `Device clock drift is ${driftMs}ms (threshold: ${MAX_OFFSET_MS}ms). ` +
            "The device clock may have been manipulated or out of sync.",
    };
}

module.exports = { queryNtp, validateTimestamp, MAX_OFFSET_MS };
