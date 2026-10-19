// Cross-validate PDA derivation without @solana/web3.js: rebuild the hash by hand, check
// off-curve, uniqueness and determinism.
import { describe, expect, test } from 'vitest'
import { isOnCurve, sha256 } from './crypto.js'
import {
	decodeBase58,
	encodeBase58,
	getMultisigVaultPda,
	getProposalPda,
	getTransactionPda,
} from './squads.js'

const SQUADS_PROGRAM = 'SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf'
const programBytes = decodeBase58(SQUADS_PROGRAM)
const PDA_MARKER = new TextEncoder().encode('ProgramDerivedAddress')

describe('PDA derivation deep verification', () => {
	// PDA = SHA256(seed1 || seed2 || ... || [bump] || programId || "ProgramDerivedAddress")
	test('manual hash reconstruction matches the spec', async () => {
		const multisig = decodeBase58('11111111111111111111111111111111')
		const seeds = [
			new TextEncoder().encode('multisig'),
			multisig,
			new TextEncoder().encode('vault'),
			new Uint8Array([0]),
		]

		const [pda, bump] = await getMultisigVaultPda('11111111111111111111111111111111', 0)

		const parts = [...seeds, Uint8Array.from([bump]), programBytes, PDA_MARKER]
		let totalLen = 0
		for (const p of parts) totalLen += p.length
		const buf = new Uint8Array(totalLen)
		let offset = 0
		for (const p of parts) {
			buf.set(p, offset)
			offset += p.length
		}

		const hash = await sha256(buf)

		expect(encodeBase58(hash), 'Manual hash reconstruction matches PDA output').toBe(
			encodeBase58(pda),
		)
		expect(isOnCurve(hash), 'Reconstructed hash is NOT on curve').toBe(false)
	})

	test('different multisig addresses produce different PDAs', async () => {
		const [pda1] = await getTransactionPda('11111111111111111111111111111111', 1)
		const [pda2] = await getTransactionPda(SQUADS_PROGRAM, 1)
		expect(encodeBase58(pda1), 'Different multisig addresses produce different PDAs').not.toBe(
			encodeBase58(pda2),
		)
	})

	test('different indices produce different PDAs', async () => {
		const addr = '11111111111111111111111111111111'
		const pdas = new Set()
		for (let i = 1; i <= 10; i++) {
			const [pda] = await getTransactionPda(addr, i)
			pdas.add(encodeBase58(pda))
		}
		expect(pdas.size, 'Indices 1-10 all produce unique PDAs').toBe(10)
	})

	test('proposal PDA differs from transaction PDA for same index', async () => {
		const [txPda] = await getTransactionPda(SQUADS_PROGRAM, 42)
		const [propPda] = await getProposalPda(SQUADS_PROGRAM, 42)
		expect(encodeBase58(txPda), 'Transaction and Proposal PDAs differ for same index').not.toBe(
			encodeBase58(propPda),
		)
	})

	test('vault PDAs differ for different vault indices', async () => {
		const addr = '11111111111111111111111111111111'
		const [vault0] = await getMultisigVaultPda(addr, 0)
		const [vault1] = await getMultisigVaultPda(addr, 1)
		expect(encodeBase58(vault0), 'Vault PDAs differ for different vault indices').not.toBe(
			encodeBase58(vault1),
		)
	})

	test('determinism across 5 runs', async () => {
		const results = []
		for (let i = 0; i < 5; i++) {
			const [pda, bump] = await getTransactionPda(SQUADS_PROGRAM, 100)
			results.push({ addr: encodeBase58(pda), bump })
		}
		const allSame = results.every((r) => r.addr === results[0].addr && r.bump === results[0].bump)
		expect(allSame, 'PDA derivation is deterministic across 5 runs').toBe(true)
	})

	test('derived transaction PDAs are off-curve', async () => {
		let allOff = true
		for (let i = 1; i <= 20; i++) {
			const [pda] = await getTransactionPda(SQUADS_PROGRAM, i)
			if (isOnCurve(pda)) {
				allOff = false
				break
			}
		}
		expect(allOff, 'All 20 derived transaction PDAs are off-curve').toBe(true)
	})
})
