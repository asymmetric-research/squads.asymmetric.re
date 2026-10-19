/**
 * Native program decoders — System, BPF Upgradeable Loader, Stake,
 * Compute Budget, Address Lookup Table.
 *
 * System/Loader/Stake/ALT are bincode-serialized: u32 LE enum tag; String and
 * Vec lengths are u64 LE. Compute Budget is Borsh with a u8 tag. Layouts from
 * the Agave source (*_instruction.rs) — account orders documented per case.
 */
import { BorshReader } from './squads.js';
import { acct, formatSolAmount } from './decode-common.js';

function readBincodeString(reader, maxLen = 256) {
  const len = Number(reader.readU64());
  if (len > maxLen) throw new Error(`bincode string length ${len} exceeds max ${maxLen}`);
  return new TextDecoder().decode(reader.readBytes(len));
}

// ─── System Program ───

function decodeSystem(data, accountKeys, accountIndexes) {
  const reader = new BorshReader(data);
  const tag = reader.readU32();
  const a = (i) => acct(accountKeys, accountIndexes, i);

  switch (tag) {
    case 0: { // CreateAccount {lamports, space, owner} — [funder, new account]
      const lamports = reader.readU64();
      const space = reader.readU64();
      const owner = reader.readPubkeyBase58();
      return {
        action: 'CreateAccount',
        description: `Create account with ${formatSolAmount(lamports)}`,
        details: { funder: a(0), newAccount: a(1), lamports: lamports.toString(), space: space.toString(), owner },
      };
    }
    case 1: { // Assign {owner} — [account]
      const owner = reader.readPubkeyBase58();
      return {
        action: 'Assign',
        severity: 'critical',
        description: 'Assign account to a new owner program',
        details: { account: a(0), newOwner: owner },
      };
    }
    case 2: { // Transfer {lamports} — [from, to]
      const lamports = reader.readU64();
      return {
        action: 'Transfer',
        description: `Transfer ${formatSolAmount(lamports)}`,
        details: { from: a(0), to: a(1), lamports: lamports.toString() },
      };
    }
    case 3: { // CreateAccountWithSeed {base, seed, lamports, space, owner} — [funder, created(, base)]
      const base = reader.readPubkeyBase58();
      const seed = readBincodeString(reader);
      const lamports = reader.readU64();
      const space = reader.readU64();
      const owner = reader.readPubkeyBase58();
      return {
        action: 'CreateAccountWithSeed',
        description: `Create seeded account with ${formatSolAmount(lamports)}`,
        details: { funder: a(0), newAccount: a(1), base, seed, lamports: lamports.toString(), space: space.toString(), owner },
      };
    }
    case 4: // AdvanceNonceAccount — [nonce, recent_blockhashes, authority]
      return {
        action: 'AdvanceNonceAccount',
        description: 'Advance durable nonce',
        details: { nonce: a(0), authority: a(2) },
      };
    case 5: { // WithdrawNonceAccount {lamports} — [nonce, to, recent_blockhashes, rent, authority]
      const lamports = reader.readU64();
      return {
        action: 'WithdrawNonceAccount',
        description: `Withdraw ${formatSolAmount(lamports)} from nonce account`,
        details: { nonce: a(0), to: a(1), authority: a(4), lamports: lamports.toString() },
      };
    }
    case 6: { // InitializeNonceAccount {authority} — [nonce, recent_blockhashes, rent]
      const authority = reader.readPubkeyBase58();
      return {
        action: 'InitializeNonceAccount',
        description: 'Initialize durable nonce account',
        details: { nonce: a(0), authority },
      };
    }
    case 7: { // AuthorizeNonceAccount {new_authority} — [nonce, current authority]
      const newAuthority = reader.readPubkeyBase58();
      return {
        action: 'AuthorizeNonceAccount',
        severity: 'critical',
        description: 'Change nonce account authority',
        details: { nonce: a(0), currentAuthority: a(1), newAuthority },
      };
    }
    case 8: { // Allocate {space} — [account]
      const space = reader.readU64();
      return {
        action: 'Allocate',
        description: `Allocate ${space} bytes`,
        details: { account: a(0), space: space.toString() },
      };
    }
    case 9: { // AllocateWithSeed {base, seed, space, owner} — [account(, base)]
      const base = reader.readPubkeyBase58();
      const seed = readBincodeString(reader);
      const space = reader.readU64();
      const owner = reader.readPubkeyBase58();
      return {
        action: 'AllocateWithSeed',
        description: `Allocate ${space} bytes (seeded)`,
        details: { account: a(0), base, seed, space: space.toString(), owner },
      };
    }
    case 10: { // AssignWithSeed {base, seed, owner} — [account(, base)]
      const base = reader.readPubkeyBase58();
      const seed = readBincodeString(reader);
      const owner = reader.readPubkeyBase58();
      return {
        action: 'AssignWithSeed',
        severity: 'critical',
        description: 'Assign seeded account to a new owner program',
        details: { account: a(0), base, seed, newOwner: owner },
      };
    }
    case 11: { // TransferWithSeed {lamports, from_seed, from_owner} — [from, base, to]
      const lamports = reader.readU64();
      const fromSeed = readBincodeString(reader);
      const fromOwner = reader.readPubkeyBase58();
      return {
        action: 'TransferWithSeed',
        description: `Transfer ${formatSolAmount(lamports)} (seeded)`,
        details: { from: a(0), base: a(1), to: a(2), seed: fromSeed, fromOwner, lamports: lamports.toString() },
      };
    }
    case 12: // UpgradeNonceAccount — [nonce]
      return {
        action: 'UpgradeNonceAccount',
        description: 'Upgrade legacy nonce account',
        details: { nonce: a(0) },
      };
    default:
      return {
        action: 'Unknown system instruction',
        description: `Unrecognized System instruction (tag ${tag})`,
        undecoded: true,
      };
  }
}

// ─── BPF Upgradeable Loader ───

function decodeLoader(data, accountKeys, accountIndexes) {
  const reader = new BorshReader(data);
  const tag = reader.readU32();
  const a = (i) => acct(accountKeys, accountIndexes, i);

  switch (tag) {
    case 0: // InitializeBuffer — [buffer, authority]
      return {
        action: 'InitializeBuffer',
        description: 'Initialize program buffer',
        details: { buffer: a(0), authority: a(1) },
      };
    case 1: { // Write {offset u32, bytes Vec<u8> (u64 len)} — [buffer, authority]
      const offset = reader.readU32();
      const len = Number(reader.readU64());
      return {
        action: 'Write',
        description: `Write ${len} bytes at offset ${offset} to buffer`,
        details: { buffer: a(0), authority: a(1), offset, bytes: len },
      };
    }
    case 2: { // DeployWithMaxDataLen {max_data_len u64} — [payer, programdata, program, buffer, ...]
      const maxDataLen = reader.readU64();
      return {
        action: 'DeployWithMaxDataLen',
        description: 'Deploy program from buffer',
        details: { payer: a(0), programData: a(1), program: a(2), buffer: a(3), maxDataLen: maxDataLen.toString() },
      };
    }
    case 3: // Upgrade — [programdata, program, buffer, spill, rent, clock, authority]
      return {
        action: 'Upgrade',
        severity: 'critical',
        description: 'Upgrade program with new code from buffer',
        details: { programData: a(0), program: a(1), buffer: a(2), spill: a(3), authority: a(6) },
      };
    case 4: // SetAuthority — [account, current authority, (new authority)]
      return {
        action: 'SetAuthority',
        severity: 'critical',
        description: accountIndexes.length > 2
          ? 'Change program/buffer upgrade authority'
          : 'Remove upgrade authority (program becomes immutable)',
        details: {
          account: a(0),
          currentAuthority: a(1),
          newAuthority: accountIndexes.length > 2 ? a(2) : 'none (authority removed)',
        },
      };
    case 5: // Close — [account, recipient, authority, (program)]
      return {
        action: 'Close',
        severity: 'critical',
        description: 'Close loader account, lamports to recipient',
        details: { account: a(0), recipient: a(1), authority: a(2) },
      };
    case 6: { // ExtendProgram {additional_bytes u32} — [programdata, program, ...]
      const additional = reader.readU32();
      return {
        action: 'ExtendProgram',
        description: `Extend program data by ${additional} bytes`,
        details: { programData: a(0), program: a(1), additionalBytes: additional },
      };
    }
    case 7: // SetAuthorityChecked — [account, current authority, new authority (signer)]
      return {
        action: 'SetAuthorityChecked',
        severity: 'critical',
        description: 'Change upgrade authority (new authority must co-sign)',
        details: { account: a(0), currentAuthority: a(1), newAuthority: a(2) },
      };
    default:
      return {
        action: 'Unknown loader instruction',
        description: `Unrecognized BPF loader instruction (tag ${tag})`,
        undecoded: true,
      };
  }
}

// ─── Stake Program ───

function decodeStake(data, accountKeys, accountIndexes) {
  const reader = new BorshReader(data);
  const tag = reader.readU32();
  const a = (i) => acct(accountKeys, accountIndexes, i);

  switch (tag) {
    case 0: { // Initialize {authorized{staker,withdrawer}, lockup{ts,epoch,custodian}} — [stake, rent]
      const staker = reader.readPubkeyBase58();
      const withdrawer = reader.readPubkeyBase58();
      return {
        action: 'Initialize',
        description: 'Initialize stake account',
        details: { stake: a(0), staker, withdrawer },
      };
    }
    case 1: { // Authorize {new_authorized, stake_authorize u32} — [stake, clock, authority]
      const newAuthority = reader.readPubkeyBase58();
      const kindTag = reader.readU32();
      const kind = kindTag === 0 ? 'staker' : kindTag === 1 ? 'withdrawer' : `authority (unknown kind ${kindTag})`;
      return {
        action: 'Authorize',
        severity: 'critical',
        description: `Change stake ${kind} authority`,
        details: { stake: a(0), authorityKind: kind, currentAuthority: a(2), newAuthority },
      };
    }
    case 2: // DelegateStake — [stake, vote, clock, stake_history, config, authority]
      return {
        action: 'DelegateStake',
        description: 'Delegate stake to validator',
        details: { stake: a(0), voteAccount: a(1), authority: a(5) },
      };
    case 3: { // Split {lamports} — [stake, split destination, authority]
      const lamports = reader.readU64();
      return {
        action: 'Split',
        description: `Split ${formatSolAmount(lamports)} into new stake account`,
        details: { stake: a(0), newStake: a(1), authority: a(2), lamports: lamports.toString() },
      };
    }
    case 4: { // Withdraw {lamports} — [stake, to, clock, stake_history, withdraw authority]
      const lamports = reader.readU64();
      return {
        action: 'Withdraw',
        description: `Withdraw ${formatSolAmount(lamports)} from stake account`,
        details: { stake: a(0), to: a(1), authority: a(4), lamports: lamports.toString() },
      };
    }
    case 5: // Deactivate — [stake, clock, authority]
      return {
        action: 'Deactivate',
        description: 'Deactivate stake delegation',
        details: { stake: a(0), authority: a(2) },
      };
    case 6: // SetLockup {LockupArgs: Option fields} — [stake, lockup/withdraw authority]
      return {
        action: 'SetLockup',
        severity: 'critical',
        description: 'Change stake lockup (expiry and/or custodian)',
        details: { stake: a(0), authority: a(1) },
      };
    case 7: // Merge — [dest stake, source stake, clock, stake_history, authority]
      return {
        action: 'Merge',
        description: 'Merge source stake account into destination',
        details: { destinationStake: a(0), sourceStake: a(1), authority: a(4) },
      };
    case 8: { // AuthorizeWithSeed {new_authorized, stake_authorize u32, seed, owner} — [stake, authority base, clock, (custodian)]
      const newAuthority = reader.readPubkeyBase58();
      const kindTag = reader.readU32();
      const kind = kindTag === 0 ? 'staker' : kindTag === 1 ? 'withdrawer' : `authority (unknown kind ${kindTag})`;
      return {
        action: 'AuthorizeWithSeed',
        severity: 'critical',
        description: `Change stake ${kind} authority (seeded current authority)`,
        details: { stake: a(0), authorityKind: kind, authorityBase: a(1), newAuthority },
      };
    }
    case 9: // InitializeChecked — [stake, rent, staker, withdrawer (signer)]
      return {
        action: 'InitializeChecked',
        description: 'Initialize stake account (withdrawer co-signs)',
        details: { stake: a(0), staker: a(2), withdrawer: a(3) },
      };
    case 10: { // AuthorizeChecked {stake_authorize u32} — [stake, clock, current authority, new authority (signer), (custodian)]
      const kindTag = reader.readU32();
      const kind = kindTag === 0 ? 'staker' : kindTag === 1 ? 'withdrawer' : `authority (unknown kind ${kindTag})`;
      return {
        action: 'AuthorizeChecked',
        severity: 'critical',
        description: `Change stake ${kind} authority (new authority must co-sign)`,
        details: { stake: a(0), authorityKind: kind, currentAuthority: a(2), newAuthority: a(3) },
      };
    }
    case 11: { // AuthorizeCheckedWithSeed {stake_authorize u32, seed, owner} — [stake, authority base, clock, new authority (signer), (custodian)]
      const kindTag = reader.readU32();
      const kind = kindTag === 0 ? 'staker' : kindTag === 1 ? 'withdrawer' : `authority (unknown kind ${kindTag})`;
      return {
        action: 'AuthorizeCheckedWithSeed',
        severity: 'critical',
        description: `Change stake ${kind} authority (seeded current authority, new authority must co-sign)`,
        details: { stake: a(0), authorityKind: kind, authorityBase: a(1), newAuthority: a(3) },
      };
    }
    case 12: // SetLockupChecked {Option fields} — [stake, authority, (new custodian signer)]
      return {
        action: 'SetLockupChecked',
        severity: 'critical',
        description: 'Change stake lockup (new custodian co-signs if changing)',
        details: { stake: a(0), authority: a(1) },
      };
    default:
      return {
        action: 'Unknown stake instruction',
        description: `Unrecognized Stake instruction (tag ${tag})`,
        undecoded: true,
      };
  }
}

// ─── Compute Budget (Borsh, u8 tag) ───

function decodeComputeBudget(data) {
  const reader = new BorshReader(data);
  const tag = reader.readU8();

  switch (tag) {
    case 1: {
      const bytes = reader.readU32();
      return { action: 'RequestHeapFrame', description: `Request ${bytes}-byte heap frame`, details: { bytes } };
    }
    case 2: {
      const units = reader.readU32();
      return { action: 'SetComputeUnitLimit', description: `Set compute unit limit to ${units}`, details: { units } };
    }
    case 3: {
      const microLamports = reader.readU64();
      return {
        action: 'SetComputeUnitPrice',
        description: `Set priority fee to ${microLamports} micro-lamports/CU`,
        details: { microLamports: microLamports.toString() },
      };
    }
    case 4: {
      const bytes = reader.readU32();
      return { action: 'SetLoadedAccountsDataSizeLimit', description: `Limit loaded accounts data to ${bytes} bytes`, details: { bytes } };
    }
    default:
      return {
        action: 'Unknown compute budget instruction',
        description: `Unrecognized Compute Budget instruction (tag ${tag})`,
        undecoded: true,
      };
  }
}

// ─── Address Lookup Table ───

function decodeAlt(data, accountKeys, accountIndexes) {
  const reader = new BorshReader(data);
  const tag = reader.readU32();
  const a = (i) => acct(accountKeys, accountIndexes, i);

  switch (tag) {
    case 0: { // CreateLookupTable {recent_slot u64, bump u8} — [table, authority, payer, system]
      const recentSlot = reader.readU64();
      return {
        action: 'CreateLookupTable',
        description: 'Create address lookup table',
        details: { table: a(0), authority: a(1), payer: a(2), recentSlot: recentSlot.toString() },
      };
    }
    case 1: // FreezeLookupTable — [table, authority]
      return {
        action: 'FreezeLookupTable',
        description: 'Freeze lookup table (permanent)',
        details: { table: a(0), authority: a(1) },
      };
    case 2: { // ExtendLookupTable {new_addresses Vec<Pubkey> (u64 len)} — [table, authority(, payer, system)]
      const count = Number(reader.readU64());
      if (count > 256) throw new Error(`ALT extend count ${count} exceeds max 256`);
      const preview = [];
      for (let i = 0; i < Math.min(count, 4); i++) preview.push(reader.readPubkeyBase58());
      return {
        action: 'ExtendLookupTable',
        description: `Append ${count} address${count === 1 ? '' : 'es'} to lookup table`,
        details: { table: a(0), authority: a(1), count, firstAddresses: preview.join(', ') },
      };
    }
    case 3: // DeactivateLookupTable — [table, authority]
      return {
        action: 'DeactivateLookupTable',
        description: 'Deactivate lookup table',
        details: { table: a(0), authority: a(1) },
      };
    case 4: // CloseLookupTable — [table, authority, recipient]
      return {
        action: 'CloseLookupTable',
        description: 'Close lookup table, rent to recipient',
        details: { table: a(0), authority: a(1), recipient: a(2) },
      };
    default:
      return {
        action: 'Unknown lookup table instruction',
        description: `Unrecognized Address Lookup Table instruction (tag ${tag})`,
        undecoded: true,
      };
  }
}

export const NATIVE_DECODERS = {
  '11111111111111111111111111111111': decodeSystem,
  'BPFLoaderUpgradeab1e11111111111111111111111': decodeLoader,
  'Stake11111111111111111111111111111111111111': decodeStake,
  'ComputeBudget111111111111111111111111111111': decodeComputeBudget,
  'AddressLookupTab1e1111111111111111111111111': decodeAlt,
};
