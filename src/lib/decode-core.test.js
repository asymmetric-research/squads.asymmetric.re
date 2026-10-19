// decode.js core: label resolution, severity plumbing, anchor hints, throw-degradation.
import { describe, expect, test, vi } from 'vitest'

const storage = new Map()
vi.stubGlobal('localStorage', {
	getItem: (k) => (storage.has(k) ? storage.get(k) : null),
	setItem: (k, v) => storage.set(k, String(v)),
	removeItem: (k) => storage.delete(k),
})

const { decodeInstruction, KNOWN_PROGRAMS } = await import('./decode.js')
const { setProgramLabel } = await import('./program-labels.js')

const LOADER = 'BPFLoaderUpgradeab1e11111111111111111111111'
const UNKNOWN_PROG = 'FakeProgram1111111111111111111111111111111'
const K = [
	'So11111111111111111111111111111111111111112',
	'nigmAPDCZMVDW4wneBBcc6wjY6Ufjv7iLJc2mRvs8PS',
	'nix9RErnQYXpuf329ntPgSzThogtfeyUempD7zDrnSH',
	'8Sr4rQJL2aQT3EL97mbrk1T9VMw4pCS2mxMPp2QBzHQq',
	'MarBmsSgKXdrN1egZf5sqe1TMThczhMLJhMpbeVbnoB',
	'BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY',
	'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
]

function u32le(n) {
	const b = new Uint8Array(4)
	new DataView(b.buffer).setUint32(0, n, true)
	return b
}

describe('decode core', () => {
	test('registry breadth', () => {
		expect(
			KNOWN_PROGRAMS.size,
			`registry has >= 24 entries (${KNOWN_PROGRAMS.size})`,
		).toBeGreaterThanOrEqual(24)
		expect(KNOWN_PROGRAMS.get(LOADER), 'loader labeled').toBe('BPF Upgradeable Loader')
		expect(
			KNOWN_PROGRAMS.get('JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4'),
			'squadit entries ported',
		).toBe('Jupiter v6')
		expect(KNOWN_PROGRAMS.get('Stake11111111111111111111111111111111111111'), 'stake labeled').toBe(
			'Stake',
		)
	})

	test('decoded upgrade end-to-end', () => {
		const r = decodeInstruction(LOADER, u32le(3), K, [0, 1, 2, 3, 4, 5, 6])
		expect(r.type, 'decoded').toBe('decoded')
		expect(r.action, 'action').toBe('Upgrade')
		expect(r.severity, 'severity surfaces').toBe('critical')
		expect(r.program, 'program label').toBe('BPF Upgradeable Loader')
		expect(r.isKnown, 'known').toBe(true)
		expect(r.programId, 'programId included').toBe(LOADER)
	})

	test('unknown tag in known program -> Known', () => {
		const r = decodeInstruction(LOADER, u32le(99), K, [0])
		expect(r.type, 'not decoded').toBe('unknown')
		expect(r.isKnown, 'still known program').toBe(true)
		expect(r.description, 'tag number surfaces').toContain('99')
	})

	test('throwing decoder degrades', () => {
		const r = decodeInstruction(LOADER, new Uint8Array([1]), K, [0])
		expect(r.type, 'truncated data -> unknown').toBe('unknown')
		expect(r.isKnown, 'program still labeled').toBe(true)
	})

	test('anchor hint', () => {
		const data = new Uint8Array([0xa1, 0xb2, 0xc3, 0xd4, 0xe5, 0xf6, 0x07, 0x08, 1, 2, 3])
		const r = decodeInstruction(UNKNOWN_PROG, data, K, [0])
		expect(r.type, 'unknown program').toBe('unknown')
		expect(r.isKnown, 'not known').toBe(false)
		expect(r.anchorHint.discriminator, 'discriminator hex').toBe('a1b2c3d4e5f60708')
		expect(r.anchorHint.argBytes, 'args byte count').toBe(3)
		expect(
			r.program.includes('…') || r.program.includes('...'),
			'program shows shortened pubkey',
		).toBe(true)

		const short = decodeInstruction(UNKNOWN_PROG, new Uint8Array([1, 2, 3, 4, 5, 6, 7]), K, [0])
		expect(short.anchorHint, 'no hint under 8 bytes').toBeUndefined()
	})

	test('user label cosmetic only', () => {
		setProgramLabel(UNKNOWN_PROG, 'Acme Labs')
		const r = decodeInstruction(UNKNOWN_PROG, new Uint8Array(12), K, [0])
		expect(r.program, 'user label shown').toBe('Acme Labs')
		expect(r.isKnown, 'user label does NOT set isKnown').toBe(false)
	})
})
