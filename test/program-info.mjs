/**
 * On-chain program inspection tests — mocked JSON-RPC.
 * Run with: node test/program-info.mjs
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

const { decodeBase58 } = await import('../src/squads.js');

const UPGRADEABLE_LOADER = 'BPFLoaderUpgradeab1e11111111111111111111111';
const LOADER_V2 = 'BPFLoader2111111111111111111111111111111111';
const PROG = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4';
const PROG_V2 = 'MarBmsSgKXdrN1egZf5sqe1TMThczhMLJhMpbeVbnoB';
const PROG_MISSING = 'BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY';
const PROGDATA = '8Sr4rQJL2aQT3EL97mbrk1T9VMw4pCS2mxMPp2QBzHQq';
const AUTHORITY = 'nigmAPDCZMVDW4wneBBcc6wjY6Ufjv7iLJc2mRvs8PS';
const WALLET = 'nix9RErnQYXpuf329ntPgSzThogtfeyUempD7zDrnSH';

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

// account fixtures — same vectors as squadit's bpf_loader.rs tests
const programAccountData = cat(u32le(2), decodeBase58(PROGDATA));
const programDataWithAuthority = cat(u32le(3), u64le(271828182), new Uint8Array([1]), decodeBase58(AUTHORITY));
const programDataFrozen = cat(u32le(3), u64le(42), new Uint8Array([0]));

let frozenMode = false;
let rpcCalls = 0;
const dataSliceByAddress = new Map();
const accounts = () => new Map([
  [PROG, { owner: UPGRADEABLE_LOADER, executable: true, data: programAccountData }],
  [PROGDATA, { owner: UPGRADEABLE_LOADER, executable: false, data: frozenMode ? programDataFrozen : programDataWithAuthority }],
  [PROG_V2, { owner: LOADER_V2, executable: true, data: new Uint8Array([1]) }],
  [WALLET, { owner: '11111111111111111111111111111111', executable: false, data: new Uint8Array(0) }],
]);

globalThis.fetch = async (url, opts = {}) => {
  rpcCalls++;
  const { method, params } = JSON.parse(opts.body);
  if (method !== 'getAccountInfo') throw new Error('unexpected method ' + method);
  const acc = accounts().get(params[0]);
  dataSliceByAddress.set(params[0], params[1]?.dataSlice ?? null);
  const slice = params[1]?.dataSlice;
  const data = acc && slice ? acc.data.slice(slice.offset, slice.offset + slice.length) : acc?.data;
  const value = acc
    ? { owner: acc.owner, executable: acc.executable, lamports: 1, data: [Buffer.from(data).toString('base64'), 'base64'] }
    : null;
  return { ok: true, text: async () => JSON.stringify({ jsonrpc: '2.0', id: 1, result: { value } }) };
};

const { decodeUpgradeableLoaderAccount, inspectProgram, _clearInspectCache } = await import('../src/program-info.js');

console.log('loader account decode (squadit fixtures):');
{
  assertEq(decodeUpgradeableLoaderAccount(programAccountData).tag, 'program', 'program tag');
  assertEq(decodeUpgradeableLoaderAccount(programAccountData).programData, PROGDATA, 'programdata address');
  const pd = decodeUpgradeableLoaderAccount(programDataWithAuthority);
  assertEq(pd.tag, 'programdata', 'programdata tag');
  assertEq(pd.slot, 271828182n, 'slot');
  assertEq(pd.upgradeAuthority, AUTHORITY, 'authority');
  const frozen = decodeUpgradeableLoaderAccount(programDataFrozen);
  assertEq(frozen.upgradeAuthority, null, 'frozen authority = null');
  assertEq(decodeUpgradeableLoaderAccount(cat(u32le(0))).tag, 'uninitialized', 'uninitialized');
  let threw = false;
  try { decodeUpgradeableLoaderAccount(new Uint8Array([1, 2])); } catch { threw = true; }
  assert(threw, 'short data throws');
}

console.log('inspectProgram:');
{
  const info = await inspectProgram('https://mock', PROG);
  assertEq(info.kind, 'upgradeable', 'upgradeable');
  assertEq(info.upgradeAuthority, AUTHORITY, 'authority surfaced');
  assertEq(info.slot, '271828182', 'slot surfaced as string');
  assertEq(info.programData, PROGDATA, 'programdata surfaced');
  const slice = dataSliceByAddress.get(PROGDATA);
  assert(slice && slice.offset === 0 && slice.length === 45, 'programdata fetched with 45-byte dataSlice, not in full');

  const before = rpcCalls;
  await inspectProgram('https://mock', PROG);
  assertEq(rpcCalls, before, 'second call served from cache');

  assertEq((await inspectProgram('https://mock', PROG_V2)).kind, 'loader-v2', 'loader v2');
  assertEq((await inspectProgram('https://mock', WALLET)).kind, 'not-program', 'non-executable = not a program');
  assertEq((await inspectProgram('https://mock', PROG_MISSING)).kind, 'not-found', 'missing account');
}

console.log('frozen program:');
{
  _clearInspectCache();
  frozenMode = true;
  const info = await inspectProgram('https://mock', PROG);
  assertEq(info.upgradeAuthority, null, 'frozen = null authority');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
