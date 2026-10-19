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

const { getProgramLabel, setProgramLabel, reloadProgramLabels } = await import(
	'./program-labels.js'
)

const PROG_A = 'FakeProgram1111111111111111111111111111111'
const PROG_B = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4'

// Sections share the module's label cache and run in order.
describe('program labels', () => {
	test('program labels', () => {
		expect(getProgramLabel(PROG_A), 'unset label is null').toBeNull()

		setProgramLabel(PROG_A, 'Acme Labs')
		expect(getProgramLabel(PROG_A), 'label round-trips').toBe('Acme Labs')
		expect(getProgramLabel(PROG_B), 'other program unaffected').toBeNull()

		setProgramLabel(PROG_A, 'x'.repeat(100))
		expect(getProgramLabel(PROG_A).length, 'label capped at 32 chars').toBe(32)

		setProgramLabel(PROG_A, '   ')
		expect(getProgramLabel(PROG_A), 'whitespace label deletes entry').toBeNull()

		setProgramLabel(PROG_B, 'Jupiter mine')
		reloadProgramLabels()
		expect(getProgramLabel(PROG_B), 'labels survive cache reload').toBe('Jupiter mine')
	})

	test('corrupt data', () => {
		storage.set('programLabels', 'not json{{{')
		reloadProgramLabels()
		expect(getProgramLabel(PROG_B), 'corrupt JSON treated as empty').toBeNull()

		storage.set('programLabels', JSON.stringify([1, 2]))
		reloadProgramLabels()
		expect(getProgramLabel(PROG_B), 'array at top level treated as empty').toBeNull()

		storage.set('programLabels', JSON.stringify({ [PROG_B]: 42 }))
		reloadProgramLabels()
		expect(getProgramLabel(PROG_B), 'non-string label dropped').toBeNull()
	})

	test('quota', () => {
		storage.delete('programLabels')
		reloadProgramLabels()
		quotaExceeded = true
		try {
			const { persisted } = setProgramLabel(PROG_A, 'Session only')
			expect(persisted, 'reports persistence failure').toBe(false)
			expect(getProgramLabel(PROG_A), 'label retained in memory').toBe('Session only')
		} finally {
			quotaExceeded = false
		}
	})
})
