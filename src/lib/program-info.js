/**
 * On-demand on-chain program inspection. For a program id, fetches the
 * program account, decodes the BPF Upgradeable Loader state (port of
 * squadit's bpf_loader.rs), follows to programdata, and reports
 * upgradeability + upgrade authority + last-deploy slot.
 *
 * Successful results are session-cached; RPC failures are not (retry works).
 */
import { rpcCall, base64ToUint8Array } from './rpc.js';
import { BorshReader } from './squads.js';

const UPGRADEABLE_LOADER_ID = 'BPFLoaderUpgradeab1e11111111111111111111111';
const LOADER_V2_ID = 'BPFLoader2111111111111111111111111111111111';

const cache = new Map();

export function _clearInspectCache() {
  cache.clear();
}

/**
 * Decode a BPF Upgradeable Loader account (bincode: u32 tag).
 * Tags: 0 Uninitialized, 1 Buffer{Option<authority>},
 *       2 Program{programdata_address}, 3 ProgramData{slot, Option<authority>}.
 */
export function decodeUpgradeableLoaderAccount(data) {
  const reader = new BorshReader(data);
  const tag = reader.readU32();
  switch (tag) {
    case 0:
      return { tag: 'uninitialized' };
    case 1:
      return { tag: 'buffer', authority: reader.readOption((r) => r.readPubkeyBase58()) };
    case 2:
      return { tag: 'program', programData: reader.readPubkeyBase58() };
    case 3: {
      const slot = reader.readU64();
      const upgradeAuthority = reader.readOption((r) => r.readPubkeyBase58());
      return { tag: 'programdata', slot, upgradeAuthority };
    }
    default:
      throw new Error(`unknown loader account tag ${tag}`);
  }
}

async function fetchAccount(rpcUrl, address, dataSlice) {
  const result = await rpcCall(rpcUrl, 'getAccountInfo', [
    address,
    { encoding: 'base64', commitment: 'confirmed', ...(dataSlice ? { dataSlice } : {}) },
  ]);
  return result?.value || null;
}

// ProgramData header: u32 tag + u64 slot + Option<Pubkey> authority (1 + 32)
const PROGRAMDATA_HEADER_LEN = 45;

export async function inspectProgram(rpcUrl, programId) {
  if (cache.has(programId)) return cache.get(programId);

  const account = await fetchAccount(rpcUrl, programId);
  let info;

  if (!account) {
    info = { kind: 'not-found' };
  } else if (!account.executable) {
    info = { kind: 'not-program' };
  } else if (account.owner === LOADER_V2_ID) {
    info = { kind: 'loader-v2' };
  } else if (account.owner !== UPGRADEABLE_LOADER_ID) {
    info = { kind: 'other', owner: account.owner };
  } else {
    const decoded = decodeUpgradeableLoaderAccount(base64ToUint8Array(account.data[0]));
    if (decoded.tag !== 'program') {
      info = { kind: 'other', owner: account.owner };
    } else {
      const pdAccount = await fetchAccount(rpcUrl, decoded.programData, {
        offset: 0,
        length: PROGRAMDATA_HEADER_LEN,
      });
      if (!pdAccount) throw new Error('programdata account not found: ' + decoded.programData);
      const pd = decodeUpgradeableLoaderAccount(base64ToUint8Array(pdAccount.data[0]));
      if (pd.tag !== 'programdata') throw new Error('unexpected programdata account state: ' + pd.tag);
      info = {
        kind: 'upgradeable',
        programData: decoded.programData,
        slot: pd.slot.toString(),
        upgradeAuthority: pd.upgradeAuthority,
      };
    }
  }

  cache.set(programId, info);
  return info;
}
