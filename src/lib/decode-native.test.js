// Native program decoders: System, BPF Upgradeable Loader, Stake, Compute Budget, Address Lookup Table.
import { describe, expect, test } from 'vitest'
import { NATIVE_DECODERS } from './decoders-native.js'
import { decodeBase58 } from './squads.js'

const SYSTEM = '11111111111111111111111111111111'
const LOADER = 'BPFLoaderUpgradeab1e11111111111111111111111'
const STAKE = 'Stake11111111111111111111111111111111111111'
const BUDGET = 'ComputeBudget111111111111111111111111111111'
const ALT = 'AddressLookupTab1e1111111111111111111111111'

const K = [
	'So11111111111111111111111111111111111111112', // 0
	'nigmAPDCZMVDW4wneBBcc6wjY6Ufjv7iLJc2mRvs8PS', // 1
	'nix9RErnQYXpuf329ntPgSzThogtfeyUempD7zDrnSH', // 2
	'8Sr4rQJL2aQT3EL97mbrk1T9VMw4pCS2mxMPp2QBzHQq', // 3
	'MarBmsSgKXdrN1egZf5sqe1TMThczhMLJhMpbeVbnoB', // 4
	'BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY', // 5
	'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4', // 6
]

function u32le(n) {
	const b = new Uint8Array(4)
	new DataView(b.buffer).setUint32(0, n, true)
	return b
}
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

describe('native decoders', () => {
	test('BPF loader — Upgrade', () => {
		// accounts: [programdata, program, buffer, spill, rent, clock, authority]
		const r = NATIVE_DECODERS[LOADER](u32le(3), K, [0, 1, 2, 3, 4, 5, 6])
		expect(r.action, 'action').toBe('Upgrade')
		expect(r.severity, 'upgrade is critical').toBe('critical')
		expect(r.details.program, 'program = account 1').toBe(K[1])
		expect(r.details.buffer, 'buffer = account 2').toBe(K[2])
		expect(r.details.spill, 'spill = account 3').toBe(K[3])
		expect(r.details.authority, 'authority = account 6').toBe(K[6])
		expect(r.description, 'description says upgrade').toContain('Upgrade')
	})

	test('BPF loader — SetAuthority / SetAuthorityChecked / Close', () => {
		const sa = NATIVE_DECODERS[LOADER](u32le(4), K, [0, 1, 2])
		expect(sa.action, 'set authority').toBe('SetAuthority')
		expect(sa.severity, 'critical').toBe('critical')
		expect(sa.details.currentAuthority, 'current authority').toBe(K[1])
		expect(sa.details.newAuthority, 'new authority').toBe(K[2])

		const saNoNew = NATIVE_DECODERS[LOADER](u32le(4), K, [0, 1])
		expect(saNoNew.details.newAuthority, 'missing new authority = removed').toBe(
			'none (authority removed)',
		)

		const sac = NATIVE_DECODERS[LOADER](u32le(7), K, [0, 1, 2])
		expect(sac.action, 'set authority checked').toBe('SetAuthorityChecked')

		const close = NATIVE_DECODERS[LOADER](u32le(5), K, [0, 1, 2])
		expect(close.action, 'close').toBe('Close')
		expect(close.severity, 'critical').toBe('critical')
		expect(close.details.recipient, 'lamports recipient').toBe(K[1])
	})

	test('BPF loader — Write / Deploy / Extend', () => {
		const w = NATIVE_DECODERS[LOADER](
			cat(u32le(1), u32le(512), u64le(3), new Uint8Array([9, 9, 9])),
			K,
			[0, 1],
		)
		expect(w.action, 'write').toBe('Write')
		expect(w.description, 'byte count summarized').toContain('3 bytes')
		expect(w.description, 'offset shown').toContain('512')

		const d = NATIVE_DECODERS[LOADER](cat(u32le(2), u64le(1000000)), K, [0, 1, 2, 3])
		expect(d.action, 'deploy').toBe('DeployWithMaxDataLen')
		expect(
			d.severity,
			'deploy is not critical (spec list is Upgrade/SetAuthority/SetAuthorityChecked/Close)',
		).toBeUndefined()

		const e = NATIVE_DECODERS[LOADER](cat(u32le(6), u32le(4096)), K, [0, 1])
		expect(e.action, 'extend').toBe('ExtendProgram')
		expect(e.description, 'additional bytes shown').toContain('4096')
	})

	test('System — expanded coverage', () => {
		const assign = NATIVE_DECODERS[SYSTEM](cat(u32le(1), decodeBase58(K[3])), K, [0])
		expect(assign.action, 'assign').toBe('Assign')
		expect(assign.severity, 'assign is critical').toBe('critical')
		expect(assign.details.newOwner, 'new owner from data').toBe(K[3])

		const alloc = NATIVE_DECODERS[SYSTEM](cat(u32le(8), u64le(1024)), K, [0])
		expect(alloc.action, 'allocate').toBe('Allocate')

		const transfer = NATIVE_DECODERS[SYSTEM](cat(u32le(2), u64le(1500000000)), K, [0, 1])
		expect(transfer.action, 'transfer').toBe('Transfer')
		expect(transfer.description, 'SOL formatted').toContain('1.5000 SOL')

		// CreateAccountWithSeed: base pk + seed (u64-len string) + lamports + space + owner
		const seed = new TextEncoder().encode('vault')
		const caws = NATIVE_DECODERS[SYSTEM](
			cat(
				u32le(3),
				decodeBase58(K[2]),
				u64le(seed.length),
				seed,
				u64le(10),
				u64le(100),
				decodeBase58(K[3]),
			),
			K,
			[0, 1],
		)
		expect(caws.action, 'create with seed').toBe('CreateAccountWithSeed')
		expect(caws.details.seed, 'seed string decoded').toBe('vault')
		expect(caws.details.owner, 'owner decoded').toBe(K[3])

		const auth = NATIVE_DECODERS[SYSTEM](cat(u32le(7), decodeBase58(K[2])), K, [0, 1])
		expect(auth.action, 'authorize nonce').toBe('AuthorizeNonceAccount')
		expect(auth.severity, 'critical').toBe('critical')

		const withdraw = NATIVE_DECODERS[SYSTEM](cat(u32le(5), u64le(2000000000)), K, [0, 1, 2, 3, 4])
		expect(withdraw.action, 'withdraw nonce').toBe('WithdrawNonceAccount')
		expect(withdraw.description, 'lamports formatted').toContain('2.0000 SOL')
	})

	test('Stake', () => {
		const del = NATIVE_DECODERS[STAKE](u32le(2), K, [0, 1, 2, 3, 4, 5])
		expect(del.action, 'delegate').toBe('DelegateStake')
		expect(del.details.voteAccount, 'vote account').toBe(K[1])

		// Authorize: new_authorized pubkey + stake_authorize u32 (1 = Withdrawer)
		const auth = NATIVE_DECODERS[STAKE](cat(u32le(1), decodeBase58(K[4]), u32le(1)), K, [0, 1, 2])
		expect(auth.action, 'authorize').toBe('Authorize')
		expect(auth.severity, 'critical').toBe('critical')
		expect(auth.description, 'authority kind named').toContain('withdrawer')
		expect(auth.details.newAuthority, 'new authority').toBe(K[4])

		const authOdd = NATIVE_DECODERS[STAKE](
			cat(u32le(1), decodeBase58(K[4]), u32le(7)),
			K,
			[0, 1, 2],
		)
		expect(authOdd.description, 'malformed authorize kind does not claim withdrawer').toContain(
			'unknown kind 7',
		)

		const split = NATIVE_DECODERS[STAKE](cat(u32le(3), u64le(5000000000)), K, [0, 1, 2])
		expect(split.action, 'split').toBe('Split')

		const wd = NATIVE_DECODERS[STAKE](cat(u32le(4), u64le(1000000000)), K, [0, 1, 2, 3, 4])
		expect(wd.action, 'withdraw').toBe('Withdraw')

		expect(NATIVE_DECODERS[STAKE](u32le(5), K, [0, 1, 2]).action, 'deactivate').toBe('Deactivate')

		// SetLockup: args unread (Option fields), authority from accounts
		const lockup = NATIVE_DECODERS[STAKE](u32le(6), K, [0, 1])
		expect(lockup.action, 'set lockup').toBe('SetLockup')
		expect(lockup.severity, 'set lockup critical').toBe('critical')

		const merge = NATIVE_DECODERS[STAKE](u32le(7), K, [0, 1, 2, 3, 4])
		expect(merge.action, 'merge').toBe('Merge')
		expect(merge.details.sourceStake, 'merge source').toBe(K[1])

		// AuthorizeWithSeed: new_authorized pubkey + stake_authorize u32 (trailing seed/owner unread)
		const aws = NATIVE_DECODERS[STAKE](cat(u32le(8), decodeBase58(K[4]), u32le(1)), K, [0, 1, 2])
		expect(aws.action, 'authorize with seed').toBe('AuthorizeWithSeed')
		expect(aws.severity, 'authorize with seed critical').toBe('critical')
		expect(aws.details.newAuthority, 'aws new authority').toBe(K[4])
		expect(aws.description, 'aws kind named').toContain('withdrawer')

		expect(NATIVE_DECODERS[STAKE](u32le(9), K, [0, 1, 2, 3]).action, 'initialize checked').toBe(
			'InitializeChecked',
		)

		// AuthorizeChecked: stake_authorize u32 only; new authority is account 3
		const ac = NATIVE_DECODERS[STAKE](cat(u32le(10), u32le(1)), K, [0, 1, 2, 3])
		expect(ac.action, 'authorize checked').toBe('AuthorizeChecked')
		expect(ac.severity, 'authorize checked critical').toBe('critical')
		expect(ac.details.newAuthority, 'ac new authority from accounts').toBe(K[3])

		const acws = NATIVE_DECODERS[STAKE](cat(u32le(11), u32le(0)), K, [0, 1, 2, 3])
		expect(acws.action, 'authorize checked with seed').toBe('AuthorizeCheckedWithSeed')
		expect(acws.severity, 'acws critical').toBe('critical')
		expect(acws.description, 'acws kind named').toContain('staker')

		const slc = NATIVE_DECODERS[STAKE](u32le(12), K, [0, 1, 2])
		expect(slc.action, 'set lockup checked').toBe('SetLockupChecked')
		expect(slc.severity, 'set lockup checked critical').toBe('critical')

		expect(
			NATIVE_DECODERS[STAKE](u32le(99), K, [0]).undecoded,
			'unknown tag undecoded',
		).toBeTruthy()
	})

	test('Compute budget', () => {
		const limit = NATIVE_DECODERS[BUDGET](cat(new Uint8Array([2]), u32le(400000)), K, [])
		expect(limit.action, 'unit limit').toBe('SetComputeUnitLimit')
		expect(
			limit.description.includes('400000') || limit.description.includes('400,000'),
			'units shown',
		).toBe(true)

		const price = NATIVE_DECODERS[BUDGET](cat(new Uint8Array([3]), u64le(50000)), K, [])
		expect(price.action, 'unit price').toBe('SetComputeUnitPrice')

		const heap = NATIVE_DECODERS[BUDGET](cat(new Uint8Array([1]), u32le(262144)), K, [])
		expect(heap.action, 'heap').toBe('RequestHeapFrame')
	})

	test('Address lookup table', () => {
		const create = NATIVE_DECODERS[ALT](
			cat(u32le(0), u64le(123456), new Uint8Array([254])),
			K,
			[0, 1, 2],
		)
		expect(create.action, 'create').toBe('CreateLookupTable')

		// Extend: Vec<Pubkey> with u64 length
		const ext = NATIVE_DECODERS[ALT](
			cat(u32le(2), u64le(2), decodeBase58(K[3]), decodeBase58(K[4])),
			K,
			[0, 1],
		)
		expect(ext.action, 'extend').toBe('ExtendLookupTable')
		expect(ext.description, 'address count shown').toContain('2 address')

		expect(NATIVE_DECODERS[ALT](u32le(1), K, [0, 1]).action, 'freeze').toBe('FreezeLookupTable')
		expect(NATIVE_DECODERS[ALT](u32le(3), K, [0, 1]).action, 'deactivate').toBe(
			'DeactivateLookupTable',
		)
		expect(NATIVE_DECODERS[ALT](u32le(4), K, [0, 1, 2]).action, 'close').toBe('CloseLookupTable')
	})

	test('unknown tags degrade', () => {
		expect(NATIVE_DECODERS[SYSTEM](u32le(99), K, [0]).undecoded, 'system unknown tag').toBe(true)
		expect(NATIVE_DECODERS[LOADER](u32le(99), K, [0]).undecoded, 'loader unknown tag').toBe(true)
		expect(
			() => NATIVE_DECODERS[SYSTEM](new Uint8Array([1, 2]), K, [0]),
			'truncated system data throws (core degrades to Unknown)',
		).toThrow()
	})
})
