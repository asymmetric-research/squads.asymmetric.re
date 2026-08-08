/**
 * Pin store tests — localStorage-backed per-wallet pins, membership check
 * against a serialized multisig fixture, and boot-mode selection.
 *
 * Run with: node test/pins.mjs
 */

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) { passed++; console.log(`  PASS: ${message}`); }
  else { failed++; console.error(`  FAIL: ${message}`); }
}

function assertEq(actual, expected, message) {
  const a = typeof actual === 'object' ? JSON.stringify(actual) : String(actual);
  const e = typeof expected === 'object' ? JSON.stringify(expected) : String(expected);
  if (a === e) { passed++; console.log(`  PASS: ${message}`); }
  else {
    failed++;
    console.error(`  FAIL: ${message}`);
    console.error(`    Expected: ${e}`);
    console.error(`    Actual:   ${a}`);
  }
}

// ─── localStorage shim (node has none) ───
const storage = new Map();
let quotaExceeded = false;
globalThis.localStorage = {
  getItem: (k) => (storage.has(k) ? storage.get(k) : null),
  setItem: (k, v) => {
    if (quotaExceeded) throw new Error('QuotaExceededError');
    storage.set(k, String(v));
  },
  removeItem: (k) => storage.delete(k),
};

const {
  getPins, addPin, removePin, hasAnyPins,
  findMember, resolveBootMode, isStickyOpen, setStickyOpen, reloadPinStore,
} = await import('../src/pins.js');
const { deserializeMultisig, decodeBase58, MULTISIG_DISCRIMINATOR } = await import('../src/squads.js');

const WALLET_A = 'So11111111111111111111111111111111111111112';
const WALLET_B = 'nigmAPDCZMVDW4wneBBcc6wjY6Ufjv7iLJc2mRvs8PS';
const OUTSIDER = 'nix9RErnQYXpuf329ntPgSzThogtfeyUempD7zDrnSH';
const MS_1 = '8Sr4rQJL2aQT3EL97mbrk1T9VMw4pCS2mxMPp2QBzHQq';
const MS_2 = 'MarBmsSgKXdrN1egZf5sqe1TMThczhMLJhMpbeVbnoB';

// ─── Serialized multisig fixture (same layout vectors as test/resolver.mjs
//     and squadit's Rust parser) ───

function leBytes(value, size) {
  const buf = new Uint8Array(size);
  let v = BigInt(value);
  for (let i = 0; i < size; i++) { buf[i] = Number(v & 0xffn); v >>= 8n; }
  return buf;
}

function concat(parts) {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) { out.set(p, offset); offset += p.length; }
  return out;
}

// members: [[base58Key, permissionsMask], ...]
function serializeMultisig(members) {
  const memberBytes = [leBytes(members.length, 4)];
  for (const [key, mask] of members) {
    memberBytes.push(decodeBase58(key), new Uint8Array([mask]));
  }
  return concat([
    MULTISIG_DISCRIMINATOR,
    decodeBase58(WALLET_A),       // create_key
    new Uint8Array(32),           // config_authority
    leBytes(2, 2),                // threshold
    leBytes(0, 4),                // time_lock
    leBytes(5, 8),                // transaction_index
    leBytes(0, 8),                // stale_transaction_index
    new Uint8Array([0]),          // rent_collector: None
    new Uint8Array([254]),        // bump
    ...memberBytes,
  ]);
}

// ─── findMember against a deserialized fixture ───
console.log('findMember:');
{
  const multisig = deserializeMultisig(serializeMultisig([[WALLET_A, 7], [WALLET_B, 2]]));
  const memberA = findMember(multisig, WALLET_A);
  assert(memberA !== null, 'finds member A');
  assertEq(memberA.permissionsMask, 7, 'member A mask parsed as 7');
  const memberB = findMember(multisig, WALLET_B);
  assert(memberB !== null, 'finds member B');
  assertEq(memberB.permissions, ['Vote'], 'member B has Vote-only permissions');
  assertEq(findMember(multisig, OUTSIDER), null, 'outsider is not a member');
}

// ─── Pin store CRUD ───
console.log('pin store:');
{
  assertEq(getPins(WALLET_A), [], 'empty store returns no pins');
  assertEq(hasAnyPins(), false, 'hasAnyPins false on empty store');

  const { pins, persisted } = addPin(WALLET_A, { multisigAddress: MS_1, label: 'Treasury' });
  assert(persisted, 'addPin persists');
  assertEq(pins.length, 1, 'addPin returns one pin');
  assertEq(pins[0].multisigAddress, MS_1, 'pin has multisig address');
  assertEq(pins[0].label, 'Treasury', 'pin has label');
  assert(typeof pins[0].pinnedAt === 'number', 'pin has pinnedAt timestamp');

  addPin(WALLET_A, { multisigAddress: MS_1, label: 'dupe' });
  assertEq(getPins(WALLET_A).length, 1, 'duplicate multisig is not re-added');

  addPin(WALLET_A, { multisigAddress: MS_2, label: 'x'.repeat(100) });
  assertEq(getPins(WALLET_A)[1].label.length, 32, 'label capped at 32 chars');

  addPin(WALLET_B, { multisigAddress: MS_2, label: '' });
  assertEq(getPins(WALLET_B).length, 1, 'wallet B has its own list');
  assertEq(getPins(WALLET_A).length, 2, 'wallet A list unaffected by wallet B');
  assert(hasAnyPins(), 'hasAnyPins true with pins');

  removePin(WALLET_A, MS_1);
  assertEq(getPins(WALLET_A).length, 1, 'removePin removes one pin');
  assertEq(getPins(WALLET_A)[0].multisigAddress, MS_2, 'remaining pin is MS_2');

  // Persistence round-trip: drop cache, re-read from storage
  reloadPinStore();
  assertEq(getPins(WALLET_A).length, 1, 'pins survive cache reload');
}

// ─── Corrupt stored data ───
console.log('corrupt data:');
{
  storage.set('pinnedSquads', 'not json{{{');
  reloadPinStore();
  assertEq(getPins(WALLET_A), [], 'corrupt JSON treated as empty');

  storage.set('pinnedSquads', JSON.stringify([1, 2, 3]));
  reloadPinStore();
  assertEq(hasAnyPins(), false, 'array at top level treated as empty');

  storage.set('pinnedSquads', JSON.stringify({ [WALLET_A]: [{ bogus: true }, { multisigAddress: MS_1 }] }));
  reloadPinStore();
  assertEq(getPins(WALLET_A).length, 1, 'entries without multisigAddress are dropped');
}

// ─── Quota errors keep the in-memory cache ───
console.log('quota errors:');
{
  storage.delete('pinnedSquads');
  reloadPinStore();
  quotaExceeded = true;
  const { persisted } = addPin(WALLET_A, { multisigAddress: MS_1, label: '' });
  assertEq(persisted, false, 'addPin reports persistence failure');
  assertEq(getPins(WALLET_A).length, 1, 'pin retained in memory despite quota error');
  quotaExceeded = false;
}

// ─── Boot mode ───
console.log('resolveBootMode:');
{
  assertEq(resolveBootMode({ hasPins: false, stickyOpen: false, sessionMode: null }), 'open', 'no pins -> open');
  assertEq(resolveBootMode({ hasPins: true, stickyOpen: false, sessionMode: null }), 'lockdown', 'pins -> lockdown');
  assertEq(resolveBootMode({ hasPins: true, stickyOpen: true, sessionMode: null }), 'open', 'sticky open overrides pins');
  assertEq(resolveBootMode({ hasPins: true, stickyOpen: false, sessionMode: 'open' }), 'open', 'session override open wins');
  assertEq(resolveBootMode({ hasPins: false, stickyOpen: false, sessionMode: 'lockdown' }), 'lockdown', 'session override lockdown wins');
  assertEq(resolveBootMode({ hasPins: true, stickyOpen: false, sessionMode: 'garbage' }), 'lockdown', 'invalid session override ignored');
}

// ─── Sticky open flag ───
console.log('stickyOpen:');
{
  assertEq(isStickyOpen(), false, 'sticky open defaults false');
  setStickyOpen(true);
  assertEq(isStickyOpen(), true, 'sticky open set');
  setStickyOpen(false);
  assertEq(isStickyOpen(), false, 'sticky open cleared');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
