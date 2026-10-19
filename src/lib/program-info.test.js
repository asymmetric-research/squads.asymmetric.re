// On-chain program inspection against a mocked JSON-RPC endpoint.
import { describe, expect, test, vi } from 'vitest'
import { decodeBase58 } from './squads.js'

const UPGRADEABLE_LOADER = 'BPFLoaderUpgradeab1e11111111111111111111111'
const LOADER_V2 = 'BPFLoader2111111111111111111111111111111111'
const PROG = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4'
const PROG_V2 = 'MarBmsSgKXdrN1egZf5sqe1TMThczhMLJhMpbeVbnoB'
const PROG_MISSING = 'BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY'
const PROGDATA = '8Sr4rQJL2aQT3EL97mbrk1T9VMw4pCS2mxMPp2QBzHQq'
const AUTHORITY = 'nigmAPDCZMVDW4wneBBcc6wjY6Ufjv7iLJc2mRvs8PS'
const WALLET = 'nix9RErnQYXpuf329ntPgSzThogtfeyUempD7zDrnSH'

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

// Same vectors as squadit's bpf_loader.rs tests.
const programAccountData = cat(u32le(2), decodeBase58(PROGDATA))
const programDataWithAuthority = cat(
	u32le(3),
	u64le(271828182),
	new Uint8Array([1]),
	decodeBase58(AUTHORITY),
)
const programDataFrozen = cat(u32le(3), u64le(42), new Uint8Array([0]))

let frozenMode = false
let rpcCalls = 0
const dataSliceByAddress = new Map()
const accounts = () =>
	new Map([
		[PROG, { owner: UPGRADEABLE_LOADER, executable: true, data: programAccountData }],
		[
			PROGDATA,
			{
				owner: UPGRADEABLE_LOADER,
				executable: false,
				data: frozenMode ? programDataFrozen : programDataWithAuthority,
			},
		],
		[PROG_V2, { owner: LOADER_V2, executable: true, data: new Uint8Array([1]) }],
		[
			WALLET,
			{ owner: '11111111111111111111111111111111', executable: false, data: new Uint8Array(0) },
		],
	])

vi.stubGlobal('fetch', async (_url, opts = {}) => {
	rpcCalls++
	const { method, params } = JSON.parse(opts.body)
	if (method !== 'getAccountInfo') throw new Error(`unexpected method ${method}`)
	const acc = accounts().get(params[0])
	dataSliceByAddress.set(params[0], params[1]?.dataSlice ?? null)
	const slice = params[1]?.dataSlice
	const data = acc && slice ? acc.data.slice(slice.offset, slice.offset + slice.length) : acc?.data
	const value = acc
		? {
				owner: acc.owner,
				executable: acc.executable,
				lamports: 1,
				data: [Buffer.from(data).toString('base64'), 'base64'],
			}
		: null
	return {
		ok: true,
		text: async () => JSON.stringify({ jsonrpc: '2.0', id: 1, result: { value } }),
	}
})

const { decodeUpgradeableLoaderAccount, inspectProgram, _clearInspectCache } = await import(
	'./program-info.js'
)

// Sections share the inspect cache, the RPC call counter and frozenMode, and run in order.
describe('program info', () => {
	test('loader account decode (squadit fixtures)', () => {
		expect(decodeUpgradeableLoaderAccount(programAccountData).tag, 'program tag').toBe('program')
		expect(
			decodeUpgradeableLoaderAccount(programAccountData).programData,
			'programdata address',
		).toBe(PROGDATA)
		const pd = decodeUpgradeableLoaderAccount(programDataWithAuthority)
		expect(pd.tag, 'programdata tag').toBe('programdata')
		expect(pd.slot, 'slot').toBe(271828182n)
		expect(pd.upgradeAuthority, 'authority').toBe(AUTHORITY)
		const frozen = decodeUpgradeableLoaderAccount(programDataFrozen)
		expect(frozen.upgradeAuthority, 'frozen authority = null').toBeNull()
		expect(decodeUpgradeableLoaderAccount(cat(u32le(0))).tag, 'uninitialized').toBe('uninitialized')
		expect(
			() => decodeUpgradeableLoaderAccount(new Uint8Array([1, 2])),
			'short data throws',
		).toThrow()
	})

	test('inspectProgram', async () => {
		const info = await inspectProgram('https://mock', PROG)
		expect(info.kind, 'upgradeable').toBe('upgradeable')
		expect(info.upgradeAuthority, 'authority surfaced').toBe(AUTHORITY)
		expect(info.slot, 'slot surfaced as string').toBe('271828182')
		expect(info.programData, 'programdata surfaced').toBe(PROGDATA)
		const slice = dataSliceByAddress.get(PROGDATA)
		expect(slice, 'programdata fetched with 45-byte dataSlice, not in full').toMatchObject({
			offset: 0,
			length: 45,
		})

		const before = rpcCalls
		await inspectProgram('https://mock', PROG)
		expect(rpcCalls, 'second call served from cache').toBe(before)

		expect((await inspectProgram('https://mock', PROG_V2)).kind, 'loader v2').toBe('loader-v2')
		expect(
			(await inspectProgram('https://mock', WALLET)).kind,
			'non-executable = not a program',
		).toBe('not-program')
		expect((await inspectProgram('https://mock', PROG_MISSING)).kind, 'missing account').toBe(
			'not-found',
		)
	})

	test('frozen program', async () => {
		_clearInspectCache()
		frozenMode = true
		const info = await inspectProgram('https://mock', PROG)
		expect(info.upgradeAuthority, 'frozen = null authority').toBeNull()
	})
})
