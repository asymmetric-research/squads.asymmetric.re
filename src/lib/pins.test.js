// Pin store: localStorage-backed per-wallet pins, membership check against a serialized
// multisig fixture, and boot-mode selection.
import { describe, expect, test, vi } from 'vitest'

const storage = new Map()
let quotaExceeded = false
vi.stubGlobal('localStorage', {
	getItem: (k) => (storage.has(k) ? storage.get(k) : null),
	setItem: (k, v) => {
		if (quotaExceeded) throw new Error('QuotaExceededError')
		storage.set(k, String(v))
	},
	removeItem: (k) => storage.delete(k),
})

const {
	getPins,
	addPin,
	removePin,
	hasAnyPins,
	findMember,
	resolveBootMode,
	isStickyOpen,
	setStickyOpen,
	reloadPinStore,
} = await import('./pins.js')
const { deserializeMultisig, decodeBase58, MULTISIG_DISCRIMINATOR } = await import('./squads.js')

const WALLET_A = 'So11111111111111111111111111111111111111112'
const WALLET_B = 'nigmAPDCZMVDW4wneBBcc6wjY6Ufjv7iLJc2mRvs8PS'
const OUTSIDER = 'nix9RErnQYXpuf329ntPgSzThogtfeyUempD7zDrnSH'
const MS_1 = '8Sr4rQJL2aQT3EL97mbrk1T9VMw4pCS2mxMPp2QBzHQq'
const MS_2 = 'MarBmsSgKXdrN1egZf5sqe1TMThczhMLJhMpbeVbnoB'

// Same layout vectors as resolver.test.js and squadit's Rust parser.

function leBytes(value, size) {
	const buf = new Uint8Array(size)
	let v = BigInt(value)
	for (let i = 0; i < size; i++) {
		buf[i] = Number(v & 0xffn)
		v >>= 8n
	}
	return buf
}

function concat(parts) {
	let total = 0
	for (const p of parts) total += p.length
	const out = new Uint8Array(total)
	let offset = 0
	for (const p of parts) {
		out.set(p, offset)
		offset += p.length
	}
	return out
}

// members: [[base58Key, permissionsMask], ...]
function serializeMultisig(members) {
	const memberBytes = [leBytes(members.length, 4)]
	for (const [key, mask] of members) {
		memberBytes.push(decodeBase58(key), new Uint8Array([mask]))
	}
	return concat([
		MULTISIG_DISCRIMINATOR,
		decodeBase58(WALLET_A), // create_key
		new Uint8Array(32), // config_authority
		leBytes(2, 2), // threshold
		leBytes(0, 4), // time_lock
		leBytes(5, 8), // transaction_index
		leBytes(0, 8), // stale_transaction_index
		new Uint8Array([0]), // rent_collector: None
		new Uint8Array([254]), // bump
		...memberBytes,
	])
}

// Sections share the module's pin cache and the storage map, and run in order.
describe('pins', () => {
	test('findMember', () => {
		const multisig = deserializeMultisig(
			serializeMultisig([
				[WALLET_A, 7],
				[WALLET_B, 2],
			]),
		)
		const memberA = findMember(multisig, WALLET_A)
		expect(memberA, 'finds member A').not.toBeNull()
		expect(memberA.permissionsMask, 'member A mask parsed as 7').toBe(7)
		const memberB = findMember(multisig, WALLET_B)
		expect(memberB, 'finds member B').not.toBeNull()
		expect(memberB.permissions, 'member B has Vote-only permissions').toEqual(['Vote'])
		expect(findMember(multisig, OUTSIDER), 'outsider is not a member').toBeNull()
	})

	test('pin store', () => {
		expect(getPins(WALLET_A), 'empty store returns no pins').toEqual([])
		expect(hasAnyPins(), 'hasAnyPins false on empty store').toBe(false)

		const { pins, persisted } = addPin(WALLET_A, { multisigAddress: MS_1, label: 'Treasury' })
		expect(persisted, 'addPin persists').toBeTruthy()
		expect(pins.length, 'addPin returns one pin').toBe(1)
		expect(pins[0].multisigAddress, 'pin has multisig address').toBe(MS_1)
		expect(pins[0].label, 'pin has label').toBe('Treasury')
		expect(typeof pins[0].pinnedAt, 'pin has pinnedAt timestamp').toBe('number')

		addPin(WALLET_A, { multisigAddress: MS_1, label: 'dupe' })
		expect(getPins(WALLET_A).length, 'duplicate multisig is not re-added').toBe(1)

		addPin(WALLET_A, { multisigAddress: MS_2, label: 'x'.repeat(100) })
		expect(getPins(WALLET_A)[1].label.length, 'label capped at 32 chars').toBe(32)

		addPin(WALLET_B, { multisigAddress: MS_2, label: '' })
		expect(getPins(WALLET_B).length, 'wallet B has its own list').toBe(1)
		expect(getPins(WALLET_A).length, 'wallet A list unaffected by wallet B').toBe(2)
		expect(hasAnyPins(), 'hasAnyPins true with pins').toBeTruthy()

		removePin(WALLET_A, MS_1)
		expect(getPins(WALLET_A).length, 'removePin removes one pin').toBe(1)
		expect(getPins(WALLET_A)[0].multisigAddress, 'remaining pin is MS_2').toBe(MS_2)

		reloadPinStore()
		expect(getPins(WALLET_A).length, 'pins survive cache reload').toBe(1)
	})

	test('corrupt data', () => {
		storage.set('pinnedSquads', 'not json{{{')
		reloadPinStore()
		expect(getPins(WALLET_A), 'corrupt JSON treated as empty').toEqual([])

		storage.set('pinnedSquads', JSON.stringify([1, 2, 3]))
		reloadPinStore()
		expect(hasAnyPins(), 'array at top level treated as empty').toBe(false)

		storage.set(
			'pinnedSquads',
			JSON.stringify({ [WALLET_A]: [{ bogus: true }, { multisigAddress: MS_1 }] }),
		)
		reloadPinStore()
		expect(getPins(WALLET_A).length, 'entries without multisigAddress are dropped').toBe(1)
	})

	test('quota errors keep the in-memory cache', () => {
		storage.delete('pinnedSquads')
		reloadPinStore()
		quotaExceeded = true
		try {
			const { persisted } = addPin(WALLET_A, { multisigAddress: MS_1, label: '' })
			expect(persisted, 'addPin reports persistence failure').toBe(false)
			expect(getPins(WALLET_A).length, 'pin retained in memory despite quota error').toBe(1)
		} finally {
			quotaExceeded = false
		}
	})

	test('resolveBootMode', () => {
		expect(
			resolveBootMode({ hasPins: false, stickyOpen: false, sessionMode: null }),
			'no pins -> open',
		).toBe('open')
		expect(
			resolveBootMode({ hasPins: true, stickyOpen: false, sessionMode: null }),
			'pins -> lockdown',
		).toBe('lockdown')
		expect(
			resolveBootMode({ hasPins: true, stickyOpen: true, sessionMode: null }),
			'sticky open overrides pins',
		).toBe('open')
		expect(
			resolveBootMode({ hasPins: true, stickyOpen: false, sessionMode: 'open' }),
			'session override open wins',
		).toBe('open')
		expect(
			resolveBootMode({ hasPins: false, stickyOpen: false, sessionMode: 'lockdown' }),
			'session override lockdown wins',
		).toBe('lockdown')
		expect(
			resolveBootMode({ hasPins: true, stickyOpen: false, sessionMode: 'garbage' }),
			'invalid session override ignored',
		).toBe('lockdown')
	})

	test('stickyOpen', () => {
		expect(isStickyOpen(), 'sticky open defaults false').toBe(false)
		setStickyOpen(true)
		expect(isStickyOpen(), 'sticky open set').toBe(true)
		setStickyOpen(false)
		expect(isStickyOpen(), 'sticky open cleared').toBe(false)
	})
})
