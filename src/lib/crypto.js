/**
 * Cryptographic primitives — ed25519 on-curve check, PDA derivation.
 * Zero dependencies. Uses WebCrypto for SHA-256, BigInt for field math.
 */

// ed25519 field prime: 2^255 - 19
const P = 2n ** 255n - 19n;
// ed25519 curve constant d
const D = 37095705934669439343138083508754565189542113879843219016388785533085940283555n;

function modPow(base, exp, mod) {
  let result = 1n;
  base = ((base % mod) + mod) % mod;
  while (exp > 0n) {
    if (exp & 1n) result = (result * base) % mod;
    exp >>= 1n;
    base = (base * base) % mod;
  }
  return result;
}

/**
 * Check if 32 bytes represent a point on the ed25519 curve.
 * Used for PDA derivation — a valid PDA is NOT on the curve.
 */
export function isOnCurve(bytes) {
  const clamped = new Uint8Array(bytes);
  clamped[31] &= 0x7f; // clear sign bit

  let y = 0n;
  for (let i = 0; i < 32; i++) {
    y |= BigInt(clamped[i]) << BigInt(8 * i);
  }

  if (y >= P) return false;

  const y2 = (y * y) % P;
  const u = (y2 - 1n + P) % P;
  const v = ((D * y2) % P + 1n) % P;
  const vInv = modPow(v, P - 2n, P); // Fermat's little theorem
  const x2 = (u * vInv) % P;

  if (x2 === 0n) return true; // x=0 is on the curve

  // Euler's criterion: x2 is a quadratic residue iff x2^((p-1)/2) ≡ 1 (mod p)
  const check = modPow(x2, (P - 1n) / 2n, P);
  return check === 1n;
}

/**
 * SHA-256 hash using WebCrypto.
 */
export async function sha256(data) {
  const hash = await crypto.subtle.digest('SHA-256', data);
  return new Uint8Array(hash);
}

/**
 * Derive a Program Derived Address (PDA).
 * Seeds: array of Uint8Array (each <= 32 bytes).
 * ProgramId: Uint8Array(32).
 * Returns: [address: Uint8Array(32), bump: number]
 */
export async function findProgramAddress(seeds, programId) {
  const PDA_MARKER = new TextEncoder().encode('ProgramDerivedAddress');

  for (let bump = 255; bump >= 0; bump--) {
    // Concatenate: seed1 || seed2 || ... || [bump] || programId || "ProgramDerivedAddress"
    const parts = [...seeds, Uint8Array.from([bump]), programId, PDA_MARKER];
    let totalLen = 0;
    for (const p of parts) totalLen += p.length;

    const buf = new Uint8Array(totalLen);
    let offset = 0;
    for (const p of parts) {
      buf.set(p, offset);
      offset += p.length;
    }

    const hash = await sha256(buf);

    if (!isOnCurve(hash)) {
      return [hash, bump];
    }
  }

  throw new Error('Could not find valid PDA bump');
}
