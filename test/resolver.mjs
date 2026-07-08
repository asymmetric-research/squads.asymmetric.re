/**
 * Resolver tests — mock the JSON-RPC endpoint via fetch and verify that
 * vault / create-key / proposal / transaction addresses resolve to the
 * parent multisig account.
 *
 * Run with: node test/resolver.mjs
 */
import { webcrypto } from 'node:crypto';
if (!globalThis.crypto) globalThis.crypto = webcrypto;

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  PASS: ${message}`);
  } else {
    failed++;
    console.error(`  FAIL: ${message}`);
  }
}

function assertEq(actual, expected, message) {
  if (String(actual) === String(expected)) {
    passed++;
    console.log(`  PASS: ${message}`);
  } else {
    failed++;
    console.error(`  FAIL: ${message}`);
    console.error(`    Expected: ${expected}`);
    console.error(`    Actual:   ${actual}`);
  }
}

const {
  encodeBase58,
  decodeBase58,
  getMultisigPda,
  getMultisigVaultPda,
  MULTISIG_DISCRIMINATOR,
  PROPOSAL_DISCRIMINATOR,
  VAULT_TX_DISCRIMINATOR,
  PROGRAM_ID,
} = await import('../src/squads.js');

// Pinned mainnet pair (same vector as squadit's derive_multisig_pda test).
const CREATE_KEY = '6tgdsFTVeXeBULCUtg48djFUk4Fsij8xtz7ZMzrNyyRo';
const MULTISIG = '8Sr4rQJL2aQT3EL97mbrk1T9VMw4pCS2mxMPp2QBzHQq';
const MEMBER = 'So11111111111111111111111111111111111111112';
const SYSTEM = '11111111111111111111111111111111';
const PROPOSAL_ADDR = 'MarBmsSgKXdrN1egZf5sqe1TMThczhMLJhMpbeVbnoB';
const VAULT_TX_ADDR = 'BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY';
const WALLET_ADDR = 'nigmAPDCZMVDW4wneBBcc6wjY6Ufjv7iLJc2mRvs8PS';
const UNKNOWN_ADDR = 'nix9RErnQYXpuf329ntPgSzThogtfeyUempD7zDrnSH';

// ─── Minimal Borsh serializers for fixtures ───

function leBytes(value, size) {
  const buf = new Uint8Array(size);
  let v = BigInt(value);
  for (let i = 0; i < size; i++) {
    buf[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return buf;
}

function concat(parts) {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

function serializeMultisig(createKey, memberCount = 1) {
  const members = [leBytes(memberCount, 4)];
  for (let i = 0; i < memberCount; i++) {
    members.push(decodeBase58(MEMBER), new Uint8Array([7]));
  }
  return concat([
    MULTISIG_DISCRIMINATOR,
    decodeBase58(createKey),      // create_key
    new Uint8Array(32),           // config_authority
    leBytes(2, 2),                // threshold
    leBytes(0, 4),                // time_lock
    leBytes(5, 8),                // transaction_index
    leBytes(0, 8),                // stale_transaction_index
    new Uint8Array([0]),          // rent_collector: None
    new Uint8Array([254]),        // bump
    ...members,
  ]);
}

function serializeProposal(multisig) {
  return concat([
    PROPOSAL_DISCRIMINATOR,
    decodeBase58(multisig),
    leBytes(3, 8),                // transaction_index
    new Uint8Array([1]),          // status tag: Active
    leBytes(1700000000, 8),       // status timestamp
    new Uint8Array([255]),        // bump
    leBytes(0, 4),                // approved: []
    leBytes(0, 4),                // rejected: []
    leBytes(0, 4),                // cancelled: []
  ]);
}

function serializeVaultTransaction(multisig) {
  return concat([
    VAULT_TX_DISCRIMINATOR,
    decodeBase58(multisig),
    decodeBase58(MEMBER),         // creator
    leBytes(3, 8),                // index
    new Uint8Array([255]),        // bump
    new Uint8Array([0]),          // vault_index
    new Uint8Array([255]),        // vault_bump
    leBytes(0, 4),                // ephemeral_signer_bumps: []
    // message
    new Uint8Array([1, 1, 0]),    // num_signers, num_writable_signers, num_writable_non_signers
    leBytes(0, 4),                // account_keys: []
    leBytes(0, 4),                // instructions: []
    leBytes(0, 4),                // address_table_lookups: []
  ]);
}

// ─── Mock RPC ───

const accounts = new Map();     // base58 → { owner, lamports, data }
const signatures = new Map();   // base58 → [{ signature }]
const transactions = new Map(); // signature → accountKeys[]

function accountValue(addr) {
  const acc = accounts.get(addr);
  if (!acc) return null;
  return {
    owner: acc.owner,
    lamports: acc.lamports ?? 1,
    data: [Buffer.from(acc.data).toString('base64'), 'base64'],
    executable: false,
  };
}

let squadsApiCalls = 0;
let squadsApiResponse = null; // set to { address } to simulate an API hit
globalThis.fetch = async (url, opts = {}) => {
  if (String(url).startsWith('https://v4-api.squads.so/')) {
    squadsApiCalls++;
    if (squadsApiResponse) {
      return { ok: true, status: 200, json: async () => squadsApiResponse };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  }

  const { method, params } = JSON.parse(opts.body);
  let result;
  switch (method) {
    case 'getAccountInfo':
      result = { value: accountValue(params[0]) };
      break;
    case 'getMultipleAccounts':
      result = { value: params[0].map(accountValue) };
      break;
    case 'getSignaturesForAddress':
      result = signatures.get(params[0]) || [];
      break;
    case 'getTransaction': {
      const keys = transactions.get(params[0]);
      result = keys
        ? {
            transaction: { message: { accountKeys: keys } },
            meta: { loadedAddresses: { writable: [], readonly: [] } },
          }
        : null;
      break;
    }
    default:
      throw new Error('mock RPC: unexpected method ' + method);
  }
  return {
    ok: true,
    text: async () => JSON.stringify({ jsonrpc: '2.0', id: 1, result }),
  };
};

const { resolveMultisigAddress } = await import('../src/resolver.js');
const RPC = 'https://mock.rpc';

// ─── Fixtures ───

const [vault0Bytes] = await getMultisigVaultPda(MULTISIG, 0);
const VAULT_0 = encodeBase58(vault0Bytes);
const [vault5Bytes] = await getMultisigVaultPda(MULTISIG, 5);
const VAULT_5 = encodeBase58(vault5Bytes);

accounts.set(MULTISIG, { owner: PROGRAM_ID, data: serializeMultisig(CREATE_KEY) });
accounts.set(VAULT_0, { owner: SYSTEM, data: new Uint8Array(0), lamports: 1_000_000 });
accounts.set(PROPOSAL_ADDR, { owner: PROGRAM_ID, data: serializeProposal(MULTISIG) });
accounts.set(VAULT_TX_ADDR, { owner: PROGRAM_ID, data: serializeVaultTransaction(MULTISIG) });
accounts.set(WALLET_ADDR, { owner: SYSTEM, data: new Uint8Array(0), lamports: 42 });

signatures.set(VAULT_0, [{ signature: 'vault0-sig' }]);
transactions.set('vault0-sig', [VAULT_0, SYSTEM, MULTISIG]);
// VAULT_5 has no on-chain account (never funded) but has tx history.
signatures.set(VAULT_5, [{ signature: 'vault5-noise-sig' }, { signature: 'vault5-sig' }]);
transactions.set('vault5-noise-sig', [VAULT_5, SYSTEM]);
transactions.set('vault5-sig', [VAULT_5, MULTISIG]);

// ─── Tests ───

console.log('\n=== Multisig PDA derivation (pinned mainnet vector) ===');
{
  const [pdaBytes] = await getMultisigPda(CREATE_KEY);
  assertEq(encodeBase58(pdaBytes), MULTISIG, 'getMultisigPda(create_key) matches known mainnet multisig');
}

console.log('\n=== Direct multisig address ===');
{
  const r = await resolveMultisigAddress(RPC, MULTISIG);
  assertEq(r.type, 'multisig', 'direct: type is multisig');
  assertEq(r.multisigAddress, MULTISIG, 'direct: address unchanged');
  assert(!r.resolvedFrom, 'direct: not marked as resolved-from');
}

console.log('\n=== create_key → multisig ===');
{
  const r = await resolveMultisigAddress(RPC, CREATE_KEY);
  assertEq(r.type, 'multisig', 'create_key: type is multisig');
  assertEq(r.multisigAddress, MULTISIG, 'create_key: resolves to multisig PDA');
  assertEq(r.resolvedFrom, CREATE_KEY, 'create_key: resolvedFrom is input');
  assertEq(r.via, 'create key', 'create_key: via label');
}

console.log('\n=== vault → multisig (via recent tx, index 0) ===');
{
  const r = await resolveMultisigAddress(RPC, VAULT_0);
  assertEq(r.type, 'multisig', 'vault0: type is multisig');
  assertEq(r.multisigAddress, MULTISIG, 'vault0: resolves to parent multisig');
  assertEq(r.vaultIndex, 0, 'vault0: vault index 0 confirmed by PDA re-derivation');
}

console.log('\n=== vault → multisig (unfunded vault, index 5) ===');
{
  const r = await resolveMultisigAddress(RPC, VAULT_5);
  assertEq(r.type, 'multisig', 'vault5: type is multisig');
  assertEq(r.multisigAddress, MULTISIG, 'vault5: resolves to parent multisig');
  assertEq(r.vaultIndex, 5, 'vault5: vault index 5 confirmed by PDA re-derivation');
}

console.log('\n=== proposal account → multisig ===');
{
  const r = await resolveMultisigAddress(RPC, PROPOSAL_ADDR);
  assertEq(r.type, 'multisig', 'proposal: type is multisig');
  assertEq(r.multisigAddress, MULTISIG, 'proposal: resolves to parent multisig');
  assertEq(r.via, 'proposal', 'proposal: via label');
}

console.log('\n=== vault transaction account → multisig ===');
{
  const r = await resolveMultisigAddress(RPC, VAULT_TX_ADDR);
  assertEq(r.type, 'multisig', 'vault tx: type is multisig');
  assertEq(r.multisigAddress, MULTISIG, 'vault tx: resolves to parent multisig');
  assertEq(r.via, 'vault transaction', 'vault tx: via label');
}

console.log('\n=== unrelated wallet ===');
{
  const r = await resolveMultisigAddress(RPC, WALLET_ADDR);
  assertEq(r.type, 'wallet', 'wallet: type is wallet');
  assert(squadsApiCalls > 0, 'wallet: Squads API fallback was attempted');
}

console.log('\n=== nonexistent address ===');
{
  let threw = false;
  try {
    await resolveMultisigAddress(RPC, UNKNOWN_ADDR);
  } catch {
    threw = true;
  }
  assert(threw, 'nonexistent: throws');
}

console.log('\n=== Squads API fallback: unrelated multisig is rejected ===');
{
  // A wallet with no tx history; API claims MULTISIG is its parent, but the
  // wallet is not a vault of MULTISIG — the on-chain check must reject it.
  squadsApiResponse = { address: MULTISIG };
  const r = await resolveMultisigAddress(RPC, WALLET_ADDR);
  assertEq(r.type, 'wallet', 'api-unrelated: rejected, stays wallet');
  squadsApiResponse = null;
}

console.log('\n=== Squads API fallback: true parent is accepted ===');
{
  // A funded vault (index 3) with NO transaction history — only the API path
  // can resolve it, and the vault-PDA re-derivation must confirm the answer.
  const [vault3Bytes] = await getMultisigVaultPda(MULTISIG, 3);
  const VAULT_3 = encodeBase58(vault3Bytes);
  accounts.set(VAULT_3, { owner: SYSTEM, data: new Uint8Array(0), lamports: 777 });
  squadsApiResponse = { address: MULTISIG };
  const r = await resolveMultisigAddress(RPC, VAULT_3);
  assertEq(r.type, 'multisig', 'api-verified: type is multisig');
  assertEq(r.multisigAddress, MULTISIG, 'api-verified: resolves to parent multisig');
  assertEq(r.vaultIndex, 3, 'api-verified: vault index confirmed by PDA re-derivation');
  squadsApiResponse = null;
}

console.log('\n=== hostile RPC shapes do not crash resolution ===');
{
  // Null / malformed signature entries must be skipped, not destructured.
  const NULLSIG_ADDR = '2JLq2HWYLws938d3vZwS2r8Qex1FJJeXoF2KViPCZoyv';
  accounts.set(NULLSIG_ADDR, { owner: SYSTEM, data: new Uint8Array(0), lamports: 1 });
  signatures.set(NULLSIG_ADDR, [null, { bogus: 1 }, { signature: 12345 }]);
  const r = await resolveMultisigAddress(RPC, NULLSIG_ADDR);
  assertEq(r.type, 'wallet', 'null signature entries: skipped without throwing');

  // Garbage base64 in account data must be treated as a missing account.
  const GARBAGE_ADDR = '3LPh9LN88kxSe3shxLZ2R4jiNmHh2U2F9h9TmVKjc18P';
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    if (opts.body && JSON.parse(opts.body).method === 'getAccountInfo'
        && JSON.parse(opts.body).params[0] === GARBAGE_ADDR) {
      return {
        ok: true,
        text: async () => JSON.stringify({
          jsonrpc: '2.0', id: 1,
          result: { value: { owner: PROGRAM_ID, lamports: 1, data: ['!!!not-base64!!!', 'base64'] } },
        }),
      };
    }
    return realFetch(url, opts);
  };
  let threw = null;
  try {
    await resolveMultisigAddress(RPC, GARBAGE_ADDR);
  } catch (err) {
    threw = err;
  }
  assert(threw && /not found/i.test(threw.message), 'garbage base64 data: treated as missing account, no atob crash');
  globalThis.fetch = realFetch;
}

console.log('\n=== non-system-owned account skips the vault history scan ===');
{
  // An account owned by an unrelated program cannot be a vault, so its
  // transaction history must NOT be scanned. Use vault PDA index 9 but give
  // it a non-system owner: without the gate this WOULD resolve via history,
  // so 'unknown' here proves the scan was skipped.
  const [vault9Bytes] = await getMultisigVaultPda(MULTISIG, 9);
  const VAULT_9_FOREIGN = encodeBase58(vault9Bytes);
  accounts.set(VAULT_9_FOREIGN, {
    owner: 'BPFLoaderUpgradeab1e11111111111111111111111',
    data: new Uint8Array([1, 2, 3]),
  });
  signatures.set(VAULT_9_FOREIGN, [{ signature: 'foreign-vault-sig' }]);
  transactions.set('foreign-vault-sig', [VAULT_9_FOREIGN, MULTISIG]);
  const r = await resolveMultisigAddress(RPC, VAULT_9_FOREIGN);
  assertEq(r.type, 'unknown', 'program-owned vault PDA: history scan skipped, type is unknown');
}

console.log('\n=== large multisig (>256 members) still decodes ===');
{
  const BIG_MS = '4vK6sVXQNkiEY1wyqx9Q44JxMGRHS9XJ6NoavaZwzGLE';
  accounts.set(BIG_MS, { owner: PROGRAM_ID, data: serializeMultisig(CREATE_KEY, 300) });
  const r = await resolveMultisigAddress(RPC, BIG_MS);
  assertEq(r.type, 'multisig', 'large multisig: resolves directly');
  assertEq(r.multisigAddress, BIG_MS, 'large multisig: address unchanged');
}

console.log('\n=== Summary ===');
console.log(`  ${passed} passed, ${failed} failed`);

if (failed > 0) {
  process.exit(1);
} else {
  console.log('  All tests passed!\n');
}
