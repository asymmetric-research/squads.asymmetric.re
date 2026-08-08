/**
 * decode.js core tests — label resolution, severity plumbing, anchor hints,
 * throw-degradation. Run with: node test/decode-core.mjs
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

const storage = new Map();
globalThis.localStorage = {
  getItem: (k) => (storage.has(k) ? storage.get(k) : null),
  setItem: (k, v) => storage.set(k, String(v)),
  removeItem: (k) => storage.delete(k),
};

const { decodeInstruction, KNOWN_PROGRAMS } = await import('../src/decode.js');
const { setProgramLabel } = await import('../src/program-labels.js');

const LOADER = 'BPFLoaderUpgradeab1e11111111111111111111111';
const UNKNOWN_PROG = 'FakeProgram1111111111111111111111111111111';
const K = [
  'So11111111111111111111111111111111111111112',
  'nigmAPDCZMVDW4wneBBcc6wjY6Ufjv7iLJc2mRvs8PS',
  'nix9RErnQYXpuf329ntPgSzThogtfeyUempD7zDrnSH',
  '8Sr4rQJL2aQT3EL97mbrk1T9VMw4pCS2mxMPp2QBzHQq',
  'MarBmsSgKXdrN1egZf5sqe1TMThczhMLJhMpbeVbnoB',
  'BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY',
  'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
];

function u32le(n) {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, true);
  return b;
}

console.log('registry breadth:');
assert(KNOWN_PROGRAMS.size >= 24, `registry has >= 24 entries (${KNOWN_PROGRAMS.size})`);
assertEq(KNOWN_PROGRAMS.get(LOADER), 'BPF Upgradeable Loader', 'loader labeled');
assertEq(KNOWN_PROGRAMS.get('JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4'), 'Jupiter v6', 'squadit entries ported');
assertEq(KNOWN_PROGRAMS.get('Stake11111111111111111111111111111111111111'), 'Stake', 'stake labeled');

console.log('decoded upgrade end-to-end:');
{
  const r = decodeInstruction(LOADER, u32le(3), K, [0, 1, 2, 3, 4, 5, 6]);
  assertEq(r.type, 'decoded', 'decoded');
  assertEq(r.action, 'Upgrade', 'action');
  assertEq(r.severity, 'critical', 'severity surfaces');
  assertEq(r.program, 'BPF Upgradeable Loader', 'program label');
  assertEq(r.isKnown, true, 'known');
  assertEq(r.programId, LOADER, 'programId included');
}

console.log('unknown tag in known program -> Known:');
{
  const r = decodeInstruction(LOADER, u32le(99), K, [0]);
  assertEq(r.type, 'unknown', 'not decoded');
  assertEq(r.isKnown, true, 'still known program');
  assert(r.description.includes('99'), 'tag number surfaces');
}

console.log('throwing decoder degrades:');
{
  const r = decodeInstruction(LOADER, new Uint8Array([1]), K, [0]);
  assertEq(r.type, 'unknown', 'truncated data -> unknown');
  assertEq(r.isKnown, true, 'program still labeled');
}

console.log('anchor hint:');
{
  const data = new Uint8Array([0xa1, 0xb2, 0xc3, 0xd4, 0xe5, 0xf6, 0x07, 0x08, 1, 2, 3]);
  const r = decodeInstruction(UNKNOWN_PROG, data, K, [0]);
  assertEq(r.type, 'unknown', 'unknown program');
  assertEq(r.isKnown, false, 'not known');
  assertEq(r.anchorHint.discriminator, 'a1b2c3d4e5f60708', 'discriminator hex');
  assertEq(r.anchorHint.argBytes, 3, 'args byte count');
  assert(r.program.includes('…') || r.program.includes('...'), 'program shows shortened pubkey');

  const short = decodeInstruction(UNKNOWN_PROG, new Uint8Array([1, 2, 3, 4, 5, 6, 7]), K, [0]);
  assertEq(short.anchorHint, undefined, 'no hint under 8 bytes');
}

console.log('user label cosmetic only:');
{
  setProgramLabel(UNKNOWN_PROG, 'Acme Labs');
  const r = decodeInstruction(UNKNOWN_PROG, new Uint8Array(12), K, [0]);
  assertEq(r.program, 'Acme Labs', 'user label shown');
  assertEq(r.isKnown, false, 'user label does NOT set isKnown');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
