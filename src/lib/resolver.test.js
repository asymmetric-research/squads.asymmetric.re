// Resolver: with a mocked JSON-RPC endpoint, vault / create-key / proposal / transaction
// addresses resolve to the parent multisig account.
import { beforeAll, describe, expect, test, vi } from 'vitest'
import {
	decodeBase58,
	encodeBase58,
	getMultisigPda,
	getMultisigVaultPda,
	MULTISIG_DISCRIMINATOR,
	PROGRAM_ID,
	PROPOSAL_DISCRIMINATOR,
	VAULT_TX_DISCRIMINATOR,
} from './squads.js'

// Pinned mainnet pair (same vector as squadit's derive_multisig_pda test).
const CREATE_KEY = '6tgdsFTVeXeBULCUtg48djFUk4Fsij8xtz7ZMzrNyyRo'
const MULTISIG = '8Sr4rQJL2aQT3EL97mbrk1T9VMw4pCS2mxMPp2QBzHQq'
const MEMBER = 'So11111111111111111111111111111111111111112'
const SYSTEM = '11111111111111111111111111111111'
const PROPOSAL_ADDR = 'MarBmsSgKXdrN1egZf5sqe1TMThczhMLJhMpbeVbnoB'
const VAULT_TX_ADDR = 'BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY'
const WALLET_ADDR = 'nigmAPDCZMVDW4wneBBcc6wjY6Ufjv7iLJc2mRvs8PS'
const UNKNOWN_ADDR = 'nix9RErnQYXpuf329ntPgSzThogtfeyUempD7zDrnSH'

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

function serializeMultisig(createKey, memberCount = 1) {
	const members = [leBytes(memberCount, 4)]
	for (let i = 0; i < memberCount; i++) {
		members.push(decodeBase58(MEMBER), new Uint8Array([7]))
	}
	return concat([
		MULTISIG_DISCRIMINATOR,
		decodeBase58(createKey), // create_key
		new Uint8Array(32), // config_authority
		leBytes(2, 2), // threshold
		leBytes(0, 4), // time_lock
		leBytes(5, 8), // transaction_index
		leBytes(0, 8), // stale_transaction_index
		new Uint8Array([0]), // rent_collector: None
		new Uint8Array([254]), // bump
		...members,
	])
}

function serializeProposal(multisig) {
	return concat([
		PROPOSAL_DISCRIMINATOR,
		decodeBase58(multisig),
		leBytes(3, 8), // transaction_index
		new Uint8Array([1]), // status tag: Active
		leBytes(1700000000, 8), // status timestamp
		new Uint8Array([255]), // bump
		leBytes(0, 4), // approved: []
		leBytes(0, 4), // rejected: []
		leBytes(0, 4), // cancelled: []
	])
}

function serializeVaultTransaction(multisig) {
	return concat([
		VAULT_TX_DISCRIMINATOR,
		decodeBase58(multisig),
		decodeBase58(MEMBER), // creator
		leBytes(3, 8), // index
		new Uint8Array([255]), // bump
		new Uint8Array([0]), // vault_index
		new Uint8Array([255]), // vault_bump
		leBytes(0, 4), // ephemeral_signer_bumps: []
		// message
		new Uint8Array([1, 1, 0]), // num_signers, num_writable_signers, num_writable_non_signers
		leBytes(0, 4), // account_keys: []
		leBytes(0, 4), // instructions: []
		leBytes(0, 4), // address_table_lookups: []
	])
}

const accounts = new Map() // base58 → { owner, lamports, data }
const signatures = new Map() // base58 → [{ signature }]
const transactions = new Map() // signature → accountKeys[]

function accountValue(addr) {
	const acc = accounts.get(addr)
	if (!acc) return null
	return {
		owner: acc.owner,
		lamports: acc.lamports ?? 1,
		data: [Buffer.from(acc.data).toString('base64'), 'base64'],
		executable: false,
	}
}

let squadsApiCalls = 0
let squadsApiResponse = null // set to { address } to simulate an API hit
async function mockFetch(url, opts = {}) {
	if (String(url).startsWith('https://v4-api.squads.so/')) {
		squadsApiCalls++
		if (squadsApiResponse) {
			return { ok: true, status: 200, json: async () => squadsApiResponse }
		}
		return { ok: false, status: 404, json: async () => ({}) }
	}

	const { method, params } = JSON.parse(opts.body)
	let result
	switch (method) {
		case 'getAccountInfo':
			result = { value: accountValue(params[0]) }
			break
		case 'getMultipleAccounts':
			result = { value: params[0].map(accountValue) }
			break
		case 'getSignaturesForAddress':
			result = signatures.get(params[0]) || []
			break
		case 'getTransaction': {
			const keys = transactions.get(params[0])
			result = keys
				? {
						transaction: { message: { accountKeys: keys } },
						meta: { loadedAddresses: { writable: [], readonly: [] } },
					}
				: null
			break
		}
		default:
			throw new Error(`mock RPC: unexpected method ${method}`)
	}
	return {
		ok: true,
		text: async () => JSON.stringify({ jsonrpc: '2.0', id: 1, result }),
	}
}
vi.stubGlobal('fetch', mockFetch)

const { resolveMultisigAddress } = await import('./resolver.js')
const RPC = 'https://mock.rpc'

let VAULT_0
let VAULT_5

beforeAll(async () => {
	const [vault0Bytes] = await getMultisigVaultPda(MULTISIG, 0)
	VAULT_0 = encodeBase58(vault0Bytes)
	const [vault5Bytes] = await getMultisigVaultPda(MULTISIG, 5)
	VAULT_5 = encodeBase58(vault5Bytes)

	accounts.set(MULTISIG, { owner: PROGRAM_ID, data: serializeMultisig(CREATE_KEY) })
	accounts.set(VAULT_0, { owner: SYSTEM, data: new Uint8Array(0), lamports: 1_000_000 })
	accounts.set(PROPOSAL_ADDR, { owner: PROGRAM_ID, data: serializeProposal(MULTISIG) })
	accounts.set(VAULT_TX_ADDR, { owner: PROGRAM_ID, data: serializeVaultTransaction(MULTISIG) })
	accounts.set(WALLET_ADDR, { owner: SYSTEM, data: new Uint8Array(0), lamports: 42 })

	signatures.set(VAULT_0, [{ signature: 'vault0-sig' }])
	transactions.set('vault0-sig', [VAULT_0, SYSTEM, MULTISIG])
	// VAULT_5 has no on-chain account (never funded) but has tx history.
	signatures.set(VAULT_5, [{ signature: 'vault5-noise-sig' }, { signature: 'vault5-sig' }])
	transactions.set('vault5-noise-sig', [VAULT_5, SYSTEM])
	transactions.set('vault5-sig', [VAULT_5, MULTISIG])
})

// Sections share the mock chain state and the Squads API call counter, and run in order.
describe('resolver', () => {
	test('Multisig PDA derivation (pinned mainnet vector)', async () => {
		const [pdaBytes] = await getMultisigPda(CREATE_KEY)
		expect(
			encodeBase58(pdaBytes),
			'getMultisigPda(create_key) matches known mainnet multisig',
		).toBe(MULTISIG)
	})

	test('Direct multisig address', async () => {
		const r = await resolveMultisigAddress(RPC, MULTISIG)
		expect(r.type, 'direct: type is multisig').toBe('multisig')
		expect(r.multisigAddress, 'direct: address unchanged').toBe(MULTISIG)
		expect(r.resolvedFrom, 'direct: not marked as resolved-from').toBeFalsy()
	})

	test('create_key → multisig', async () => {
		const r = await resolveMultisigAddress(RPC, CREATE_KEY)
		expect(r.type, 'create_key: type is multisig').toBe('multisig')
		expect(r.multisigAddress, 'create_key: resolves to multisig PDA').toBe(MULTISIG)
		expect(r.resolvedFrom, 'create_key: resolvedFrom is input').toBe(CREATE_KEY)
		expect(r.via, 'create_key: via label').toBe('create key')
	})

	test('vault → multisig (via recent tx, index 0)', async () => {
		const r = await resolveMultisigAddress(RPC, VAULT_0)
		expect(r.type, 'vault0: type is multisig').toBe('multisig')
		expect(r.multisigAddress, 'vault0: resolves to parent multisig').toBe(MULTISIG)
		expect(r.vaultIndex, 'vault0: vault index 0 confirmed by PDA re-derivation').toBe(0)
	})

	test('vault → multisig (unfunded vault, index 5)', async () => {
		const r = await resolveMultisigAddress(RPC, VAULT_5)
		expect(r.type, 'vault5: type is multisig').toBe('multisig')
		expect(r.multisigAddress, 'vault5: resolves to parent multisig').toBe(MULTISIG)
		expect(r.vaultIndex, 'vault5: vault index 5 confirmed by PDA re-derivation').toBe(5)
	})

	test('proposal account → multisig', async () => {
		const r = await resolveMultisigAddress(RPC, PROPOSAL_ADDR)
		expect(r.type, 'proposal: type is multisig').toBe('multisig')
		expect(r.multisigAddress, 'proposal: resolves to parent multisig').toBe(MULTISIG)
		expect(r.via, 'proposal: via label').toBe('proposal')
	})

	test('vault transaction account → multisig', async () => {
		const r = await resolveMultisigAddress(RPC, VAULT_TX_ADDR)
		expect(r.type, 'vault tx: type is multisig').toBe('multisig')
		expect(r.multisigAddress, 'vault tx: resolves to parent multisig').toBe(MULTISIG)
		expect(r.via, 'vault tx: via label').toBe('vault transaction')
	})

	test('unrelated wallet', async () => {
		const r = await resolveMultisigAddress(RPC, WALLET_ADDR)
		expect(r.type, 'wallet: type is wallet').toBe('wallet')
		expect(squadsApiCalls, 'wallet: Squads API fallback was attempted').toBeGreaterThan(0)
	})

	test('nonexistent address', async () => {
		await expect(resolveMultisigAddress(RPC, UNKNOWN_ADDR), 'nonexistent: throws').rejects.toThrow()
	})

	test('Squads API fallback: unrelated multisig is rejected', async () => {
		// A wallet with no tx history; API claims MULTISIG is its parent, but the
		// wallet is not a vault of MULTISIG — the on-chain check must reject it.
		squadsApiResponse = { address: MULTISIG }
		try {
			const r = await resolveMultisigAddress(RPC, WALLET_ADDR)
			expect(r.type, 'api-unrelated: rejected, stays wallet').toBe('wallet')
		} finally {
			squadsApiResponse = null
		}
	})

	test('Squads API fallback: true parent is accepted', async () => {
		// A funded vault (index 3) with NO transaction history — only the API path
		// can resolve it, and the vault-PDA re-derivation must confirm the answer.
		const [vault3Bytes] = await getMultisigVaultPda(MULTISIG, 3)
		const VAULT_3 = encodeBase58(vault3Bytes)
		accounts.set(VAULT_3, { owner: SYSTEM, data: new Uint8Array(0), lamports: 777 })
		squadsApiResponse = { address: MULTISIG }
		try {
			const r = await resolveMultisigAddress(RPC, VAULT_3)
			expect(r.type, 'api-verified: type is multisig').toBe('multisig')
			expect(r.multisigAddress, 'api-verified: resolves to parent multisig').toBe(MULTISIG)
			expect(r.vaultIndex, 'api-verified: vault index confirmed by PDA re-derivation').toBe(3)
		} finally {
			squadsApiResponse = null
		}
	})

	test('hostile RPC shapes do not crash resolution', async () => {
		// Null / malformed signature entries must be skipped, not destructured.
		const NULLSIG_ADDR = '2JLq2HWYLws938d3vZwS2r8Qex1FJJeXoF2KViPCZoyv'
		accounts.set(NULLSIG_ADDR, { owner: SYSTEM, data: new Uint8Array(0), lamports: 1 })
		signatures.set(NULLSIG_ADDR, [null, { bogus: 1 }, { signature: 12345 }])
		const r = await resolveMultisigAddress(RPC, NULLSIG_ADDR)
		expect(r.type, 'null signature entries: skipped without throwing').toBe('wallet')

		// Garbage base64 in account data must be treated as a missing account.
		const GARBAGE_ADDR = '3LPh9LN88kxSe3shxLZ2R4jiNmHh2U2F9h9TmVKjc18P'
		vi.stubGlobal('fetch', async (url, opts = {}) => {
			if (
				opts.body &&
				JSON.parse(opts.body).method === 'getAccountInfo' &&
				JSON.parse(opts.body).params[0] === GARBAGE_ADDR
			) {
				return {
					ok: true,
					text: async () =>
						JSON.stringify({
							jsonrpc: '2.0',
							id: 1,
							result: {
								value: { owner: PROGRAM_ID, lamports: 1, data: ['!!!not-base64!!!', 'base64'] },
							},
						}),
				}
			}
			return mockFetch(url, opts)
		})
		try {
			await expect(
				resolveMultisigAddress(RPC, GARBAGE_ADDR),
				'garbage base64 data: treated as missing account, no atob crash',
			).rejects.toThrow(/not found/i)
		} finally {
			vi.stubGlobal('fetch', mockFetch)
		}
	})

	test('non-system-owned account skips the vault history scan', async () => {
		// An account owned by an unrelated program cannot be a vault, so its
		// transaction history must NOT be scanned. Use vault PDA index 9 but give
		// it a non-system owner: without the gate this WOULD resolve via history,
		// so 'unknown' here proves the scan was skipped.
		const [vault9Bytes] = await getMultisigVaultPda(MULTISIG, 9)
		const VAULT_9_FOREIGN = encodeBase58(vault9Bytes)
		accounts.set(VAULT_9_FOREIGN, {
			owner: 'BPFLoaderUpgradeab1e11111111111111111111111',
			data: new Uint8Array([1, 2, 3]),
		})
		signatures.set(VAULT_9_FOREIGN, [{ signature: 'foreign-vault-sig' }])
		transactions.set('foreign-vault-sig', [VAULT_9_FOREIGN, MULTISIG])
		const r = await resolveMultisigAddress(RPC, VAULT_9_FOREIGN)
		expect(r.type, 'program-owned vault PDA: history scan skipped, type is unknown').toBe('unknown')
	})

	test('large multisig (>256 members) still decodes', async () => {
		const BIG_MS = '4vK6sVXQNkiEY1wyqx9Q44JxMGRHS9XJ6NoavaZwzGLE'
		accounts.set(BIG_MS, { owner: PROGRAM_ID, data: serializeMultisig(CREATE_KEY, 300) })
		const r = await resolveMultisigAddress(RPC, BIG_MS)
		expect(r.type, 'large multisig: resolves directly').toBe('multisig')
		expect(r.multisigAddress, 'large multisig: address unchanged').toBe(BIG_MS)
	})
})
