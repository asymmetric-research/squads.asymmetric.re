/**
 * Solana transaction serialization — zero dependencies.
 * Implements the v0 versioned transaction wire format.
 */

/**
 * Encode a value as Solana compact-u16 (variable length, 1-3 bytes).
 */
export function encodeCompactU16(value) {
  const buf = [];
  while (true) {
    let byte = value & 0x7f;
    value >>= 7;
    if (value !== 0) byte |= 0x80;
    buf.push(byte);
    if (value === 0) break;
  }
  return Uint8Array.from(buf);
}

/**
 * Concatenate multiple Uint8Arrays.
 */
export function concat(...arrays) {
  let totalLen = 0;
  for (const a of arrays) totalLen += a.length;
  const result = new Uint8Array(totalLen);
  let offset = 0;
  for (const a of arrays) {
    result.set(a, offset);
    offset += a.length;
  }
  return result;
}

/**
 * Account roles (matches the ordering in message header).
 */
export const AccountRole = {
  WRITABLE_SIGNER: 0,
  READONLY_SIGNER: 1,
  WRITABLE: 2,
  READONLY: 3,
};

/**
 * Build and serialize a v0 transaction message.
 *
 * @param {Object} params
 * @param {Uint8Array} params.feePayer - 32-byte fee payer pubkey
 * @param {Uint8Array} params.recentBlockhash - 32-byte blockhash
 * @param {Array} params.instructions - Array of { programId: Uint8Array(32), accounts: [{pubkey, role}], data: Uint8Array }
 * @returns {Uint8Array} Serialized message bytes
 */
export function serializeTransactionMessage({ feePayer, recentBlockhash, instructions }) {
  // 1. Collect all unique accounts and classify them
  const accountMap = new Map(); // base58 -> { pubkey, isSigner, isWritable }

  function ensureAccount(pubkey, isSigner = false, isWritable = false) {
    const key = pubkeyToHex(pubkey);
    const existing = accountMap.get(key);
    if (existing) {
      existing.isSigner = existing.isSigner || isSigner;
      existing.isWritable = existing.isWritable || isWritable;
    } else {
      accountMap.set(key, { pubkey: new Uint8Array(pubkey), isSigner, isWritable });
    }
  }

  // Fee payer is always writable signer at index 0
  ensureAccount(feePayer, true, true);

  for (const ix of instructions) {
    ensureAccount(ix.programId, false, false);
    for (const acc of ix.accounts) {
      const isSigner = acc.role === AccountRole.WRITABLE_SIGNER || acc.role === AccountRole.READONLY_SIGNER;
      const isWritable = acc.role === AccountRole.WRITABLE_SIGNER || acc.role === AccountRole.WRITABLE;
      ensureAccount(acc.pubkey, isSigner, isWritable);
    }
  }

  // 2. Sort accounts: writable signers, readonly signers, writable non-signers, readonly non-signers
  const accounts = [...accountMap.values()];
  accounts.sort((a, b) => {
    const aOrder = (a.isSigner ? 0 : 2) + (a.isWritable ? 0 : 1);
    const bOrder = (b.isSigner ? 0 : 2) + (b.isWritable ? 0 : 1);
    if (aOrder !== bOrder) return aOrder - bOrder;
    return comparePubkeys(a.pubkey, b.pubkey);
  });

  // Ensure fee payer is at index 0
  const feePayerHex = pubkeyToHex(feePayer);
  const feePayerIdx = accounts.findIndex(a => pubkeyToHex(a.pubkey) === feePayerHex);
  if (feePayerIdx > 0) {
    const [fp] = accounts.splice(feePayerIdx, 1);
    accounts.unshift(fp);
  }

  // 3. Build account index lookup
  const indexMap = new Map();
  accounts.forEach((acc, i) => indexMap.set(pubkeyToHex(acc.pubkey), i));

  // 4. Compute header counts
  let numRequiredSignatures = 0;
  let numReadonlySignedAccounts = 0;
  let numReadonlyUnsignedAccounts = 0;

  for (const acc of accounts) {
    if (acc.isSigner) {
      numRequiredSignatures++;
      if (!acc.isWritable) numReadonlySignedAccounts++;
    } else {
      if (!acc.isWritable) numReadonlyUnsignedAccounts++;
    }
  }

  // 5. Serialize message
  // V0 prefix
  const prefix = Uint8Array.from([0x80]); // version 0

  // Header (3 bytes, plain u8s)
  const header = Uint8Array.from([
    numRequiredSignatures,
    numReadonlySignedAccounts,
    numReadonlyUnsignedAccounts,
  ]);

  // Account keys
  const accountKeysLen = encodeCompactU16(accounts.length);
  const accountKeysData = concat(...accounts.map(a => a.pubkey));

  // Recent blockhash (32 bytes)
  const blockhashBytes = new Uint8Array(recentBlockhash);

  // Instructions
  const ixLen = encodeCompactU16(instructions.length);
  const ixData = concat(...instructions.map(ix => {
    const programIdIndex = indexMap.get(pubkeyToHex(ix.programId));
    const accountIndices = ix.accounts.map(acc => indexMap.get(pubkeyToHex(acc.pubkey)));
    return concat(
      Uint8Array.from([programIdIndex]),
      encodeCompactU16(accountIndices.length),
      Uint8Array.from(accountIndices),
      encodeCompactU16(ix.data.length),
      ix.data,
    );
  }));

  // Address table lookups (none for our use case)
  const lookupLen = encodeCompactU16(0);

  return concat(prefix, header, accountKeysLen, accountKeysData, blockhashBytes, ixLen, ixData, lookupLen);
}

/**
 * Wrap a message into a full unsigned transaction (with zeroed signature slots).
 */
export function buildUnsignedTransaction(messageBytes, numSignatures) {
  const sigCount = encodeCompactU16(numSignatures);
  const sigSlots = new Uint8Array(64 * numSignatures); // zeroed
  return concat(sigCount, sigSlots, messageBytes);
}

function pubkeyToHex(pubkey) {
  return Array.from(pubkey).map(b => b.toString(16).padStart(2, '0')).join('');
}

function comparePubkeys(a, b) {
  for (let i = 0; i < 32; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}
