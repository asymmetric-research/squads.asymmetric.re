/**
 * Instruction decoding core — registry of family decoders, program label
 * resolution (user label → built-in → shortened pubkey), severity plumbing,
 * and the Anchor-discriminator fallback for unknown programs.
 *
 * Decoders live in decoders-spl.js / decoders-native.js and are registered
 * here (imported as plain maps — no side-effect registration, no cycles).
 * A decoder that throws degrades to the Unknown rendering; it never crashes
 * the instruction card.
 */
import { toHex, shortenAddress } from './squads.js';
import { getProgramLabel } from './program-labels.js';
import { SPL_DECODERS } from './decoders-spl.js';
import { NATIVE_DECODERS } from './decoders-native.js';

export const KNOWN_PROGRAMS = new Map([
  // Native
  ['11111111111111111111111111111111', 'System'],
  ['ComputeBudget111111111111111111111111111111', 'Compute Budget'],
  ['Stake11111111111111111111111111111111111111', 'Stake'],
  ['Vote111111111111111111111111111111111111111', 'Vote'],
  ['AddressLookupTab1e1111111111111111111111111', 'Address Lookup Table'],
  ['BPFLoaderUpgradeab1e11111111111111111111111', 'BPF Upgradeable Loader'],
  ['BPFLoader2111111111111111111111111111111111', 'BPF Loader v2'],
  // SPL
  ['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', 'SPL Token'],
  ['TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb', 'Token-2022'],
  ['ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL', 'Associated Token'],
  ['Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo', 'Memo v1'],
  ['MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr', 'Memo'],
  ['SPoo1Ku8WFXoNDMHPsrGSTSG1Y47rzgn41SLUNakuHy', 'SPL Stake Pool'],
  ['metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s', 'Metaplex Token Metadata'],
  // Squads
  ['SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf', 'Squads v4'],
  ['SMPLecH534NA9acpos4G6x7uf3LWbCAwZQE9e8ZekMu', 'Squads v3'],
  // DeFi / ecosystem (squadit's curated list)
  ['JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4', 'Jupiter v6'],
  ['whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc', 'Whirlpool'],
  ['675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8', 'Raydium AMM'],
  ['CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK', 'Raydium CLMM'],
  ['KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD', 'Kamino Lend'],
  ['MarBmsSgKXdrN1egZf5sqe1TMThczhMLJhMpbeVbnoB', 'Marinade'],
  ['BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY', 'Bubblegum'],
  ['M2mx93ekt1fmXSVkTrUL9xVFHkmME8HTUi5Cyc5aF7K', 'Magic Eden v2'],
]);

const decoders = new Map();
for (const [id, fn] of Object.entries(SPL_DECODERS)) decoders.set(id, fn);
for (const [id, fn] of Object.entries(NATIVE_DECODERS)) decoders.set(id, fn);

export function registerDecoder(programId, decodeFn) {
  decoders.set(programId, decodeFn);
}

function displayLabel(programId, builtinName) {
  return getProgramLabel(programId) || builtinName || shortenAddress(programId);
}

/**
 * Decode an instruction. Never throws.
 */
export function decodeInstruction(programId, data, accountKeys, accountIndexes) {
  const builtinName = KNOWN_PROGRAMS.get(programId);
  const decoder = decoders.get(programId);
  const base = {
    programId,
    program: displayLabel(programId, builtinName),
    isKnown: !!builtinName,
    rawHex: toHex(data),
  };

  if (decoder) {
    try {
      const decoded = decoder(data, accountKeys, accountIndexes);
      if (decoded.undecoded) {
        // Known program, unrecognized tag — render as Known with the tag shown
        return { ...base, type: 'unknown', description: decoded.description };
      }
      return { ...base, type: 'decoded', ...decoded };
    } catch {
      // Malformed data — fall through to unknown; the card must never crash
    }
  }

  const result = { ...base, type: 'unknown' };

  // Anchor hint: unknown program, no decoder, 8-byte discriminator present
  if (!builtinName && !decoder && data.length >= 8) {
    result.anchorHint = {
      // toHex emits space-separated bytes; the discriminator is shown as
      // continuous lowercase hex (matches Anchor tooling output)
      discriminator: toHex(data.slice(0, 8)).replaceAll(' ', ''),
      argBytes: data.length - 8,
    };
  }

  return result;
}
