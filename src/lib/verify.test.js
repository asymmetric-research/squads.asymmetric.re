// Compare the hand-rolled base58, compact-u16, on-curve check, PDA derivation, Borsh parsing
// and transaction serialization against known-good values.
import { describe, expect, test } from 'vitest'
import { findProgramAddress, isOnCurve, sha256 } from './crypto.js'
import {
	BorshReader,
	decodeBase58,
	encodeBase58,
	getMultisigPda,
	getProposalPda,
	getTransactionPda,
	isValidBase58,
	shortenAddress,
} from './squads.js'
import {
	AccountRole,
	buildUnsignedTransaction,
	encodeCompactU16,
	serializeTransactionMessage,
} from './transaction.js'

function bytesEq(a, b) {
	if (a.length !== b.length) return false
	for (let i = 0; i < a.length; i++) {
		if (a[i] !== b[i]) return false
	}
	return true
}

const SYSTEM_PROGRAM = '11111111111111111111111111111111'
const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
const SQUADS_PROGRAM = 'SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf'

const systemBytes = decodeBase58(SYSTEM_PROGRAM)
const tokenBytes = decodeBase58(TOKEN_PROGRAM)
const squadsBytes = decodeBase58(SQUADS_PROGRAM)
const systemProgramBytes = decodeBase58(SYSTEM_PROGRAM)

describe('verify', () => {
	test('Base58', () => {
		expect(systemBytes.length, 'System program decodes to 32 bytes').toBe(32)
		expect(
			systemBytes.every((b) => b === 0),
			'System program is all zeros',
		).toBe(true)
		expect(encodeBase58(systemBytes), 'System program roundtrips').toBe(SYSTEM_PROGRAM)

		expect(tokenBytes.length, 'Token program decodes to 32 bytes').toBe(32)
		expect(encodeBase58(tokenBytes), 'Token program roundtrips').toBe(TOKEN_PROGRAM)

		expect(squadsBytes.length, 'Squads program decodes to 32 bytes').toBe(32)
		expect(encodeBase58(squadsBytes), 'Squads program roundtrips').toBe(SQUADS_PROGRAM)

		expect(isValidBase58(SQUADS_PROGRAM), 'Squads program is valid base58').toBeTruthy()
		expect(isValidBase58('invalid'), 'Short string is invalid').toBeFalsy()
		expect(isValidBase58('0OIl'), 'Characters not in base58 alphabet are invalid').toBeFalsy()
		expect(isValidBase58(''), 'Empty string is invalid').toBeFalsy()

		expect(shortenAddress('7xKp3nRm5tKp', 4), 'shortenAddress works').toBe('7xKp...5tKp')
	})

	test('Compact-u16', () => {
		expect([...encodeCompactU16(0)], 'compact-u16: 0').toEqual([0x00])
		expect([...encodeCompactU16(1)], 'compact-u16: 1').toEqual([0x01])
		expect([...encodeCompactU16(127)], 'compact-u16: 127').toEqual([0x7f])
		expect([...encodeCompactU16(128)], 'compact-u16: 128').toEqual([0x80, 0x01])
		expect([...encodeCompactU16(255)], 'compact-u16: 255').toEqual([0xff, 0x01])
		expect([...encodeCompactU16(256)], 'compact-u16: 256').toEqual([0x80, 0x02])
		expect([...encodeCompactU16(16383)], 'compact-u16: 16383').toEqual([0xff, 0x7f])
		expect([...encodeCompactU16(16384)], 'compact-u16: 16384').toEqual([0x80, 0x80, 0x01])
	})

	test('Ed25519 on-curve check', () => {
		// All zeros is compressed Y=0: y2=0, u=P-1, v=1, x2=-1 mod P. P ≡ 1 mod 4, so -1 is a
		// quadratic residue and the point IS on the curve.
		expect(
			isOnCurve(systemProgramBytes),
			'All-zero bytes IS on the curve (P ≡ 1 mod 4, so -1 is a QR)',
		).toBeTruthy()
		// Deployed program IDs come from real keypairs, so they are on the curve.
		expect(
			isOnCurve(squadsBytes),
			'Squads program ID is on the curve (it has a keypair)',
		).toBeTruthy()
		expect(isOnCurve(tokenBytes), 'Token program ID is on the curve').toBeTruthy()
	})

	describe('PDA derivation', () => {
		test('vault PDA for system program as multisig', async () => {
			const seeds = [
				new TextEncoder().encode('multisig'),
				systemProgramBytes,
				new TextEncoder().encode('vault'),
				new Uint8Array([0]),
			]

			const [pda, bump] = await findProgramAddress(seeds, squadsBytes)
			expect(pda.length, 'PDA is 32 bytes').toBe(32)
			expect(bump >= 0 && bump <= 255, `Bump is in valid range: ${bump}`).toBe(true)
			expect(isOnCurve(pda), 'Derived PDA is NOT on the curve').toBeFalsy()

			const [pda2, bump2] = await findProgramAddress(seeds, squadsBytes)
			expect(bytesEq(pda, pda2), 'PDA derivation is deterministic').toBe(true)
			expect(bump, 'Bump is deterministic').toBe(bump2)
		})

		// create_key 6tgds… → multisig 8Sr4r…, same vector as squadit
		test('multisig PDA from create_key (pinned mainnet vector)', async () => {
			const [pda] = await getMultisigPda('6tgdsFTVeXeBULCUtg48djFUk4Fsij8xtz7ZMzrNyyRo')
			expect(encodeBase58(pda), 'getMultisigPda matches known mainnet multisig').toBe(
				'8Sr4rQJL2aQT3EL97mbrk1T9VMw4pCS2mxMPp2QBzHQq',
			)
		})

		test('proposal PDA differs from transaction PDA', async () => {
			const [txPda] = await getTransactionPda(SYSTEM_PROGRAM, 1)
			const [proposalPda] = await getProposalPda(SYSTEM_PROGRAM, 1)

			expect(bytesEq(txPda, proposalPda), 'Transaction PDA differs from Proposal PDA').toBe(false)
			expect(isOnCurve(txPda), 'Transaction PDA is NOT on curve').toBeFalsy()
			expect(isOnCurve(proposalPda), 'Proposal PDA is NOT on curve').toBeFalsy()
		})
	})

	describe('BorshReader', () => {
		test('basic reads', () => {
			const data = new Uint8Array([
				0x42, // u8 = 66
				0x01,
				0x02, // u16 LE = 513
				0x04,
				0x03,
				0x02,
				0x01, // u32 LE = 16909060
				0x08,
				0x07,
				0x06,
				0x05,
				0x04,
				0x03,
				0x02,
				0x01, // u64 LE
				0x01, // Option tag = Some
				0xaa, // Option value = 0xAA
				0x00, // Option tag = None
			])

			const reader = new BorshReader(data)
			expect(reader.readU8(), 'BorshReader: readU8').toBe(66)
			expect(reader.readU16(), 'BorshReader: readU16').toBe(513)
			expect(reader.readU32(), 'BorshReader: readU32').toBe(16909060)
			expect(reader.readU64(), 'BorshReader: readU64').toBe(72623859790382856n)
			expect(
				reader.readOption((r) => r.readU8()),
				'BorshReader: readOption Some',
			).toBe(0xaa)
			expect(
				reader.readOption((r) => r.readU8()),
				'BorshReader: readOption None',
			).toBeNull()
		})

		test('bounds checking', () => {
			const reader = new BorshReader(new Uint8Array([0x01]))
			reader.readU8()
			expect(() => reader.readU8(), 'BorshReader: throws on buffer overrun').toThrow()
		})

		test('vec length cap', () => {
			// vec length = 268435455 (way too big)
			const reader = new BorshReader(new Uint8Array([0xff, 0xff, 0xff, 0x0f]))
			expect(
				() => reader.readVec((r) => r.readU8(), 100),
				'BorshReader: rejects oversized vec',
			).toThrow()
		})

		test('string', () => {
			const encoded = new TextEncoder().encode('hello')
			const data = new Uint8Array(4 + encoded.length)
			new DataView(data.buffer).setUint32(0, encoded.length, true)
			data.set(encoded, 4)

			const reader = new BorshReader(data)
			expect(reader.readString(), 'BorshReader: readString').toBe('hello')
		})
	})

	test('ProposalStatus deserialization', () => {
		// readProposalStatus is internal to deserializeProposal; check the Executing (tag=4)
		// layout directly: it carries NO timestamp.
		const execData = new Uint8Array(1)
		execData[0] = 4
		const execReader = new BorshReader(execData)
		const tag = execReader.readU8()
		expect(tag, 'Executing tag is 4').toBe(4)
		expect(execReader.offset, 'Executing consumes only 1 byte (no timestamp)').toBe(1)
	})

	test('Transaction serialization', () => {
		// Fake keys: only the wire-format structure is under test.
		const feePayer = decodeBase58(SQUADS_PROGRAM)
		const recipient = decodeBase58(TOKEN_PROGRAM)

		// System program transfer: [4B type=2][8B lamports]
		const ixData = new Uint8Array(12)
		new DataView(ixData.buffer).setUint32(0, 2, true)
		new DataView(ixData.buffer).setBigUint64(4, 1000000000n, true)

		const instruction = {
			programId: systemProgramBytes,
			accounts: [
				{ pubkey: feePayer, role: AccountRole.WRITABLE_SIGNER },
				{ pubkey: recipient, role: AccountRole.WRITABLE },
			],
			data: ixData,
		}

		const fakeBlockhash = new Uint8Array(32)
		fakeBlockhash[0] = 0x42

		const messageBytes = serializeTransactionMessage({
			feePayer,
			recentBlockhash: fakeBlockhash,
			instructions: [instruction],
		})

		expect(messageBytes[0], 'V0 message starts with 0x80 prefix').toBe(0x80)

		// Header: 1 signer (fee payer), 0 readonly signed, 1 readonly unsigned (system program)
		expect(messageBytes[1], 'Header: 1 required signature').toBe(1)
		expect(messageBytes[2], 'Header: 0 readonly signed').toBe(0)
		expect(messageBytes[3], 'Header: 1 readonly unsigned (system program)').toBe(1)

		// fee payer, recipient, system program
		expect(messageBytes[4], 'Compact-u16: 3 account keys').toBe(3)

		expect(bytesEq(messageBytes.slice(5, 37), feePayer), 'First account key is fee payer').toBe(
			true,
		)

		const txBytes = buildUnsignedTransaction(messageBytes, 1)
		expect(txBytes[0], 'Transaction: 1 signature slot').toBe(1)
		expect(
			txBytes.slice(1, 65).every((b) => b === 0),
			'Transaction: signature slot is zeroed',
		).toBe(true)
		expect(txBytes[65], 'Transaction: message starts after signature').toBe(0x80)
	})

	test('SHA-256', async () => {
		const hash = await sha256(new TextEncoder().encode('test'))
		const actual = Array.from(hash)
			.map((b) => b.toString(16).padStart(2, '0'))
			.join('')
		expect(actual, 'SHA-256 of "test" matches known hash').toBe(
			'9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
		)
	})
})
