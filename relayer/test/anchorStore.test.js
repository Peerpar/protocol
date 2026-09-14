/**
 * anchorStore.test.js — Tests for the local replay-dedup store.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createAnchorStore } = require("../src/anchorStore");

function tempStorePath() {
    return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "anchor-store-test-")), "roots.log");
}

describe("createAnchorStore", () => {
    test("a fresh store has not seen any root", () => {
        const store = createAnchorStore(tempStorePath());
        expect(store.has("0xabc123")).toBe(false);
    });

    test("record() makes has() return true", () => {
        const store = createAnchorStore(tempStorePath());
        const root = "0x" + "aa".repeat(32);

        expect(store.has(root)).toBe(false);
        store.record(root);
        expect(store.has(root)).toBe(true);
    });

    test("has() is case-insensitive", () => {
        const store = createAnchorStore(tempStorePath());
        const root = "0x" + "AB".repeat(32);

        store.record(root);
        expect(store.has(root.toLowerCase())).toBe(true);
        expect(store.has(root.toUpperCase())).toBe(true);
    });

    test("persists across a simulated process restart (new store, same file)", () => {
        const storePath = tempStorePath();
        const root = "0x" + "cd".repeat(32);

        const first = createAnchorStore(storePath);
        first.record(root);

        const second = createAnchorStore(storePath);
        expect(second.has(root)).toBe(true);
    });

    test("recording the same root twice does not duplicate entries on disk", () => {
        const storePath = tempStorePath();
        const root = "0x" + "ef".repeat(32);

        const store = createAnchorStore(storePath);
        store.record(root);
        store.record(root);

        const lines = fs.readFileSync(storePath, "utf8").trim().split("\n");
        expect(lines).toHaveLength(1);
    });

    test("two different roots are tracked independently", () => {
        const store = createAnchorStore(tempStorePath());
        const rootA = "0x" + "11".repeat(32);
        const rootB = "0x" + "22".repeat(32);

        store.record(rootA);
        expect(store.has(rootA)).toBe(true);
        expect(store.has(rootB)).toBe(false);
    });

    test("creates the store directory if it does not exist yet", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "anchor-store-test-"));
        const nestedPath = path.join(dir, "nested", "deeper", "roots.log");
        const store = createAnchorStore(nestedPath);
        const root = "0x" + "33".repeat(32);

        store.record(root);

        expect(fs.existsSync(nestedPath)).toBe(true);
        expect(store.has(root)).toBe(true);
    });
});
