require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
    solidity: {
        version: "0.8.20",
        settings: {
            optimizer: {
                enabled: true,
                // WHY 200 runs: balances deployment cost vs. per-call cost.
                // ProofRegistry.anchor() will be called frequently; optimising for
                // runtime (higher runs) would make sense, but 200 is a safe default
                // that also keeps deployment feasible.
                runs: 200,
            },
        },
    },

    networks: {
        // ── Local development ─────────────────────────────────────────────────
        localhost: {
            url: "http://127.0.0.1:8545",
        },

        // ── Base Sepolia (testnet) ────────────────────────────────────────────
        // WHY Base: Coinbase-backed L2, EVM-equivalent, low gas, good tooling.
        // Calldata costs on Base are dramatically lower than Ethereum mainnet.
        baseSepolia: {
            url: process.env.RPC_URL_BASE_SEPOLIA || "https://sepolia.base.org",
            accounts: process.env.DEPLOYER_PRIVATE_KEY
                ? [process.env.DEPLOYER_PRIVATE_KEY]
                : [],
            chainId: 84532,
        },

        // ── Base Mainnet ──────────────────────────────────────────────────────
        base: {
            url: process.env.RPC_URL_BASE || "https://mainnet.base.org",
            accounts: process.env.DEPLOYER_PRIVATE_KEY
                ? [process.env.DEPLOYER_PRIVATE_KEY]
                : [],
            chainId: 8453,
        },

        // ── Polygon zkEVM Testnet ─────────────────────────────────────────────
        // WHY zkEVM: ZK-rollup provides stronger cryptographic proof of
        // L2 state validity, which complements PeerPar's trust model.
        polygonZkEvmTestnet: {
            url:
                process.env.RPC_URL_POLYGON_ZKEVM_TESTNET ||
                "https://rpc.cardona.zkevm-rpc.com",
            accounts: process.env.DEPLOYER_PRIVATE_KEY
                ? [process.env.DEPLOYER_PRIVATE_KEY]
                : [],
            chainId: 2442,
        },

        // ── Polygon zkEVM Mainnet ─────────────────────────────────────────────
        polygonZkEvm: {
            url:
                process.env.RPC_URL_POLYGON_ZKEVM ||
                "https://zkevm-rpc.com",
            accounts: process.env.DEPLOYER_PRIVATE_KEY
                ? [process.env.DEPLOYER_PRIVATE_KEY]
                : [],
            chainId: 1101,
        },
    },

    etherscan: {
        // API keys for contract verification on block explorers
        apiKey: {
            base: process.env.BASESCAN_API_KEY || "",
            baseSepolia: process.env.BASESCAN_API_KEY || "",
            polygonZkEvm: process.env.POLYGONSCAN_API_KEY || "",
            polygonZkEvmTestnet: process.env.POLYGONSCAN_API_KEY || "",
        },
        customChains: [
            {
                network: "baseSepolia",
                chainId: 84532,
                urls: {
                    apiURL: "https://api-sepolia.basescan.org/api",
                    browserURL: "https://sepolia.basescan.org",
                },
            },
            {
                network: "polygonZkEvmTestnet",
                chainId: 2442,
                urls: {
                    apiURL: "https://api-testnet-zkevm.polygonscan.com/api",
                    browserURL: "https://testnet-zkevm.polygonscan.com",
                },
            },
        ],
    },

    gasReporter: {
        enabled: process.env.REPORT_GAS === "true",
        currency: "USD",
        coinmarketcap: process.env.CMC_API_KEY,
    },
};
