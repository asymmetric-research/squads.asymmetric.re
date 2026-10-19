// SPL Token / Token-2022 / ATA decoders.
import { describe, expect, test } from 'vitest'
import { SPL_DECODERS } from './decoders-spl.js'
import { decodeBase58 } from './squads.js'

const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
const TOKEN_2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'
const ATA = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'
const K = [
	'So11111111111111111111111111111111111111112', // 0
	'nigmAPDCZMVDW4wneBBcc6wjY6Ufjv7iLJc2mRvs8PS', // 1
	'nix9RErnQYXpuf329ntPgSzThogtfeyUempD7zDrnSH', // 2
	'8Sr4rQJL2aQT3EL97mbrk1T9VMw4pCS2mxMPp2QBzHQq', // 3
]

function u64le(n) {
	const b = new Uint8Array(8)
	new DataView(b.buffer).setBigUint64(0, BigInt(n), true)
	return b
}
function cat(...parts) {
	const total = parts.reduce((n, p) => n + p.length, 0)
	const out = new Uint8Array(total)
	let o = 0
	for (const p of parts) {
		out.set(p, o)
		o += p.length
	}
	return out
}

const decode = SPL_DECODERS[TOKEN]

describe('SPL decoders', () => {
	test('token approve', () => {
		const r = decode(cat(new Uint8Array([4]), u64le(5000)), K, [0, 1, 2])
		expect(r.action, 'action').toBe('Approve')
		expect(r.severity, 'approve is critical').toBe('critical')
		expect(r.description, 'description carries amount').toContain('5000')
		expect(r.details.delegate, 'delegate = account 1').toBe(K[1])
	})

	test('token approve-checked', () => {
		const r = decode(
			cat(new Uint8Array([13]), u64le(1500000), new Uint8Array([6])),
			K,
			[0, 1, 2, 3],
		)
		expect(r.action, 'action').toBe('ApproveChecked')
		expect(r.description, 'amount formatted with decimals').toContain('1.5')
		expect(r.details.delegate, 'delegate = account 2 (after mint)').toBe(K[2])
		expect(r.severity, 'critical').toBe('critical')
	})

	test('token set-authority', () => {
		// [tag=6][authority_type=2 AccountOwner][COption tag=1][new authority pubkey]
		const r = decode(cat(new Uint8Array([6, 2, 1]), decodeBase58(K[3])), K, [0, 1])
		expect(r.action, 'action').toBe('SetAuthority')
		expect(r.severity, 'critical').toBe('critical')
		expect(r.description, 'names the authority type').toContain('owner')
		expect(r.details.newAuthority, 'new authority decoded').toBe(K[3])
	})

	test('token set-authority to None', () => {
		// COption tag=0 → authority removed (irrevocable)
		const r = decode(new Uint8Array([6, 0, 0]), K, [0, 1])
		expect(r.details.newAuthority, 'None renders as removed').toBe('none (removed)')
	})

	test('token revoke / close / freeze / thaw / sync', () => {
		expect(decode(new Uint8Array([5]), K, [0, 1]).action, 'revoke').toBe('Revoke')
		const close = decode(new Uint8Array([9]), K, [0, 1, 2])
		expect(close.action, 'close').toBe('CloseAccount')
		expect(close.details.destination, 'close rent destination').toBe(K[1])
		expect(decode(new Uint8Array([10]), K, [0, 1, 2]).action, 'freeze').toBe('FreezeAccount')
		expect(decode(new Uint8Array([11]), K, [0, 1, 2]).action, 'thaw').toBe('ThawAccount')
		expect(decode(new Uint8Array([17]), K, [0]).action, 'sync native').toBe('SyncNative')
	})

	test('token mint/burn', () => {
		const mint = decode(cat(new Uint8Array([7]), u64le(42)), K, [0, 1, 2])
		expect(mint.action, 'mint action').toBe('MintTo')
		expect(mint.details.destination, 'mint destination').toBe(K[1])
		const burn = decode(cat(new Uint8Array([8]), u64le(42)), K, [0, 1, 2])
		expect(burn.action, 'burn action').toBe('Burn')
		const burnChecked = decode(
			cat(new Uint8Array([15]), u64le(250), new Uint8Array([2])),
			K,
			[0, 1, 2],
		)
		expect(burnChecked.description, 'burnChecked formats decimals').toContain('2.50')
	})

	test('token transfers still work', () => {
		const t = decode(cat(new Uint8Array([3]), u64le(999)), K, [0, 1, 2])
		expect(t.action, 'transfer').toBe('Transfer')
		const tc = decode(
			cat(new Uint8Array([12]), u64le(123456), new Uint8Array([3])),
			K,
			[0, 1, 2, 3],
		)
		expect(tc.action, 'transferChecked').toBe('TransferChecked')
		expect(tc.description, 'transferChecked formats decimals').toContain('123.456')
	})

	test('token init variants', () => {
		expect(decode(new Uint8Array([1]), K, [0, 1, 2, 3]).action, 'init account').toBe(
			'InitializeAccount',
		)
		const i3 = decode(cat(new Uint8Array([18]), decodeBase58(K[2])), K, [0, 1])
		expect(i3.action, 'init account 3').toBe('InitializeAccount3')
		expect(i3.details.owner, 'owner from data').toBe(K[2])
		expect(decode(new Uint8Array([22]), K, [0]).action, 'immutable owner').toBe(
			'InitializeImmutableOwner',
		)
	})

	test('unknown tag / malformed', () => {
		const u = decode(new Uint8Array([200]), K, [0])
		expect(u.undecoded, 'unknown tag flagged undecoded').toBe(true)
		expect(u.description, 'tag number shown').toContain('200')
		expect(
			() => decode(cat(new Uint8Array([4]), new Uint8Array([1, 2])), K, [0, 1, 2]),
			'truncated approve throws (core will degrade to Unknown)',
		).toThrow()
	})

	test('token-2022 shares layouts', () => {
		const r = SPL_DECODERS[TOKEN_2022](cat(new Uint8Array([4]), u64le(1)), K, [0, 1, 2])
		expect(r.action, 'same decoder registered for Token-2022').toBe('Approve')
	})

	test('ATA', () => {
		expect(
			SPL_DECODERS[ATA](new Uint8Array(0), K, [0, 1, 2, 3]).action,
			'empty data = Create',
		).toBe('Create')
		expect(SPL_DECODERS[ATA](new Uint8Array([1]), K, [0, 1, 2, 3]).action, 'tag 1').toBe(
			'CreateIdempotent',
		)
		const c = SPL_DECODERS[ATA](new Uint8Array([0]), K, [0, 1, 2, 3])
		expect(c.details.owner, 'ATA owner = account 2').toBe(K[2])
		expect(c.details.mint, 'ATA mint = account 3').toBe(K[3])

		// RecoverNested has its own account order (SPL instruction.rs):
		// [nested ATA, nested mint, destination ATA, owner ATA, owner mint, wallet]
		const rn = SPL_DECODERS[ATA](new Uint8Array([2]), K, [0, 1, 2, 3, 1, 2])
		expect(rn.action, 'recover nested').toBe('RecoverNested')
		expect(rn.details.nestedAccount, 'nested ATA = account 0').toBe(K[0])
		expect(rn.details.nestedMint, 'nested mint = account 1').toBe(K[1])
		expect(rn.details.destination, 'destination ATA = account 2').toBe(K[2])
		expect(rn.details.ownerAccount, 'owner ATA = account 3').toBe(K[3])
		expect(rn.details.ownerMint, 'owner mint = account 4').toBe(K[1])
		expect(rn.details.wallet, 'wallet = account 5').toBe(K[2])
		expect(rn.details.payer, 'no bogus payer field').toBeUndefined()
	})
})
