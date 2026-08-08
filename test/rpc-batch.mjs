/**
 * fetchMultisigBatch tests — mock the JSON-RPC endpoint via fetch.
 * Run with: node test/rpc-batch.mjs
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

const { decodeBase58, MULTISIG_DISCRIMINATOR } = await import('../src/squads.js');

const MEMBER = 'So11111111111111111111111111111111111111112';
const MS_GOOD = '8Sr4rQJL2aQT3EL97mbrk1T9VMw4pCS2mxMPp2QBzHQq';
const MS_MISSING = 'MarBmsSgKXdrN1egZf5sqe1TMThczhMLJhMpbeVbnoB';
const MS_GARBAGE = 'BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY';

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

const multisigData = concat([
  MULTISIG_DISCRIMINATOR,
  decodeBase58(MEMBER),         // create_key
  new Uint8Array(32),           // config_authority
  leBytes(2, 2),                // threshold
  leBytes(0, 4),                // time_lock
  leBytes(5, 8),                // transaction_index
  leBytes(0, 8),                // stale_transaction_index
  new Uint8Array([0]),          // rent_collector: None
  new Uint8Array([254]),        // bump
  leBytes(1, 4),                // members: len 1
  decodeBase58(MEMBER), new Uint8Array([7]),
]);

const accounts = new Map([
  [MS_GOOD, multisigData],
  [MS_GARBAGE, new Uint8Array(64)], // wrong discriminator
]);

let rpcCalls = 0;
globalThis.fetch = async (url, opts = {}) => {
  rpcCalls++;
  const { method, params } = JSON.parse(opts.body);
  if (method !== 'getMultipleAccounts') throw new Error('unexpected method ' + method);
  const value = params[0].map((addr) => {
    const data = accounts.get(addr);
    if (!data) return null;
    return { owner: 'x', lamports: 1, data: [Buffer.from(data).toString('base64'), 'base64'], executable: false };
  });
  return {
    ok: true,
    text: async () => JSON.stringify({ jsonrpc: '2.0', id: 1, result: { value } }),
  };
};

const { fetchMultisigBatch } = await import('../src/rpc.js');

console.log('fetchMultisigBatch:');
{
  const results = await fetchMultisigBatch('https://mock', [MS_GOOD, MS_MISSING, MS_GARBAGE]);
  assertEq(results.length, 3, 'one result per input address');
  assertEq(results[0].address, MS_GOOD, 'results keep input order');
  assert(results[0].multisig !== null, 'valid account deserializes');
  assertEq(results[0].multisig.threshold, 2, 'threshold parsed');
  assertEq(results[0].error, null, 'no error for valid account');
  assertEq(results[1].multisig, null, 'missing account yields null multisig');
  assert(results[1].error !== null, 'missing account yields an error string');
  assertEq(results[2].multisig, null, 'garbage account yields null multisig');
  assert(String(results[2].error).length > 0, 'garbage account yields an error string');

  const empty = await fetchMultisigBatch('https://mock', []);
  assertEq(empty.length, 0, 'empty input returns empty output');
  assertEq(rpcCalls, 1, 'empty input makes no RPC call');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
