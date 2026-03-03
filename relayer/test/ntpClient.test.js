/**
 * ntpClient.test.js — Tests for NTP timestamp cross-validation
 *
 * We mock the UDP socket to avoid real network calls in CI.
 */

const { validateTimestamp, MAX_OFFSET_MS } = require("../src/ntpClient");

// Mock dgram to avoid real network calls
jest.mock("dgram", () => {
    const EventEmitter = require("events");

    let onMessage = null;

    const fakeSocket = {
        send: jest.fn((buf, offset, len, port, host, cb) => {
            // Simulate a valid NTP response after 10ms
            setTimeout(() => {
                if (onMessage) {
                    // Build a minimal NTP UDP response packet
                    const packet = Buffer.alloc(48, 0);
                    // Write current time as NTP transmit timestamp (bytes 40-43)
                    const NTP_EPOCH = 2_208_988_800;
                    const nowSec = Math.floor(Date.now() / 1000) + NTP_EPOCH;
                    packet.writeUInt32BE(nowSec, 40);
                    packet.writeUInt32BE(0, 44);
                    onMessage(packet);
                }
                cb && cb(null);
            }, 10);
        }),
        on: jest.fn((event, handler) => {
            if (event === "message") onMessage = handler;
        }),
        close: jest.fn(),
    };

    return {
        createSocket: jest.fn(() => fakeSocket),
    };
});

describe("NTP Client", () => {
    test("validateTimestamp returns reliable=true for a fresh timestamp", async () => {
        const nowMs = Date.now();
        const result = await validateTimestamp(nowMs);

        expect(result.reliable).toBe(true);
        expect(result.driftMs).toBeLessThan(MAX_OFFSET_MS);
        expect(result.warning).toBeNull();
    });

    test("validateTimestamp returns reliable=false for a drifted timestamp", async () => {
        const driftedMs = Date.now() - 60_000; // 60 seconds in the past
        const result = await validateTimestamp(driftedMs);

        expect(result.reliable).toBe(false);
        expect(result.driftMs).toBeGreaterThan(MAX_OFFSET_MS);
        expect(result.warning).toBeTruthy();
    });

    test("ntpTimestampMs is numeric and reasonable", async () => {
        const result = await validateTimestamp(Date.now());

        expect(typeof result.ntpTimestampMs).toBe("number");
        // Should be within ±5 seconds of now
        expect(Math.abs(result.ntpTimestampMs - Date.now())).toBeLessThan(5_000);
    });
});
