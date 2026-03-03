const { ethers } = require("hardhat");

/**
 * Deploy ProofRegistry to the target network.
 *
 * Usage:
 *   npx hardhat run scripts/deploy.js --network baseSepolia
 *   npx hardhat run scripts/deploy.js --network base
 *   npx hardhat run scripts/deploy.js --network polygonZkEvmTestnet
 *
 * After deployment, update relayer/.env:
 *   CONTRACT_ADDRESS=<deployed address>
 */
async function main() {
    const [deployer] = await ethers.getSigners();
    const network = await ethers.provider.getNetwork();

    console.log("=".repeat(60));
    console.log("PeerPar Protocol — ProofRegistry Deployment");
    console.log("=".repeat(60));
    console.log(`Network:   ${network.name} (chainId: ${network.chainId})`);
    console.log(`Deployer:  ${deployer.address}`);
    console.log(
        `Balance:   ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} ETH`
    );

    // WHY: The relayer address MUST be set before deployment.
    // The relayer is the only address that can call anchor().
    // In production, this should be a hardware-wallet-secured EOA or a
    // multi-sig. NEVER use the deployer key as the relayer in production.
    const relayerAddress = process.env.RELAYER_ADDRESS || deployer.address;

    if (relayerAddress === deployer.address) {
        console.warn(
            "\n⚠️  WARNING: relayer address = deployer address. " +
            "Set RELAYER_ADDRESS in your .env for production deployments.\n"
        );
    }

    console.log(`Relayer:   ${relayerAddress}`);
    console.log("-".repeat(60));

    // Deploy
    const ProofRegistry = await ethers.getContractFactory("ProofRegistry");
    const registry = await ProofRegistry.deploy(relayerAddress);
    await registry.waitForDeployment();

    const address = await registry.getAddress();
    const deployTx = registry.deploymentTransaction();

    console.log(`\n✅ ProofRegistry deployed successfully!`);
    console.log(`   Address:  ${address}`);
    console.log(`   Tx Hash:  ${deployTx?.hash}`);
    console.log(`   Gas Used: (check block explorer)`);
    console.log("\n─── Next Steps ─────────────────────────────────────────────");
    console.log(`1. Add to relayer/.env:`);
    console.log(`     CONTRACT_ADDRESS=${address}`);
    console.log(
        `2. Verify on block explorer (after a few confirmations):`
    );
    console.log(
        `     npx hardhat verify --network ${network.name} ${address} ${relayerAddress}`
    );
    console.log("=".repeat(60));
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error("Deployment failed:", err);
        process.exit(1);
    });
