/**
 * Program label store tests. Run with: node test/program-labels.mjs
 */
let passed = 0;
let failed = 0;

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
let quotaExceeded = false;
globalThis.localStorage = {
  getItem: (k) => (storage.has(k) ? storage.get(k) : null),
  setItem: (k, v) => {
    if (quotaExceeded) throw new Error('QuotaExceededError');
    storage.set(k, String(v));
  },
  removeItem: (k) => storage.delete(k),
};

const { getProgramLabel, setProgramLabel, reloadProgramLabels } = await import('../src/program-labels.js');

const PROG_A = 'FakeProgram1111111111111111111111111111111';
const PROG_B = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4';

console.log('program labels:');
assertEq(getProgramLabel(PROG_A), null, 'unset label is null');

setProgramLabel(PROG_A, 'Acme Labs');
assertEq(getProgramLabel(PROG_A), 'Acme Labs', 'label round-trips');
assertEq(getProgramLabel(PROG_B), null, 'other program unaffected');

setProgramLabel(PROG_A, 'x'.repeat(100));
assertEq(getProgramLabel(PROG_A).length, 32, 'label capped at 32 chars');

setProgramLabel(PROG_A, '   ');
assertEq(getProgramLabel(PROG_A), null, 'whitespace label deletes entry');

reloadPersistCheck();
function reloadPersistCheck() {
  setProgramLabel(PROG_B, 'Jupiter mine');
  reloadProgramLabels();
  assertEq(getProgramLabel(PROG_B), 'Jupiter mine', 'labels survive cache reload');
}

console.log('corrupt data:');
storage.set('programLabels', 'not json{{{');
reloadProgramLabels();
assertEq(getProgramLabel(PROG_B), null, 'corrupt JSON treated as empty');

storage.set('programLabels', JSON.stringify([1, 2]));
reloadProgramLabels();
assertEq(getProgramLabel(PROG_B), null, 'array at top level treated as empty');

storage.set('programLabels', JSON.stringify({ [PROG_B]: 42 }));
reloadProgramLabels();
assertEq(getProgramLabel(PROG_B), null, 'non-string label dropped');

console.log('quota:');
storage.delete('programLabels');
reloadProgramLabels();
quotaExceeded = true;
const { persisted } = setProgramLabel(PROG_A, 'Session only');
assertEq(persisted, false, 'reports persistence failure');
assertEq(getProgramLabel(PROG_A), 'Session only', 'label retained in memory');
quotaExceeded = false;

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
