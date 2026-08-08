/**
 * Shared helpers for instruction decoders.
 */

// BigInt-safe token amount formatting (no precision loss for amounts > 2^53)
export function formatTokenAmount(amount, decimals) {
  const str = amount.toString();
  if (decimals === 0) return str;
  if (str.length <= decimals) return '0.' + str.padStart(decimals, '0');
  return str.slice(0, str.length - decimals) + '.' + str.slice(str.length - decimals);
}

export function formatSolAmount(lamports) {
  return (Number(lamports) / 1e9).toFixed(4) + ' SOL';
}

// Instruction account by position — '?' when the message omits it
export function acct(accountKeys, accountIndexes, i) {
  const idx = accountIndexes[i];
  return idx !== undefined && accountKeys[idx] !== undefined ? accountKeys[idx] : '?';
}
