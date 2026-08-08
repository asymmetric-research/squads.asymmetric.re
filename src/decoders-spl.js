/**
 * SPL Token / Token-2022 / Associated Token decoders.
 * Token and Token-2022 share instruction layouts (u8 tag), so one decoder is
 * registered for both program ids. Layouts from the SPL Token source
 * (spl_token::instruction::TokenInstruction::unpack); COption<Pubkey> in
 * instruction data is a 1-byte tag (0/1) + 32 bytes.
 */
import { BorshReader } from './squads.js';
import { formatTokenAmount, acct } from './decode-common.js';

const AUTHORITY_TYPES = ['mint tokens', 'freeze account', 'account owner', 'close account'];

function readCOptionPubkey(reader) {
  const tag = reader.readU8();
  if (tag === 0) return null;
  if (tag === 1) return reader.readPubkeyBase58();
  throw new Error(`invalid COption tag ${tag}`);
}

function decodeToken(data, accountKeys, accountIndexes) {
  if (data.length === 0) throw new Error('empty token instruction');
  const reader = new BorshReader(data);
  const tag = reader.readU8();
  const a = (i) => acct(accountKeys, accountIndexes, i);

  switch (tag) {
    case 1: // InitializeAccount — [account, mint, owner, rent]
      return {
        action: 'InitializeAccount',
        description: 'Initialize token account',
        details: { account: a(0), mint: a(1), owner: a(2) },
      };
    case 3: { // Transfer {amount} — [source, dest, authority]
      const amount = reader.readU64();
      return {
        action: 'Transfer',
        description: `Transfer ${amount} tokens (raw units)`,
        details: { amount: amount.toString(), source: a(0), destination: a(1), authority: a(2) },
      };
    }
    case 4: { // Approve {amount} — [source, delegate, owner]
      const amount = reader.readU64();
      return {
        action: 'Approve',
        severity: 'critical',
        description: `Approve delegate to spend ${amount} tokens (raw units)`,
        details: { amount: amount.toString(), source: a(0), delegate: a(1), owner: a(2) },
      };
    }
    case 5: // Revoke — [source, owner]
      return {
        action: 'Revoke',
        description: 'Revoke token delegate',
        details: { source: a(0), owner: a(1) },
      };
    case 6: { // SetAuthority {authority_type, COption<new>} — [account, current authority]
      const authorityType = reader.readU8();
      const newAuthority = readCOptionPubkey(reader);
      const typeName = AUTHORITY_TYPES[authorityType] || `type ${authorityType}`;
      return {
        action: 'SetAuthority',
        severity: 'critical',
        description: newAuthority
          ? `Change ${typeName} authority`
          : `Remove ${typeName} authority (irreversible)`,
        details: { account: a(0), authorityType: typeName, currentAuthority: a(1), newAuthority: newAuthority || 'none (removed)' },
      };
    }
    case 7: { // MintTo {amount} — [mint, dest, authority]
      const amount = reader.readU64();
      return {
        action: 'MintTo',
        description: `Mint ${amount} tokens (raw units)`,
        details: { amount: amount.toString(), mint: a(0), destination: a(1), authority: a(2) },
      };
    }
    case 8: { // Burn {amount} — [account, mint, authority]
      const amount = reader.readU64();
      return {
        action: 'Burn',
        description: `Burn ${amount} tokens (raw units)`,
        details: { amount: amount.toString(), account: a(0), mint: a(1), authority: a(2) },
      };
    }
    case 9: // CloseAccount — [account, destination, owner]
      return {
        action: 'CloseAccount',
        description: 'Close token account, rent to destination',
        details: { account: a(0), destination: a(1), owner: a(2) },
      };
    case 10: // FreezeAccount — [account, mint, authority]
      return {
        action: 'FreezeAccount',
        description: 'Freeze token account',
        details: { account: a(0), mint: a(1), authority: a(2) },
      };
    case 11: // ThawAccount — [account, mint, authority]
      return {
        action: 'ThawAccount',
        description: 'Thaw token account',
        details: { account: a(0), mint: a(1), authority: a(2) },
      };
    case 12: { // TransferChecked {amount, decimals} — [source, mint, dest, authority]
      const amount = reader.readU64();
      const decimals = reader.readU8();
      return {
        action: 'TransferChecked',
        description: `Transfer ${formatTokenAmount(amount, decimals)} tokens`,
        details: { amount: amount.toString(), decimals, amountFormatted: formatTokenAmount(amount, decimals), source: a(0), mint: a(1), destination: a(2), authority: a(3) },
      };
    }
    case 13: { // ApproveChecked {amount, decimals} — [source, mint, delegate, owner]
      const amount = reader.readU64();
      const decimals = reader.readU8();
      return {
        action: 'ApproveChecked',
        severity: 'critical',
        description: `Approve delegate to spend ${formatTokenAmount(amount, decimals)} tokens`,
        details: { amount: amount.toString(), decimals, source: a(0), mint: a(1), delegate: a(2), owner: a(3) },
      };
    }
    case 14: { // MintToChecked — [mint, dest, authority]
      const amount = reader.readU64();
      const decimals = reader.readU8();
      return {
        action: 'MintToChecked',
        description: `Mint ${formatTokenAmount(amount, decimals)} tokens`,
        details: { amount: amount.toString(), decimals, mint: a(0), destination: a(1), authority: a(2) },
      };
    }
    case 15: { // BurnChecked — [account, mint, authority]
      const amount = reader.readU64();
      const decimals = reader.readU8();
      return {
        action: 'BurnChecked',
        description: `Burn ${formatTokenAmount(amount, decimals)} tokens`,
        details: { amount: amount.toString(), decimals, account: a(0), mint: a(1), authority: a(2) },
      };
    }
    case 16: { // InitializeAccount2 {owner} — [account, mint, rent]
      const owner = reader.readPubkeyBase58();
      return {
        action: 'InitializeAccount2',
        description: 'Initialize token account',
        details: { account: a(0), mint: a(1), owner },
      };
    }
    case 17: // SyncNative — [account]
      return {
        action: 'SyncNative',
        description: 'Sync wrapped SOL balance',
        details: { account: a(0) },
      };
    case 18: { // InitializeAccount3 {owner} — [account, mint]
      const owner = reader.readPubkeyBase58();
      return {
        action: 'InitializeAccount3',
        description: 'Initialize token account',
        details: { account: a(0), mint: a(1), owner },
      };
    }
    case 22: // InitializeImmutableOwner — [account]
      return {
        action: 'InitializeImmutableOwner',
        description: 'Mark account owner immutable',
        details: { account: a(0) },
      };
    case 0: { // InitializeMint {decimals, mint_authority, COption freeze_authority} — [mint, rent]
      const decimals = reader.readU8();
      const mintAuthority = reader.readPubkeyBase58();
      const freezeAuthority = readCOptionPubkey(reader);
      return {
        action: 'InitializeMint',
        description: `Initialize mint with ${decimals} decimals`,
        details: { mint: a(0), decimals, mintAuthority, freezeAuthority: freezeAuthority || 'none' },
      };
    }
    default:
      return {
        action: 'Unknown token instruction',
        description: `Unrecognized token instruction (tag ${tag})`,
        undecoded: true,
      };
  }
}

// ATA program. Create/CreateIdempotent accounts: [payer, ata, owner, mint,
// system, token program]. RecoverNested has its own order: [nested ATA,
// nested mint, destination (wallet's ATA), owner ATA, owner mint, wallet].
function decodeAta(data, accountKeys, accountIndexes) {
  const a = (i) => acct(accountKeys, accountIndexes, i);
  const tag = data.length === 0 ? 0 : data[0];
  const createDetails = { payer: a(0), account: a(1), owner: a(2), mint: a(3) };
  switch (tag) {
    case 0:
      return { action: 'Create', description: 'Create associated token account', details: createDetails };
    case 1:
      return { action: 'CreateIdempotent', description: 'Create associated token account (idempotent)', details: createDetails };
    case 2:
      return {
        action: 'RecoverNested',
        description: 'Recover nested associated token account',
        details: { nestedAccount: a(0), nestedMint: a(1), destination: a(2), ownerAccount: a(3), ownerMint: a(4), wallet: a(5) },
      };
    default:
      return {
        action: 'Unknown ATA instruction',
        description: `Unrecognized associated-token instruction (tag ${tag})`,
        undecoded: true,
      };
  }
}

export const SPL_DECODERS = {
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA': decodeToken,
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb': decodeToken,
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL': decodeAta,
};
