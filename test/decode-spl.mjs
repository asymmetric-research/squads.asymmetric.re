/**
 * SPL Token / Token-2022 / ATA decoder tests. Run with: node test/decode-spl.mjs
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

const { SPL_DECODERS } = await import('../src/decoders-spl.js');
const { decodeBase58 } = await import('../src/squads.js');

const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const ATA = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
const K = [
  'So11111111111111111111111111111111111111112',   // 0
  'nigmAPDCZMVDW4wneBBcc6wjY6Ufjv7iLJc2mRvs8PS',    // 1
  'nix9RErnQYXpuf329ntPgSzThogtfeyUempD7zDrnSH',    // 2
  '8Sr4rQJL2aQT3EL97mbrk1T9VMw4pCS2mxMPp2QBzHQq',   // 3
];

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

const decode = SPL_DECODERS[TOKEN];

console.log('token approve:');
{
  const r = decode(cat(new Uint8Array([4]), u64le(5000)), K, [0, 1, 2]);
  assertEq(r.action, 'Approve', 'action');
  assertEq(r.severity, 'critical', 'approve is critical');
  assert(r.description.includes('5000'), 'description carries amount');
  assertEq(r.details.delegate, K[1], 'delegate = account 1');
}

console.log('token approve-checked:');
{
  const r = decode(cat(new Uint8Array([13]), u64le(1500000), new Uint8Array([6])), K, [0, 1, 2, 3]);
  assertEq(r.action, 'ApproveChecked', 'action');
  assert(r.description.includes('1.5'), 'amount formatted with decimals');
  assertEq(r.details.delegate, K[2], 'delegate = account 2 (after mint)');
  assertEq(r.severity, 'critical', 'critical');
}

console.log('token set-authority:');
{
  // [tag=6][authority_type=2 AccountOwner][COption tag=1][new authority pubkey]
  const r = decode(cat(new Uint8Array([6, 2, 1]), decodeBase58(K[3])), K, [0, 1]);
  assertEq(r.action, 'SetAuthority', 'action');
  assertEq(r.severity, 'critical', 'critical');
  assert(r.description.includes('owner'), 'names the authority type');
  assertEq(r.details.newAuthority, K[3], 'new authority decoded');
}
{
  // COption tag=0 → authority removed (irrevocable)
  const r = decode(new Uint8Array([6, 0, 0]), K, [0, 1]);
  assertEq(r.details.newAuthority, 'none (removed)', 'None renders as removed');
}

console.log('token revoke / close / freeze / thaw / sync:');
{
  assertEq(decode(new Uint8Array([5]), K, [0, 1]).action, 'Revoke', 'revoke');
  const close = decode(new Uint8Array([9]), K, [0, 1, 2]);
  assertEq(close.action, 'CloseAccount', 'close');
  assertEq(close.details.destination, K[1], 'close rent destination');
  assertEq(decode(new Uint8Array([10]), K, [0, 1, 2]).action, 'FreezeAccount', 'freeze');
  assertEq(decode(new Uint8Array([11]), K, [0, 1, 2]).action, 'ThawAccount', 'thaw');
  assertEq(decode(new Uint8Array([17]), K, [0]).action, 'SyncNative', 'sync native');
}

console.log('token mint/burn:');
{
  const mint = decode(cat(new Uint8Array([7]), u64le(42)), K, [0, 1, 2]);
  assertEq(mint.action, 'MintTo', 'mint action');
  assertEq(mint.details.destination, K[1], 'mint destination');
  const burn = decode(cat(new Uint8Array([8]), u64le(42)), K, [0, 1, 2]);
  assertEq(burn.action, 'Burn', 'burn action');
  const burnChecked = decode(cat(new Uint8Array([15]), u64le(250), new Uint8Array([2])), K, [0, 1, 2]);
  assert(burnChecked.description.includes('2.50'), 'burnChecked formats decimals');
}

console.log('token transfers still work:');
{
  const t = decode(cat(new Uint8Array([3]), u64le(999)), K, [0, 1, 2]);
  assertEq(t.action, 'Transfer', 'transfer');
  const tc = decode(cat(new Uint8Array([12]), u64le(123456), new Uint8Array([3])), K, [0, 1, 2, 3]);
  assertEq(tc.action, 'TransferChecked', 'transferChecked');
  assert(tc.description.includes('123.456'), 'transferChecked formats decimals');
}

console.log('token init variants:');
{
  assertEq(decode(new Uint8Array([1]), K, [0, 1, 2, 3]).action, 'InitializeAccount', 'init account');
  const i3 = decode(cat(new Uint8Array([18]), decodeBase58(K[2])), K, [0, 1]);
  assertEq(i3.action, 'InitializeAccount3', 'init account 3');
  assertEq(i3.details.owner, K[2], 'owner from data');
  assertEq(decode(new Uint8Array([22]), K, [0]).action, 'InitializeImmutableOwner', 'immutable owner');
}

console.log('unknown tag / malformed:');
{
  const u = decode(new Uint8Array([200]), K, [0]);
  assertEq(u.undecoded, true, 'unknown tag flagged undecoded');
  assert(u.description.includes('200'), 'tag number shown');
  let threw = false;
  try { decode(cat(new Uint8Array([4]), new Uint8Array([1, 2])), K, [0, 1, 2]); } catch { threw = true; }
  assert(threw, 'truncated approve throws (core will degrade to Unknown)');
}

console.log('token-2022 shares layouts:');
{
  const r = SPL_DECODERS[TOKEN_2022](cat(new Uint8Array([4]), u64le(1)), K, [0, 1, 2]);
  assertEq(r.action, 'Approve', 'same decoder registered for Token-2022');
}

console.log('ATA:');
{
  assertEq(SPL_DECODERS[ATA](new Uint8Array(0), K, [0, 1, 2, 3]).action, 'Create', 'empty data = Create');
  assertEq(SPL_DECODERS[ATA](new Uint8Array([1]), K, [0, 1, 2, 3]).action, 'CreateIdempotent', 'tag 1');
  const c = SPL_DECODERS[ATA](new Uint8Array([0]), K, [0, 1, 2, 3]);
  assertEq(c.details.owner, K[2], 'ATA owner = account 2');
  assertEq(c.details.mint, K[3], 'ATA mint = account 3');

  // RecoverNested has its own account order (SPL instruction.rs):
  // [nested ATA, nested mint, destination ATA, owner ATA, owner mint, wallet]
  const rn = SPL_DECODERS[ATA](new Uint8Array([2]), K, [0, 1, 2, 3, 1, 2]);
  assertEq(rn.action, 'RecoverNested', 'recover nested');
  assertEq(rn.details.nestedAccount, K[0], 'nested ATA = account 0');
  assertEq(rn.details.nestedMint, K[1], 'nested mint = account 1');
  assertEq(rn.details.destination, K[2], 'destination ATA = account 2');
  assertEq(rn.details.ownerAccount, K[3], 'owner ATA = account 3');
  assertEq(rn.details.ownerMint, K[1], 'owner mint = account 4');
  assertEq(rn.details.wallet, K[2], 'wallet = account 5');
  assertEq(rn.details.payer, undefined, 'no bogus payer field');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
