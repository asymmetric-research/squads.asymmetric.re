# Multisig Verifier

Zero-dependency transaction verifier for [Squads Protocol v4](https://squads.so) multisigs on Solana.

Reads multisig state directly from on-chain accounts, decodes proposal transactions (vault, config, batch), and lets connected wallet members approve or reject — all from a single static page with no backend. Account discriminators and struct layouts are verified against `@sqds/multisig` v2.1.4.

## Features

- Deserializes all Squads v4 account types (Multisig, Proposal, VaultTransaction, ConfigTransaction, Batch, VaultBatchTransaction)
- Decodes SPL Token, Token-2022, System Program, Compute Budget, and Associated Token instructions into human-readable summaries
- Resolves Address Lookup Tables for complete account display
- Collapsible instruction cards with accounts table, flags (writable/signer), and raw hex
- Approval progress bar with collapsible member grid showing vote status per member
- Wallet connect/disconnect via Wallet Standard (Phantom, Solflare, Backpack, etc.)
- Approve/reject flow with transaction signing, confirmation tracking, and stale-state re-fetch
- Inline address bar with live base58 validation and multisig switching
- Explorer links to Solscan, Solana Explorer, or Helius XRAY
- Dark/light mode via `prefers-color-scheme`
- Build hash verification for reproducible deploys
- Content Security Policy headers — no inline scripts, no external resources

## Architecture

```
Browser ──fetch──> Solana RPC (your provider)
   │
   ├── Deserialize multisig account (members, threshold, transaction index)
   ├── Batch-fetch proposal PDAs (getMultipleAccounts)
   ├── Fetch transaction PDAs (vault/config/batch)
   │   └── Resolve Address Lookup Tables for v0 messages
   ├── Decode instructions (SPL Token, System, Compute Budget)
   └── Sign + send approve/reject via Wallet Standard
```

All account parsing uses a hand-written Borsh reader with no external dependencies. PDA derivation uses the Web Crypto API (`SHA-256`) with a pure-JS Ed25519 curve check.

## Project Structure

```
multisig-verifier/
├── index.html                  # Shell — CSP headers, no inline scripts
├── style.css                   # Full design system (dark/light, tokens, components)
├── webpack.config.js           # Production build config (content hashing, minification)
├── src/
│   ├── main.js                 # Boot, state wiring, event handlers
│   ├── state.js                # Frozen immutable state + localStorage persistence
│   ├── rpc.js                  # JSON-RPC fetch wrapper, ALT resolution, batch fetching
│   ├── squads.js               # Borsh reader, discriminators, PDA derivation, deserialization
│   ├── crypto.js               # SHA-256 (Web Crypto), Ed25519 curve check, findProgramAddress
│   ├── decode.js               # Instruction decoder registry (SPL Token, System, etc.)
│   ├── transaction.js          # Transaction builder for approve/reject instructions
│   ├── actions.js              # Vote flow (dynamic import, re-fetch, sign, confirm)
│   ├── wallet.js               # Wallet Standard discovery + adapter (zero deps)
│   ├── ui-layout.js            # All views: setup, main layout, modals, proposal detail
│   └── ui-helpers.js           # Hyperscript el(), address elements, formatting, sanitization
├── public/                     # Static assets (SVG logos)
├── scripts/
│   ├── build.sh                # Production build + hash generation
│   ├── generate-hash.sh        # SHA-256 of dist/ contents
│   └── verify.sh               # Verify a build against an expected hash
└── test/
    ├── verify.mjs              # Discriminator + deserialization tests
    └── cross-validate-pda.mjs  # PDA derivation cross-check against @sqds/multisig
```

## Quick Start

```sh
npm install
npm run dev         # starts on http://localhost:8080
```

### Production Build

```sh
npm run build:hash  # webpack production build + SHA-256 hash of dist/
```

The build hash is printed to stdout. Distribute it alongside the `dist/` folder so users can verify the build:

```sh
bash scripts/verify.sh <expected-hash> dist
```

### Deploy

The `dist/` directory is a fully static site. Deploy to any static host:

```sh
# Cloudflare Pages
npx wrangler pages deploy dist

# Vercel
npx vercel dist

# Netlify
npx netlify deploy --dir=dist --prod

# Or just serve locally
npx serve dist
```

## Configuration

All configuration happens in the browser UI. On first visit:

| Field | Description |
|---|---|
| **Multisig Address** | Base58-encoded Squads v4 multisig account address. Also accepts vault addresses (auto-resolved). |
| **RPC URL** | HTTPS endpoint for a Solana RPC provider (Helius, Triton, QuickNode). |
| **Explorer** | Block explorer for account/transaction links (Solscan, Solana Explorer, Helius XRAY). |

Settings persist in `localStorage` and sync across tabs.

## Security

- **No innerHTML** — all DOM construction uses `createElement` + `textContent` via the `el()` hyperscript helper
- **Bidi sanitization** — on-chain strings are stripped of Unicode bidirectional override characters before display
- **Content Security Policy** — `default-src 'none'`; scripts and styles from `'self'` only; connects restricted to `https:` and `localhost`
- **Script injection detection** — a `MutationObserver` halts the page if any unexpected `<script>` element is added at runtime
- **Frame-busting** — CSP `frame-ancestors 'none'` prevents embedding in iframes
- **No secrets** — RPC URLs and wallet keys are never sent to any backend; all operations are client-to-RPC

## Squads v4 Program

- **Program ID:** `SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf`
- **Network:** Solana Mainnet
- **SDK Reference:** `@sqds/multisig` v2.1.4

### Why the Squads types are duplicated

The official `@sqds/multisig` SDK depends on `@solana/web3.js` v1.x (~400 KB) and its transitive dependency tree. This verifier re-implements Borsh deserialization and PDA derivation from scratch (~300 lines in `squads.js` + `crypto.js`) to stay at zero runtime dependencies. All discriminators and struct layouts are cross-validated against the SDK in the test suite.

## Development

```sh
npm install
npm run dev           # webpack-dev-server with hot reload
npm run build         # production build
npm run build:hash    # production build + integrity hash
```

### Tests

```sh
node test/verify.mjs              # discriminator + deserialization
node test/cross-validate-pda.mjs  # PDA derivation vs @sqds/multisig
```

## License

Dual-licensed under [Apache 2.0](LICENSE-APACHE) and [MIT](LICENSE-MIT).
