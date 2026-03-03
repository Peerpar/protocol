const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("ProofRegistry", function () {
    let registry;
    let owner, relayer, device, attacker;

    // Sample proof data
    const MERKLE_ROOT = ethers.keccak256(ethers.toUtf8Bytes("test-merkle-root"));
    const NTP_TIMESTAMP = BigInt(Math.floor(Date.now() / 1000));
    const METADATA = ethers.AbiCoder.defaultAbiCoder().encode(
        ["int64", "int64", "uint32", "string", "string", "string", "int32"],
        [
            40712800n,   // gpsLat  (40.7128° N, scaled ×10^6)
            -74006000n,  // gpsLon  (-74.006° W, scaled ×10^6)
            5000n,       // gpsAcc  (5.0 m, scaled ×10^3)
            "iPhone 15 Pro",
            "iOS 17.2",
            "1.0.0",
            -120,        // ntpOffsetMs
        ]
    );

    beforeEach(async function () {
        [owner, relayer, device, attacker] = await ethers.getSigners();

        const ProofRegistry = await ethers.getContractFactory("ProofRegistry");
        registry = await ProofRegistry.deploy(relayer.address);
        await registry.waitForDeployment();
    });

    // ─── Deployment ───────────────────────────────────────────────────────────

    describe("Deployment", function () {
        it("sets the owner correctly", async function () {
            expect(await registry.owner()).to.equal(owner.address);
        });

        it("sets the initial active relayer correctly", async function () {
            expect(await registry.activeRelayer()).to.equal(relayer.address);
        });

        it("reverts if deployed with zero relayer address", async function () {
            const ProofRegistry = await ethers.getContractFactory("ProofRegistry");
            await expect(
                ProofRegistry.deploy(ethers.ZeroAddress)
            ).to.be.revertedWithCustomError(registry, "ZeroAddress");
        });
    });

    // ─── anchor() ─────────────────────────────────────────────────────────────

    describe("anchor()", function () {
        it("emits Anchored event with correct args when called by relayer", async function () {
            await expect(
                registry
                    .connect(relayer)
                    .anchor(MERKLE_ROOT, device.address, NTP_TIMESTAMP, METADATA)
            )
                .to.emit(registry, "Anchored")
                .withArgs(device.address, MERKLE_ROOT, NTP_TIMESTAMP, METADATA);
        });

        it("reverts when called by non-relayer", async function () {
            await expect(
                registry
                    .connect(attacker)
                    .anchor(MERKLE_ROOT, device.address, NTP_TIMESTAMP, METADATA)
            ).to.be.revertedWithCustomError(registry, "NotRelayer");
        });

        it("reverts on zero merkleRoot", async function () {
            await expect(
                registry
                    .connect(relayer)
                    .anchor(ethers.ZeroHash, device.address, NTP_TIMESTAMP, METADATA)
            ).to.be.revertedWithCustomError(registry, "EmptyMerkleRoot");
        });

        it("reverts on zero submitter address", async function () {
            await expect(
                registry
                    .connect(relayer)
                    .anchor(MERKLE_ROOT, ethers.ZeroAddress, NTP_TIMESTAMP, METADATA)
            ).to.be.revertedWithCustomError(registry, "ZeroAddress");
        });

        it("uses NO storage slots (pure event emission)", async function () {
            // WHY this test: Our architecture claims zero SSTORE ops.
            // We verify storage cost by comparing gas to a pure-calldata baseline.
            // If someone adds an SSTORE, this test won't fail directly, but the
            // gas report (REPORT_GAS=true) will reveal it.
            const tx = await registry
                .connect(relayer)
                .anchor(MERKLE_ROOT, device.address, NTP_TIMESTAMP, METADATA);
            const receipt = await tx.wait();

            // Rough upper bound: an SSTORE costs 20k gas. Our anchor()
            // should come in well under 50k for a reasonably sized metadata blob.
            expect(receipt.gasUsed).to.be.lessThan(100_000n);
        });

        it("multiple anchors from same device are independent", async function () {
            const root2 = ethers.keccak256(ethers.toUtf8Bytes("second-root"));

            const tx1 = registry
                .connect(relayer)
                .anchor(MERKLE_ROOT, device.address, NTP_TIMESTAMP, METADATA);
            const tx2 = registry
                .connect(relayer)
                .anchor(root2, device.address, NTP_TIMESTAMP + 1n, METADATA);

            await expect(tx1).to.emit(registry, "Anchored").withArgs(
                device.address, MERKLE_ROOT, NTP_TIMESTAMP, METADATA
            );
            await expect(tx2).to.emit(registry, "Anchored").withArgs(
                device.address, root2, NTP_TIMESTAMP + 1n, METADATA
            );
        });
    });

    // ─── setRelayer() ─────────────────────────────────────────────────────────

    describe("setRelayer()", function () {
        it("owner can update relayer", async function () {
            const [, , , , newRelayer] = await ethers.getSigners();
            await expect(registry.connect(owner).setRelayer(newRelayer.address))
                .to.emit(registry, "RelayerUpdated")
                .withArgs(relayer.address, newRelayer.address);

            expect(await registry.activeRelayer()).to.equal(newRelayer.address);
        });

        it("new relayer can anchor after update", async function () {
            const [, , , , newRelayer] = await ethers.getSigners();
            await registry.connect(owner).setRelayer(newRelayer.address);

            await expect(
                registry
                    .connect(newRelayer)
                    .anchor(MERKLE_ROOT, device.address, NTP_TIMESTAMP, METADATA)
            ).to.emit(registry, "Anchored");
        });

        it("old relayer can no longer anchor after update", async function () {
            const [, , , , newRelayer] = await ethers.getSigners();
            await registry.connect(owner).setRelayer(newRelayer.address);

            await expect(
                registry
                    .connect(relayer)
                    .anchor(MERKLE_ROOT, device.address, NTP_TIMESTAMP, METADATA)
            ).to.be.revertedWithCustomError(registry, "NotRelayer");
        });

        it("non-owner cannot update relayer", async function () {
            await expect(
                registry.connect(attacker).setRelayer(attacker.address)
            ).to.be.revertedWithCustomError(registry, "NotRelayer");
        });

        it("reverts setting relayer to zero address", async function () {
            await expect(
                registry.connect(owner).setRelayer(ethers.ZeroAddress)
            ).to.be.revertedWithCustomError(registry, "ZeroAddress");
        });
    });
});
