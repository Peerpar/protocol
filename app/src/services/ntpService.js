/**
 * ntpService.js — NTP Timestamp Service for React Native
 *
 * WHY we query NTP from the device:
 *   The device OS clock can be manipulated by the user. NTP gives us a
 *   second reference: we compare device time to actual network time and
 *   FLAG the proof if the drift exceeds 30 seconds. We do not silently
 *   reject — we record the flag in the SQLite proof and relay it to the
 *   relayer for independent verification.
 *
 * LIMITATION: NTP over UDP is not available from React Native directly.
 *   We use an HTTPS time API (Cloudflare's /cdn-cgi/trace) as a proxy.
 *   This requires network connectivity. If offline, we fall back to the
 *   device clock and mark the timestamp as "unverified".
 */

const MAX_OFFSET_MS = 30_000; // 30 seconds — mirrors relayer threshold

// Lightweight HTTPS time source — returns a plain text response containing
// "ts=<unix_timestamp>" among other fields. Reading the "ts" field gives
// us Cloudflare's edge server time, which is NTP-disciplined.
const NTP_API_URL = "https://www.cloudflare.com/cdn-cgi/trace";

/**
 * Query Cloudflare's edge for current Unix timestamp.
 *
 * @returns {Promise<number>} — Unix timestamp in milliseconds
 */
async function fetchCloudflareTime() {
    const localBefore = Date.now();
    const res = await fetch(NTP_API_URL, { method: "GET", cache: "no-store" });
    const localAfter = Date.now();

    if (!res.ok) throw new Error(`Time API returned ${res.status}`);

    const text = await res.text();
    const match = text.match(/ts=(\d+\.\d+)/);
    if (!match) throw new Error("Could not parse timestamp from Cloudflare trace");

    const remoteMs = parseFloat(match[1]) * 1000;
    // Correct for round-trip: add half the round-trip time
    const corrected = remoteMs + (localAfter - localBefore) / 2;
    return Math.round(corrected);
}

/**
 * Get a verified NTP timestamp and device clock offset.
 *
 * @returns {Promise<{
 *   timestamp: number,    — Unix seconds (NTP-corrected if available)
 *   offsetMs: number,     — NTP offset vs device clock
 *   reliable: boolean,    — false if drift > 30s or NTP unavailable
 *   source: string,       — 'ntp' | 'device'
 * }>}
 */
export async function getNtpTimestamp() {
    const deviceMs = Date.now();

    try {
        const ntpMs = await fetchCloudflareTime();
        const offsetMs = ntpMs - deviceMs;
        const reliable = Math.abs(offsetMs) <= MAX_OFFSET_MS;

        return {
            timestamp: Math.floor(ntpMs / 1000),
            offsetMs: Math.round(offsetMs),
            reliable,
            source: "ntp",
        };
    } catch (err) {
        console.warn("[ntpService] NTP unavailable, using device clock:", err.message);
        return {
            timestamp: Math.floor(deviceMs / 1000),
            offsetMs: 0,
            reliable: false,
            source: "device",
        };
    }
}
