/**
 * Instruction decoders — Map-based registry.
 * Decodes SPL Token and System Program instructions into human-readable form.
 * Everything else falls back to raw hex display.
 */
import { toHex, encodeBase58 } from './squads.js';

const decoders = new Map();

// BigInt-safe token amount formatting (no precision loss for amounts > 2^53)
function formatTokenAmount(amount, decimals) {
  const str = amount.toString();
  if (decimals === 0) return str;
  if (str.length <= decimals) return '0.' + str.padStart(decimals, '0');
  return str.slice(0, str.length - decimals) + '.' + str.slice(str.length - decimals);
}

export const KNOWN_PROGRAMS = new Map([
  ['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', 'SPL Token'],
  ['TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb', 'Token-2022'],
  ['11111111111111111111111111111111', 'System Program'],
  ['ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL', 'Associated Token'],
  ['ComputeBudget111111111111111111111111111111', 'Compute Budget'],
  ['SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf', 'Squads v4'],
]);

export function registerDecoder(programId, decodeFn) {
  decoders.set(programId, decodeFn);
}

/**
 * Decode an instruction. Returns { type, program, decoded?, rawHex }.
 */
export function decodeInstruction(programId, data, accountKeys, accountIndexes) {
  const programName = KNOWN_PROGRAMS.get(programId);
  const decoder = decoders.get(programId);

  if (decoder) {
    try {
      const decoded = decoder(data, accountKeys, accountIndexes);
      return { type: 'decoded', program: programName || programId, ...decoded, rawHex: toHex(data) };
    } catch {
      // Fall through to unknown
    }
  }

  return {
    type: 'unknown',
    program: programName || programId,
    isKnown: !!programName,
    rawHex: toHex(data),
  };
}

// ─── SPL Token Program Decoder ───

const TOKEN_TRANSFER = 3;
const TOKEN_TRANSFER_CHECKED = 12;

function decodeTokenInstruction(data, accountKeys, accountIndexes) {
  if (data.length === 0) throw new Error('Empty instruction data');

  const type = data[0];

  switch (type) {
    case TOKEN_TRANSFER: {
      // Transfer: [1 byte type][8 bytes amount LE]
      if (data.length < 9) throw new Error('Token Transfer data too short');
      const view = new DataView(data.buffer, data.byteOffset);
      const amount = view.getBigUint64(1, true);
      const source = accountIndexes[0] !== undefined ? accountKeys[accountIndexes[0]] : '?';
      const dest = accountIndexes[1] !== undefined ? accountKeys[accountIndexes[1]] : '?';
      const authority = accountIndexes[2] !== undefined ? accountKeys[accountIndexes[2]] : '?';
      return {
        action: 'Transfer',
        description: `Transfer ${amount.toString()} tokens`,
        details: { amount: amount.toString(), source, destination: dest, authority },
      };
    }

    case TOKEN_TRANSFER_CHECKED: {
      // TransferChecked: [1 byte type][8 bytes amount LE][1 byte decimals]
      if (data.length < 10) throw new Error('Token TransferChecked data too short');
      const view = new DataView(data.buffer, data.byteOffset);
      const amount = view.getBigUint64(1, true);
      const decimals = data[9];
      const source = accountIndexes[0] !== undefined ? accountKeys[accountIndexes[0]] : '?';
      const mint = accountIndexes[1] !== undefined ? accountKeys[accountIndexes[1]] : '?';
      const dest = accountIndexes[2] !== undefined ? accountKeys[accountIndexes[2]] : '?';
      // Format with BigInt to avoid precision loss for amounts > 2^53
      const amountStr = formatTokenAmount(amount, decimals);
      return {
        action: 'Transfer checked',
        description: `Transfer ${amountStr} tokens`,
        details: { amount: amount.toString(), decimals, amountFormatted: amountStr, source, mint, destination: dest },
      };
    }

    default:
      throw new Error(`Unknown Token instruction type: ${type}`);
  }
}

registerDecoder('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', decodeTokenInstruction);

// ─── System Program Decoder ───

const SYSTEM_TRANSFER = 2;
const SYSTEM_CREATE_ACCOUNT = 0;

function decodeSystemInstruction(data, accountKeys, accountIndexes) {
  if (data.length < 4) throw new Error('System instruction data too short');

  const view = new DataView(data.buffer, data.byteOffset);
  const type = view.getUint32(0, true);

  switch (type) {
    case SYSTEM_CREATE_ACCOUNT: {
      // CreateAccount: [4B type][8B lamports][8B space][32B owner]
      if (data.length < 52) throw new Error('CreateAccount data too short');
      const lamports = view.getBigUint64(4, true);
      const space = view.getBigUint64(12, true);
      const owner = accountKeys[accountIndexes[0]] || '?';
      const solAmount = Number(lamports) / 1e9;
      return {
        action: 'Create account',
        description: `Create account with ${solAmount.toFixed(4)} SOL`,
        details: { lamports: lamports.toString(), space: space.toString(), owner },
      };
    }

    case SYSTEM_TRANSFER: {
      // Transfer: [4B type][8B lamports]
      if (data.length < 12) throw new Error('System Transfer data too short');
      const lamports = view.getBigUint64(4, true);
      const from = accountIndexes[0] !== undefined ? accountKeys[accountIndexes[0]] : '?';
      const to = accountIndexes[1] !== undefined ? accountKeys[accountIndexes[1]] : '?';
      const solAmount = Number(lamports) / 1e9;
      return {
        action: 'Transfer',
        description: `Transfer ${solAmount.toFixed(4)} SOL`,
        details: { lamports: lamports.toString(), solAmount, from, to },
      };
    }

    default:
      throw new Error(`Unknown System instruction type: ${type}`);
  }
}

registerDecoder('11111111111111111111111111111111', decodeSystemInstruction);
