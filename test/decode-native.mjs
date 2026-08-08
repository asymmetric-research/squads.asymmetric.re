/**
 * Native program decoder tests (System, BPF Upgradeable Loader, Stake,
 * Compute Budget, Address Lookup Table). Run with: node test/decode-native.mjs
 */
let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) { passed++; console.log(`  PASS: ${message}`); }
  else { failed++; console.error(`  FAIL: ${message}`); }
}

function assertEq(actual, expected, message) {
  if (String(actual) === String(expected)) { passed++; console.log(`  PASS: ${message}`); }
  else {
    failed++;
    console.error(`  FAIL: ${message}`);
    console.error(`    Expected: ${expected}`);
    console.error(`    Actual:   ${actual}`);
  }
}

const { NATIVE_DECODERS } = await import('../src/decoders-native.js');
const { decodeBase58 } = await import('../src/squads.js');

const SYSTEM = '11111111111111111111111111111111';
const LOADER = 'BPFLoaderUpgradeab1e11111111111111111111111';
const STAKE = 'Stake11111111111111111111111111111111111111';
const BUDGET = 'ComputeBudget111111111111111111111111111111';
const ALT = 'AddressLookupTab1e1111111111111111111111111';

const K = [
  'So11111111111111111111111111111111111111112',   // 0
  'nigmAPDCZMVDW4wneBBcc6wjY6Ufjv7iLJc2mRvs8PS',    // 1
  'nix9RErnQYXpuf329ntPgSzThogtfeyUempD7zDrnSH',    // 2
  '8Sr4rQJL2aQT3EL97mbrk1T9VMw4pCS2mxMPp2QBzHQq',   // 3
  'MarBmsSgKXdrN1egZf5sqe1TMThczhMLJhMpbeVbnoB',    // 4
  'BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY',    // 5
  'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',    // 6
];

function u32le(n) {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, true);
  return b;
}
function u64le(n) {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, BigInt(n), true);
  return b;
}
function cat(...parts) {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

console.log('BPF loader — Upgrade:');
{
  // accounts: [programdata, program, buffer, spill, rent, clock, authority]
  const r = NATIVE_DECODERS[LOADER](u32le(3), K, [0, 1, 2, 3, 4, 5, 6]);
  assertEq(r.action, 'Upgrade', 'action');
  assertEq(r.severity, 'critical', 'upgrade is critical');
  assertEq(r.details.program, K[1], 'program = account 1');
  assertEq(r.details.buffer, K[2], 'buffer = account 2');
  assertEq(r.details.spill, K[3], 'spill = account 3');
  assertEq(r.details.authority, K[6], 'authority = account 6');
  assert(r.description.includes('Upgrade'), 'description says upgrade');
}

console.log('BPF loader — SetAuthority / SetAuthorityChecked / Close:');
{
  const sa = NATIVE_DECODERS[LOADER](u32le(4), K, [0, 1, 2]);
  assertEq(sa.action, 'SetAuthority', 'set authority');
  assertEq(sa.severity, 'critical', 'critical');
  assertEq(sa.details.currentAuthority, K[1], 'current authority');
  assertEq(sa.details.newAuthority, K[2], 'new authority');

  const saNoNew = NATIVE_DECODERS[LOADER](u32le(4), K, [0, 1]);
  assertEq(saNoNew.details.newAuthority, 'none (authority removed)', 'missing new authority = removed');

  const sac = NATIVE_DECODERS[LOADER](u32le(7), K, [0, 1, 2]);
  assertEq(sac.action, 'SetAuthorityChecked', 'set authority checked');

  const close = NATIVE_DECODERS[LOADER](u32le(5), K, [0, 1, 2]);
  assertEq(close.action, 'Close', 'close');
  assertEq(close.severity, 'critical', 'critical');
  assertEq(close.details.recipient, K[1], 'lamports recipient');
}

console.log('BPF loader — Write / Deploy / Extend:');
{
  const w = NATIVE_DECODERS[LOADER](cat(u32le(1), u32le(512), u64le(3), new Uint8Array([9, 9, 9])), K, [0, 1]);
  assertEq(w.action, 'Write', 'write');
  assert(w.description.includes('3 bytes'), 'byte count summarized');
  assert(w.description.includes('512'), 'offset shown');

  const d = NATIVE_DECODERS[LOADER](cat(u32le(2), u64le(1000000)), K, [0, 1, 2, 3]);
  assertEq(d.action, 'DeployWithMaxDataLen', 'deploy');
  assertEq(d.severity, undefined, 'deploy is not critical (spec list is Upgrade/SetAuthority/SetAuthorityChecked/Close)');

  const e = NATIVE_DECODERS[LOADER](cat(u32le(6), u32le(4096)), K, [0, 1]);
  assertEq(e.action, 'ExtendProgram', 'extend');
  assert(e.description.includes('4096'), 'additional bytes shown');
}

console.log('System — expanded coverage:');
{
  const assign = NATIVE_DECODERS[SYSTEM](cat(u32le(1), decodeBase58(K[3])), K, [0]);
  assertEq(assign.action, 'Assign', 'assign');
  assertEq(assign.severity, 'critical', 'assign is critical');
  assertEq(assign.details.newOwner, K[3], 'new owner from data');

  const alloc = NATIVE_DECODERS[SYSTEM](cat(u32le(8), u64le(1024)), K, [0]);
  assertEq(alloc.action, 'Allocate', 'allocate');

  const transfer = NATIVE_DECODERS[SYSTEM](cat(u32le(2), u64le(1500000000)), K, [0, 1]);
  assertEq(transfer.action, 'Transfer', 'transfer');
  assert(transfer.description.includes('1.5000 SOL'), 'SOL formatted');

  // CreateAccountWithSeed: base pk + seed (u64-len string) + lamports + space + owner
  const seed = new TextEncoder().encode('vault');
  const caws = NATIVE_DECODERS[SYSTEM](
    cat(u32le(3), decodeBase58(K[2]), u64le(seed.length), seed, u64le(10), u64le(100), decodeBase58(K[3])),
    K, [0, 1],
  );
  assertEq(caws.action, 'CreateAccountWithSeed', 'create with seed');
  assertEq(caws.details.seed, 'vault', 'seed string decoded');
  assertEq(caws.details.owner, K[3], 'owner decoded');

  const auth = NATIVE_DECODERS[SYSTEM](cat(u32le(7), decodeBase58(K[2])), K, [0, 1]);
  assertEq(auth.action, 'AuthorizeNonceAccount', 'authorize nonce');
  assertEq(auth.severity, 'critical', 'critical');

  const withdraw = NATIVE_DECODERS[SYSTEM](cat(u32le(5), u64le(2000000000)), K, [0, 1, 2, 3, 4]);
  assertEq(withdraw.action, 'WithdrawNonceAccount', 'withdraw nonce');
  assert(withdraw.description.includes('2.0000 SOL'), 'lamports formatted');
}

console.log('Stake:');
{
  const del = NATIVE_DECODERS[STAKE](u32le(2), K, [0, 1, 2, 3, 4, 5]);
  assertEq(del.action, 'DelegateStake', 'delegate');
  assertEq(del.details.voteAccount, K[1], 'vote account');

  // Authorize: new_authorized pubkey + stake_authorize u32 (1 = Withdrawer)
  const auth = NATIVE_DECODERS[STAKE](cat(u32le(1), decodeBase58(K[4]), u32le(1)), K, [0, 1, 2]);
  assertEq(auth.action, 'Authorize', 'authorize');
  assertEq(auth.severity, 'critical', 'critical');
  assert(auth.description.includes('withdrawer'), 'authority kind named');
  assertEq(auth.details.newAuthority, K[4], 'new authority');

  const authOdd = NATIVE_DECODERS[STAKE](cat(u32le(1), decodeBase58(K[4]), u32le(7)), K, [0, 1, 2]);
  assert(authOdd.description.includes('unknown kind 7'), 'malformed authorize kind does not claim withdrawer');

  const split = NATIVE_DECODERS[STAKE](cat(u32le(3), u64le(5000000000)), K, [0, 1, 2]);
  assertEq(split.action, 'Split', 'split');

  const wd = NATIVE_DECODERS[STAKE](cat(u32le(4), u64le(1000000000)), K, [0, 1, 2, 3, 4]);
  assertEq(wd.action, 'Withdraw', 'withdraw');

  assertEq(NATIVE_DECODERS[STAKE](u32le(5), K, [0, 1, 2]).action, 'Deactivate', 'deactivate');

  // SetLockup: args unread (Option fields), authority from accounts
  const lockup = NATIVE_DECODERS[STAKE](u32le(6), K, [0, 1]);
  assertEq(lockup.action, 'SetLockup', 'set lockup');
  assertEq(lockup.severity, 'critical', 'set lockup critical');

  const merge = NATIVE_DECODERS[STAKE](u32le(7), K, [0, 1, 2, 3, 4]);
  assertEq(merge.action, 'Merge', 'merge');
  assertEq(merge.details.sourceStake, K[1], 'merge source');

  // AuthorizeWithSeed: new_authorized pubkey + stake_authorize u32 (trailing seed/owner unread)
  const aws = NATIVE_DECODERS[STAKE](cat(u32le(8), decodeBase58(K[4]), u32le(1)), K, [0, 1, 2]);
  assertEq(aws.action, 'AuthorizeWithSeed', 'authorize with seed');
  assertEq(aws.severity, 'critical', 'authorize with seed critical');
  assertEq(aws.details.newAuthority, K[4], 'aws new authority');
  assert(aws.description.includes('withdrawer'), 'aws kind named');

  assertEq(NATIVE_DECODERS[STAKE](u32le(9), K, [0, 1, 2, 3]).action, 'InitializeChecked', 'initialize checked');

  // AuthorizeChecked: stake_authorize u32 only; new authority is account 3
  const ac = NATIVE_DECODERS[STAKE](cat(u32le(10), u32le(1)), K, [0, 1, 2, 3]);
  assertEq(ac.action, 'AuthorizeChecked', 'authorize checked');
  assertEq(ac.severity, 'critical', 'authorize checked critical');
  assertEq(ac.details.newAuthority, K[3], 'ac new authority from accounts');

  const acws = NATIVE_DECODERS[STAKE](cat(u32le(11), u32le(0)), K, [0, 1, 2, 3]);
  assertEq(acws.action, 'AuthorizeCheckedWithSeed', 'authorize checked with seed');
  assertEq(acws.severity, 'critical', 'acws critical');
  assert(acws.description.includes('staker'), 'acws kind named');

  const slc = NATIVE_DECODERS[STAKE](u32le(12), K, [0, 1, 2]);
  assertEq(slc.action, 'SetLockupChecked', 'set lockup checked');
  assertEq(slc.severity, 'critical', 'set lockup checked critical');

  // Truly unknown tag still falls through to undecoded
  assert(NATIVE_DECODERS[STAKE](u32le(99), K, [0]).undecoded, 'unknown tag undecoded');
}

console.log('Compute budget:');
{
  const limit = NATIVE_DECODERS[BUDGET](cat(new Uint8Array([2]), u32le(400000)), K, []);
  assertEq(limit.action, 'SetComputeUnitLimit', 'unit limit');
  assert(limit.description.includes('400000') || limit.description.includes('400,000'), 'units shown');

  const price = NATIVE_DECODERS[BUDGET](cat(new Uint8Array([3]), u64le(50000)), K, []);
  assertEq(price.action, 'SetComputeUnitPrice', 'unit price');

  const heap = NATIVE_DECODERS[BUDGET](cat(new Uint8Array([1]), u32le(262144)), K, []);
  assertEq(heap.action, 'RequestHeapFrame', 'heap');
}

console.log('Address lookup table:');
{
  const create = NATIVE_DECODERS[ALT](cat(u32le(0), u64le(123456), new Uint8Array([254])), K, [0, 1, 2]);
  assertEq(create.action, 'CreateLookupTable', 'create');

  // Extend: Vec<Pubkey> with u64 length
  const ext = NATIVE_DECODERS[ALT](cat(u32le(2), u64le(2), decodeBase58(K[3]), decodeBase58(K[4])), K, [0, 1]);
  assertEq(ext.action, 'ExtendLookupTable', 'extend');
  assert(ext.description.includes('2 address'), 'address count shown');

  assertEq(NATIVE_DECODERS[ALT](u32le(1), K, [0, 1]).action, 'FreezeLookupTable', 'freeze');
  assertEq(NATIVE_DECODERS[ALT](u32le(3), K, [0, 1]).action, 'DeactivateLookupTable', 'deactivate');
  assertEq(NATIVE_DECODERS[ALT](u32le(4), K, [0, 1, 2]).action, 'CloseLookupTable', 'close');
}

console.log('unknown tags degrade:');
{
  assertEq(NATIVE_DECODERS[SYSTEM](u32le(99), K, [0]).undecoded, true, 'system unknown tag');
  assertEq(NATIVE_DECODERS[LOADER](u32le(99), K, [0]).undecoded, true, 'loader unknown tag');
  let threw = false;
  try { NATIVE_DECODERS[SYSTEM](new Uint8Array([1, 2]), K, [0]); } catch { threw = true; }
  assert(threw, 'truncated system data throws (core degrades to Unknown)');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
