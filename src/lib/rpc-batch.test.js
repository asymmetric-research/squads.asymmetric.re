// fetchMultisigBatch against a mocked JSON-RPC endpoint.
import { describe, expect, test, vi } from 'vitest'
import { decodeBase58, MULTISIG_DISCRIMINATOR } from './squads.js'

const MEMBER = 'So11111111111111111111111111111111111111112'
const MS_GOOD = '8Sr4rQJL2aQT3EL97mbrk1T9VMw4pCS2mxMPp2QBzHQq'
const MS_MISSING = 'MarBmsSgKXdrN1egZf5sqe1TMThczhMLJhMpbeVbnoB'
const MS_GARBAGE = 'BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY'

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

const multisigData = concat([
	MULTISIG_DISCRIMINATOR,
	decodeBase58(MEMBER), // create_key
	new Uint8Array(32), // config_authority
	leBytes(2, 2), // threshold
	leBytes(0, 4), // time_lock
	leBytes(5, 8), // transaction_index
	leBytes(0, 8), // stale_transaction_index
	new Uint8Array([0]), // rent_collector: None
	new Uint8Array([254]), // bump
	leBytes(1, 4), // members: len 1
	decodeBase58(MEMBER),
	new Uint8Array([7]),
])

const accounts = new Map([
	[MS_GOOD, multisigData],
	[MS_GARBAGE, new Uint8Array(64)], // wrong discriminator
])

let rpcCalls = 0
vi.stubGlobal('fetch', async (_url, opts = {}) => {
	rpcCalls++
	const { method, params } = JSON.parse(opts.body)
	if (method !== 'getMultipleAccounts') throw new Error(`unexpected method ${method}`)
	const value = params[0].map((addr) => {
		const data = accounts.get(addr)
		if (!data) return null
		return {
			owner: 'x',
			lamports: 1,
			data: [Buffer.from(data).toString('base64'), 'base64'],
			executable: false,
		}
	})
	return {
		ok: true,
		text: async () => JSON.stringify({ jsonrpc: '2.0', id: 1, result: { value } }),
	}
})

const { fetchMultisigBatch } = await import('./rpc.js')

describe('fetchMultisigBatch', () => {
	test('fetchMultisigBatch', async () => {
		const results = await fetchMultisigBatch('https://mock', [MS_GOOD, MS_MISSING, MS_GARBAGE])
		expect(results.length, 'one result per input address').toBe(3)
		expect(results[0].address, 'results keep input order').toBe(MS_GOOD)
		expect(results[0].multisig, 'valid account deserializes').not.toBeNull()
		expect(results[0].multisig.threshold, 'threshold parsed').toBe(2)
		expect(results[0].error, 'no error for valid account').toBeNull()
		expect(results[1].multisig, 'missing account yields null multisig').toBeNull()
		expect(results[1].error, 'missing account yields an error string').not.toBeNull()
		expect(results[2].multisig, 'garbage account yields null multisig').toBeNull()
		expect(
			String(results[2].error).length,
			'garbage account yields an error string',
		).toBeGreaterThan(0)

		const empty = await fetchMultisigBatch('https://mock', [])
		expect(empty.length, 'empty input returns empty output').toBe(0)
		expect(rpcCalls, 'empty input makes no RPC call').toBe(1)
	})
})
