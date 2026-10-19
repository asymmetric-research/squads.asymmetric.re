# Multisig Verifier

Zero-dependency transaction verifier for [Squads Protocol v4](https://squads.so) multisigs on Solana.

Reads multisig state directly from on-chain accounts, decodes proposal transactions (vault, config, batch), and lets connected wallet members approve or reject — all from a single static page with no backend. Account discriminators and struct layouts are verified against `@sqds/multisig` v2.1.4.

## Features

- Deserializes all Squads v4 account types (Multisig, Proposal, VaultTransaction, ConfigTransaction, Batch, VaultBatchTransaction)
- Decodes SPL Token, Token-2022, Associated Token, System, Stake, Compute Budget, Address Lookup Table, and BPF Upgradeable Loader instructions into human-readable summaries — control-changing operations (program upgrades, authority changes, token approvals) are flagged as critical
- On-demand on-chain program inspection for unrecognized programs: upgradeable vs immutable, upgrade authority, last-deploy slot
- Anchor discriminator hints and user-local program labels for everything else
- Resolves Address Lookup Tables for complete account display
- Collapsible instruction cards with accounts table, flags (writable/signer), and raw hex
- Approval progress bar with collapsible member grid showing vote status per member
- Wallet connect/disconnect via Wallet Standard (Phantom, Solflare, Backpack, etc.)
- Approve/reject flow with transaction signing, confirmation tracking, and stale-state re-fetch
- Inline address bar with live base58 validation and multisig switching
- Lockdown mode: a per-wallet view of explicitly pinned squads, each verified against the on-chain member roster before pinning and re-verified on every load — pinning is refused unless the connected wallet is a member
- On-chain address resolution: paste a vault address (as shown in the Squads web UI), create key, or proposal/transaction PDA and it resolves to the multisig account — vault matches are confirmed by re-deriving the vault PDA from the candidate multisig
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

A SvelteKit app, prerendered to a static client-only shell (`ssr = false`) with `@sveltejs/adapter-static`. The views
are Svelte 5 components; the on-chain logic underneath is plain JavaScript with no runtime dependencies.

```
squads.asymmetric.re/
├── src/
│   ├── app.html                # Page shell
│   ├── hooks.client.ts         # Script-injection guard (MutationObserver)
│   ├── routes/                 # Single route: +layout.ts (prerender, ssr off), +page.svelte (view switch)
│   └── lib/
│       ├── app.svelte.ts       # App state (runes) + actions: load, vote, pins, mode switching
│       ├── toasts.svelte.ts    # Toast queue
│       ├── format.ts           # Sanitization (bidi strip), timestamps, explorer URLs
│       ├── components/         # Setup, Layout, ProposalRow/Detail, Instruction, LockdownHome, ...
│       ├── style.css           # Full design system (dark/light, tokens, components)
│       ├── pins.js             # Per-wallet pin store, membership check, boot-mode selection
│       ├── decode-common.js    # Shared decoder helpers (amount/account formatting)
│       ├── decoders-spl.js     # SPL Token / Token-2022 / ATA instruction decoders
│       ├── decoders-native.js  # System, BPF loader, Stake, ComputeBudget, ALT decoders
│       ├── program-info.js     # On-demand loader-account inspection (session-cached)
│       ├── program-labels.js   # User-local program nicknames (localStorage)
│       ├── resolver.js         # Vault / create-key / PDA → multisig resolution
│       ├── rpc.js              # JSON-RPC fetch wrapper, ALT resolution, batch fetching
│       ├── squads.js           # Borsh reader, discriminators, PDA derivation, deserialization
│       ├── crypto.js           # SHA-256 (Web Crypto), Ed25519 curve check, findProgramAddress
│       ├── decode.js           # Instruction decoder registry (SPL Token, System, etc.)
│       ├── transaction.js      # Transaction builder for approve/reject instructions
│       ├── actions.js          # Builds the vote transaction (loaded on demand)
│       ├── wallet.js           # Wallet Standard discovery + adapter (zero deps)
│       └── *.test.js           # Vitest: discriminators, deserialization, decoders, PDAs, pins, ...
├── static/                     # Logos served as-is
├── svelte.config.js            # Adapter, <meta> CSP (hash mode), fixed version name
├── Dockerfile                  # nginx image serving build/ (RPC_URL build arg)
├── nginx/default.conf.template # Security headers + header CSP, RPC origin filled in at build
├── deploy/                     # Kubernetes manifests (prod, staging/, PR-preview infra)
├── docs/deploying.md           # Release runbook
└── scripts/
    ├── build.sh                # Production build + hash generation
    ├── generate-hash.sh        # SHA-256 of build/ contents
    ├── render-nginx.sh         # Fill the RPC origin into the nginx CSP
    └── verify.sh               # Verify a build against an expected hash
```

## Quick Start

```sh
bun install
bun run dev         # starts on http://localhost:5173
```

### Production Build

```sh
bun run build:hash  # production build + SHA-256 hash of build/
```

The build is reproducible: the same source and `RPC_URL` give the same hash. Distribute the hash alongside the
`build/` folder so users can verify it:

```sh
bash scripts/verify.sh <expected-hash> build
```

### Deploy

squads.asymmetric.re is built into an nginx image and deployed to Kubernetes by ArgoCD: every PR gets a static preview,
every merge to `main` goes to a Teleport-only staging site, and a `vX.Y.Z` tag ships to production. See
[`docs/deploying.md`](docs/deploying.md) for the runbook and [`deploy/README.md`](deploy/README.md) for the
infrastructure.

The deployed bundle has the production RPC endpoint baked in, so to check the live site against a build hash, build
with the same `RPC_URL` (visible in the served JavaScript under `_app/`).

## Configuration

All configuration happens in the browser UI. On first visit:

| Field | Description |
|---|---|
| **Multisig Address** | Base58-encoded Squads v4 multisig account address. Also accepts vault addresses (auto-resolved). |
| **RPC URL** | HTTPS endpoint for a Solana RPC provider (Helius, Triton, QuickNode). |
| **Explorer** | Block explorer for account/transaction links (Solscan, Solana Explorer, Helius XRAY). |

Settings persist in `localStorage` and sync across tabs.

## Security

- **No innerHTML** — Svelte text interpolation only; no `{@html}` anywhere
- **Bidi sanitization** — on-chain strings are stripped of Unicode bidirectional override characters before display
- **Content Security Policy** — `default-src 'none'`; scripts from `'self'` plus SvelteKit's inline bootstrap by hash; connects restricted to `https:` and `localhost` (the nginx header narrows them to the RPC endpoint)
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
bun install
bun run dev           # Vite dev server with hot reload
bun run check         # svelte-check (types + a11y), warnings fail
bun run lint          # Biome
bun run build         # production build into build/
bun run build:hash    # production build + integrity hash
bun run test          # Vitest
```

Discriminators and struct layouts are cross-validated against `@sqds/multisig` in `src/lib/verify.test.js` and
`src/lib/cross-validate-pda.test.js`.

## License

Dual-licensed under [Apache 2.0](LICENSE-APACHE) and [MIT](LICENSE-MIT).
