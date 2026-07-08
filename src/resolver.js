/**
 * Address resolution — turns any pasted Squads-related address into the
 * canonical Multisig account address using on-chain data.
 *
 * The Squads web UI shows the vault address, not the multisig account, so
 * users often only have the vault. Resolution order:
 *   1. Direct Multisig account
 *   2. Proposal / VaultTransaction / ConfigTransaction / Batch account
 *      (these embed the multisig pubkey)
 *   3. Input as create_key → multisig PDA
 *   4. Vault → multisig via recent transaction history: any multisig found in
 *      a transaction that touched the input is accepted only if re-deriving
 *      its vault PDA reproduces the input address
 *   5. Squads API fallback for system-owned accounts (e.g. a vault with no
 *      transaction history)
 *
 * Returns { type, multisigAddress?, resolvedFrom?, via?, message? }.
 */
import { rpcCall, base64ToUint8Array } from './rpc.js';
import {
  PROGRAM_ID,
  deserializeMultisig,
  deserializeProposal,
  deserializeTransaction,
  getMultisigPda,
  getMultisigVaultPda,
  encodeBase58,
  isValidBase58,
} from './squads.js';

const SYSTEM_PROGRAM_ID = '11111111111111111111111111111111';
const SMART_ACCOUNT_PROGRAM_ID = 'SMRTzfY6DfH5ik3TKiyLFfXexV8uSG3d2UksSCYdunG';

// How many recent transactions to probe when resolving a vault.
const SIG_PROBE_DEPTH = 10;
// Vault index is a u8 — scanning the full space keeps verification exhaustive.
const MAX_VAULT_INDEX = 255;
// A Solana transaction can reference at most 256 accounts (incl. lookup tables).
const MAX_CANDIDATES_PER_TX = 256;
// Bail out after PDA-scanning this many candidate multisigs — bounds worst-case
// work (256 derivations each) against a hostile or garbage-returning RPC.
const MAX_VAULT_SCANS = 8;

function toAccount(value) {
  try {
    const base64Str = Array.isArray(value.data) ? value.data[0] : value.data;
    return {
      owner: value.owner,
      lamports: value.lamports,
      data: base64Str ? base64ToUint8Array(base64Str) : new Uint8Array(0),
    };
  } catch {
    return null; // malformed RPC response — treat the account as missing
  }
}

async function getAccount(rpcUrl, address) {
  const result = await rpcCall(rpcUrl, 'getAccountInfo', [
    address,
    { encoding: 'base64', commitment: 'confirmed' },
  ]);
  return result?.value ? toAccount(result.value) : null;
}

async function getMultipleAccounts(rpcUrl, addresses) {
  const out = [];
  for (let i = 0; i < addresses.length; i += 100) {
    const chunk = addresses.slice(i, i + 100);
    const response = await rpcCall(rpcUrl, 'getMultipleAccounts', [
      chunk,
      { encoding: 'base64', commitment: 'confirmed' },
    ]);
    const values = response?.value || [];
    for (let j = 0; j < chunk.length; j++) {
      out.push(values[j] ? toAccount(values[j]) : null);
    }
  }
  return out;
}

function decodesAsMultisig(account) {
  if (!account || account.owner !== PROGRAM_ID) return false;
  try {
    deserializeMultisig(account.data);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve an input address to a Squads v4 multisig.
 * Returns { type: 'multisig'|'wallet'|'smart-account'|'unknown', ... }.
 */
export async function resolveMultisigAddress(rpcUrl, inputAddress) {
  const account = await getAccount(rpcUrl, inputAddress);

  // Case 1+2: owned by the Squads program — multisig itself, or an account
  // that points back to one.
  if (account && account.owner === PROGRAM_ID && account.data.length > 0) {
    const resolved = await resolveSquadsOwnedAccount(rpcUrl, inputAddress, account);
    if (resolved) return resolved;
  }

  // Case 3: input is the create_key of a multisig.
  const viaCreateKey = await resolveViaCreateKey(rpcUrl, inputAddress);
  if (viaCreateKey) return viaCreateKey;

  // Case 4: input is a vault — find the multisig in recent transaction
  // history and confirm by re-deriving the vault PDA. Only worth attempting
  // when the input could actually be a vault: vaults hold nothing but
  // lamports, so they are either system-owned or don't exist on-chain yet.
  // (This also avoids a very expensive history scan when the input is a
  // busy program/mint/token account.)
  const diag = {};
  if (!account || account.owner === SYSTEM_PROGRAM_ID) {
    const viaRecentTx = await resolveVaultViaRecentTransactions(rpcUrl, inputAddress, diag);
    if (viaRecentTx) return viaRecentTx;
  }

  if (!account) {
    throw new Error(
      'Account not found on-chain, and no Squads multisig could be derived from it: ' + inputAddress
    );
  }

  // Case 5: system-owned (vault or wallet) — last-resort Squads API lookup.
  if (account.owner === SYSTEM_PROGRAM_ID) {
    const viaApi = await resolveViaSquadsApi(rpcUrl, inputAddress);
    if (viaApi) return viaApi;

    return {
      type: 'wallet',
      owner: account.owner,
      balance: account.lamports,
      message: diag.probeError
        ? 'This address is a wallet (owned by System Program), and its recent transaction ' +
          'history could not be checked (' + diag.probeError + '). If this is a Squads vault, ' +
          'retry, or enter the multisig account address directly.'
        : 'This address is a wallet (owned by System Program). If this is a Squads vault, ' +
          'no parent multisig could be found in its recent transaction history. ' +
          'Try entering the multisig account address directly.',
    };
  }

  if (account.owner === SMART_ACCOUNT_PROGRAM_ID && account.data.length > 0) {
    return {
      type: 'smart-account',
      multisigAddress: inputAddress,
      message:
        'This is a Smart Account program multisig. This verifier currently only supports ' +
        'Squads v4 (SQDS4ep...). Smart Account support is planned.',
    };
  }

  return {
    type: 'unknown',
    owner: account.owner,
    dataLen: account.data.length,
    message:
      `Account is owned by ${account.owner} with ${account.data.length} bytes of data. ` +
      `Expected a Squads v4 multisig account (owned by ${PROGRAM_ID}).`,
  };
}

async function resolveSquadsOwnedAccount(rpcUrl, inputAddress, account) {
  if (decodesAsMultisig(account)) {
    return { type: 'multisig', multisigAddress: inputAddress };
  }

  // Proposal and transaction accounts embed their parent multisig pubkey.
  let parent = null;
  let via = null;
  try {
    parent = deserializeProposal(account.data).multisig;
    via = 'proposal';
  } catch {
    try {
      const tx = deserializeTransaction(account.data);
      if (tx.multisig) {
        parent = tx.multisig;
        via = tx.type + ' transaction';
      }
    } catch { /* not a recognized Squads account */ }
  }
  if (!parent) return null;

  const parentAccount = await getAccount(rpcUrl, parent);
  if (!decodesAsMultisig(parentAccount)) return null;

  return {
    type: 'multisig',
    multisigAddress: parent,
    resolvedFrom: inputAddress,
    via,
    message: 'Resolved ' + via + ' account to multisig ' + parent,
  };
}

async function resolveViaCreateKey(rpcUrl, inputAddress) {
  const [pdaBytes] = await getMultisigPda(inputAddress);
  const pda = encodeBase58(pdaBytes);
  const account = await getAccount(rpcUrl, pda);
  if (!decodesAsMultisig(account)) return null;

  return {
    type: 'multisig',
    multisigAddress: pda,
    resolvedFrom: inputAddress,
    via: 'create key',
    message: 'Resolved create key to multisig ' + pda,
  };
}

async function resolveVaultViaRecentTransactions(rpcUrl, inputAddress, diag = {}) {
  let signatures;
  try {
    signatures = await rpcCall(rpcUrl, 'getSignaturesForAddress', [
      inputAddress,
      { limit: SIG_PROBE_DEPTH, commitment: 'confirmed' },
    ]);
  } catch (err) {
    diag.probeError = err.message;
    return null;
  }
  if (!Array.isArray(signatures)) return null;

  const checked = new Set([inputAddress]);
  let vaultScans = 0;
  let probed = 0;
  let txFailures = 0;
  for (const entry of signatures) {
    const signature = entry?.signature;
    if (typeof signature !== 'string') continue;
    probed++;

    let keys;
    try {
      keys = await getTransactionAccountKeys(rpcUrl, signature);
    } catch {
      txFailures++;
      continue;
    }

    const candidates = keys
      .filter((k) => typeof k === 'string' && isValidBase58(k) && !checked.has(k))
      .slice(0, MAX_CANDIDATES_PER_TX);
    for (const k of candidates) checked.add(k);
    if (candidates.length === 0) continue;

    const accounts = await getMultipleAccounts(rpcUrl, candidates);
    for (let i = 0; i < candidates.length; i++) {
      if (!decodesAsMultisig(accounts[i])) continue;
      if (vaultScans >= MAX_VAULT_SCANS) return null;
      vaultScans++;

      const vaultIndex = await findVaultIndex(candidates[i], inputAddress);
      if (vaultIndex === null) continue;

      return {
        type: 'multisig',
        multisigAddress: candidates[i],
        resolvedFrom: inputAddress,
        via: 'vault (index ' + vaultIndex + ')',
        vaultIndex,
        message: 'Resolved vault (index ' + vaultIndex + ') to multisig ' + candidates[i],
      };
    }
  }
  if (probed > 0 && txFailures === probed) {
    diag.probeError = 'none of its recent transactions could be fetched';
  }
  return null;
}

/**
 * Confirm a vault→multisig relationship: return the vault index whose PDA
 * derivation from `multisigAddress` reproduces `vaultAddress`, or null.
 */
async function findVaultIndex(multisigAddress, vaultAddress) {
  for (let index = 0; index <= MAX_VAULT_INDEX; index++) {
    const [pdaBytes] = await getMultisigVaultPda(multisigAddress, index);
    if (encodeBase58(pdaBytes) === vaultAddress) return index;
  }
  return null;
}

async function getTransactionAccountKeys(rpcUrl, signature) {
  const tx = await rpcCall(rpcUrl, 'getTransaction', [
    signature,
    { encoding: 'json', maxSupportedTransactionVersion: 0, commitment: 'confirmed' },
  ]);
  const keys = [...(tx?.transaction?.message?.accountKeys || [])];
  const loaded = tx?.meta?.loadedAddresses;
  if (loaded) {
    keys.push(...(loaded.writable || []), ...(loaded.readonly || []));
  }
  return keys;
}

async function resolveViaSquadsApi(rpcUrl, inputAddress) {
  try {
    const opts = {};
    if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
      opts.signal = AbortSignal.timeout(5000);
    }
    const apiResp = await fetch('https://v4-api.squads.so/multisig/' + inputAddress, opts);
    if (!apiResp.ok) return null;
    const apiData = await apiResp.json();
    if (typeof apiData?.address !== 'string' || !isValidBase58(apiData.address)) return null;

    // Never trust the API: the returned account must decode as a real multisig
    // AND the input must re-derive as one of its vault PDAs — otherwise a
    // malicious API response could switch the user onto an attacker's multisig.
    const account = await getAccount(rpcUrl, apiData.address);
    if (!decodesAsMultisig(account)) return null;
    const vaultIndex = await findVaultIndex(apiData.address, inputAddress);
    if (vaultIndex === null) return null;

    return {
      type: 'multisig',
      multisigAddress: apiData.address,
      resolvedFrom: inputAddress,
      vaultIndex,
      via: 'Squads API',
      message:
        'Resolved vault (index ' + vaultIndex + ') to multisig ' + apiData.address +
        ' (via Squads API, verified on-chain)',
    };
  } catch {
    return null;
  }
}
