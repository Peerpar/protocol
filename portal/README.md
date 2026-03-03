# Portal — Public Verification Tool

The PeerPar verification portal lets **anyone** verify a media proof without installing the app.

## How It Works

1. **Upload your file** — drag it into the browser window
2. **Enter the Merkle root** from the PeerPar app (or use the QR code link)
3. The portal:
   - Computes SHA-256 using the **Web Crypto API** (native to all modern browsers)
   - Computes pHash in-browser using a DCT canvas algorithm
   - Computes the Merkle root using the **same algorithm** as the mobile app
   - Queries the ProofRegistry contract event logs via `eth_getLogs`
   - Displays match/no-match with an honest plain-language explanation

## Privacy Guarantee

> **The file is never sent to any server.** All hashing happens inside the browser using the Web Crypto API. Only the Merkle root (a hash, not content) is sent to the blockchain RPC endpoint.

## Trust Assumptions

| Assumption | Risk |
|---|---|
| The Web Crypto API produces correct SHA-256 | 🟢 Low — this is a platform standard, tested by billions of uses daily |
| The RPC endpoint returns honest event logs | 🟡 Medium — use a trusted or self-hosted RPC; public endpoints could lie |
| The portal code has not been modified | 🟡 Medium — verify the source on GitHub; a compromised CDN could replace the HTML |
| CORS allows eth_getLogs from browser | 🟢 Low — public RPC endpoints allow CORS for this method |

## Configuration

Set these before building:
```javascript
window.PEERPAR_CONTRACT_ADDRESS = "0x...";
window.PEERPAR_RPC_URL          = "https://sepolia.base.org";
window.PEERPAR_CHAIN_ID         = "84532";
window.PEERPAR_EXPLORER_URL     = "https://sepolia.basescan.org";
```

Or inject them at the `<script>` tag level in `index.html`.

## Deployment

The portal is a single static HTML file — host on any CDN:
```bash
npm run build          # Optional: bundle with Vite
# Or just serve public/index.html directly
```

## License

MIT
