/**
 * RPC layer — thin wrapper over JSON-RPC via fetch.
 * Uses direct fetch() for reads (minimal deps), @solana/kit for tx construction only.
 */
import { deserializeMultisig, deserializeProposal, deserializeTransaction, deserializeVaultBatchTransaction, getProposalPda, getTransactionPda, getBatchTransactionPda, encodeBase58 } from './squads.js';

const RPC_TIMEOUT = 10_000; // 10 seconds

/**
 * Resolve Address Lookup Table accounts and append the looked-up keys
 * to message.accountKeys so instruction account indices work correctly.
 */
async function resolveAddressTableLookups(rpcUrl, message) {
  if (!message.addressTableLookups || message.addressTableLookups.length === 0) return;

  const altAddresses = message.addressTableLookups.map(a => a.accountKey);
  const response = await rpcCall(rpcUrl, 'getMultipleAccounts', [
    altAddresses,
    { encoding: 'base64', commitment: 'confirmed' },
  ]);

  if (!response?.value) return;

  for (let i = 0; i < message.addressTableLookups.length; i++) {
    const lookup = message.addressTableLookups[i];
    const accountInfo = response.value[i];
    if (!accountInfo?.data) continue;

    const altData = base64ToUint8Array(accountInfo.data[0]);
    // ALT layout: 56 bytes header, then 32-byte pubkeys
    const HEADER_SIZE = 56;
    const keys = [];
    for (let offset = HEADER_SIZE; offset + 32 <= altData.length; offset += 32) {
      keys.push(encodeBase58(altData.slice(offset, offset + 32)));
    }

    // Append writable keys first, then readonly — matching Solana's MessageV0 order
    for (const idx of lookup.writableIndexes) {
      if (idx < keys.length) message.accountKeys.push(keys[idx]);
      else message.accountKeys.push('?');
    }
    for (const idx of lookup.readonlyIndexes) {
      if (idx < keys.length) message.accountKeys.push(keys[idx]);
      else message.accountKeys.push('?');
    }
  }
}

export async function rpcCall(rpcUrl, method, params) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RPC_TIMEOUT);

  try {
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method,
        params,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`RPC HTTP error: ${response.status}`);
    }

    const text = await response.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`RPC returned invalid JSON (${text.slice(0, 100)})`);
    }
    if (json.error) {
      throw new Error(`RPC error: ${json.error.message || JSON.stringify(json.error)}`);
    }

    return json.result;
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('RPC request timed out (10s)');
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

export function base64ToUint8Array(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Fetch and deserialize a Multisig account.
 */
export async function fetchMultisig(rpcUrl, multisigAddress) {
  const result = await rpcCall(rpcUrl, 'getAccountInfo', [
    multisigAddress,
    { encoding: 'base64', commitment: 'confirmed' },
  ]);

  if (!result) {
    throw new Error('RPC returned null result for: ' + multisigAddress);
  }
  if (!result.value) {
    throw new Error('Account not found on-chain (result.value is null). Check the address and RPC URL.');
  }

  const accountData = result.value.data;
  if (!accountData) {
    throw new Error('Account exists but has no data field. Owner: ' + (result.value.owner || 'unknown'));
  }

  // getAccountInfo returns data as [base64String, encoding]
  const base64Str = Array.isArray(accountData) ? accountData[0] : accountData;
  if (!base64Str || base64Str.length === 0) {
    throw new Error('Account data is empty (0 bytes). This may not be a Squads multisig account.');
  }

  const data = base64ToUint8Array(base64Str);
  if (data.length < 8) {
    throw new Error('Account data too short (' + data.length + ' bytes). Expected a Squads multisig account (minimum ~120 bytes).');
  }

  return deserializeMultisig(data);
}

/**
 * Fetch proposals for a range of transaction indices.
 * Returns array of { index, proposal } objects (skips null/non-existent).
 */
export async function fetchProposalBatch(rpcUrl, multisigAddress, fromIndex, toIndex) {
  // Derive all proposal PDAs
  const pdaPromises = [];
  for (let i = toIndex; i >= fromIndex; i--) {
    pdaPromises.push(
      getProposalPda(multisigAddress, i).then(([pdaBytes]) => ({ index: i, pda: encodeBase58(pdaBytes) }))
    );
  }
  const pdas = await Promise.all(pdaPromises);

  // Batch fetch (max 100 per call) — addresses must be base58 strings
  const results = [];
  for (let i = 0; i < pdas.length; i += 100) {
    const batch = pdas.slice(i, i + 100);
    const addresses = batch.map(p => p.pda);

    const response = await rpcCall(rpcUrl, 'getMultipleAccounts', [
      addresses,
      { encoding: 'base64', commitment: 'confirmed' },
    ]);

    if (response?.value) {
      for (let j = 0; j < response.value.length; j++) {
        const accountInfo = response.value[j];
        if (accountInfo?.data) {
          try {
            const data = base64ToUint8Array(accountInfo.data[0]);
            const proposal = deserializeProposal(data);
            results.push({ index: batch[j].index, ...proposal });
          } catch {
            // Skip unparseable proposals
          }
        }
      }
    }
  }

  return results;
}

/**
 * Fetch and deserialize a transaction account (VaultTransaction, ConfigTransaction, or Batch).
 * For Batch accounts, also fetches all inner VaultBatchTransactions.
 */
export async function fetchTransaction(rpcUrl, multisigAddress, index) {
  const [pdaBytes] = await getTransactionPda(multisigAddress, index);
  const pda = encodeBase58(pdaBytes);

  const result = await rpcCall(rpcUrl, 'getAccountInfo', [
    pda,
    { encoding: 'base64', commitment: 'confirmed' },
  ]);

  if (!result?.value?.data) {
    throw new Error('Transaction account not found for index ' + index);
  }

  const data = base64ToUint8Array(result.value.data[0]);
  const tx = deserializeTransaction(data);

  // Resolve Address Lookup Tables for vault transactions
  if (tx.type === 'vault' && tx.message?.addressTableLookups?.length > 0) {
    await resolveAddressTableLookups(rpcUrl, tx.message);
  }

  // For Batch accounts, fetch inner VaultBatchTransactions to get actual instructions
  if (tx.type === 'batch' && tx.size > 0) {
    const innerTxs = [];
    // Batch transactions are 1-indexed
    const pdaPromises = [];
    for (let i = 1; i <= tx.size; i++) {
      pdaPromises.push(
        getBatchTransactionPda(multisigAddress, index, i)
          .then(([bytes]) => ({ innerIndex: i, pda: encodeBase58(bytes) }))
      );
    }
    const innerPdas = await Promise.all(pdaPromises);
    const addresses = innerPdas.map(p => p.pda);

    const innerResult = await rpcCall(rpcUrl, 'getMultipleAccounts', [
      addresses,
      { encoding: 'base64', commitment: 'confirmed' },
    ]);

    if (innerResult?.value) {
      for (let i = 0; i < innerResult.value.length; i++) {
        const info = innerResult.value[i];
        if (info?.data) {
          try {
            const innerData = base64ToUint8Array(info.data[0]);
            const innerTx = deserializeVaultBatchTransaction(innerData);
            if (innerTx.message?.addressTableLookups?.length > 0) {
              await resolveAddressTableLookups(rpcUrl, innerTx.message);
            }
            innerTxs.push({ innerIndex: innerPdas[i].innerIndex, ...innerTx });
          } catch {
            // Skip unparseable inner transactions
          }
        }
      }
    }
    tx.innerTransactions = innerTxs;
  }

  return tx;
}

/**
 * Get SOL balance for an address.
 */
export async function fetchBalance(rpcUrl, address) {
  const result = await rpcCall(rpcUrl, 'getBalance', [
    address,
    { commitment: 'confirmed' },
  ]);
  return result?.value || 0;
}

/**
 * Get latest blockhash for transaction building.
 */
export async function fetchLatestBlockhash(rpcUrl) {
  const result = await rpcCall(rpcUrl, 'getLatestBlockhash', [
    { commitment: 'confirmed' },
  ]);
  return result.value;
}

/**
 * Simulate a transaction (base64 encoded).
 */
export async function simulateTransaction(rpcUrl, base64Tx) {
  const result = await rpcCall(rpcUrl, 'simulateTransaction', [
    base64Tx,
    {
      encoding: 'base64',
      commitment: 'confirmed',
      replaceRecentBlockhash: true,
    },
  ]);
  return result.value;
}
