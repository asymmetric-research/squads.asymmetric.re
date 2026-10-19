<script lang="ts">
import { app } from '../app.svelte'
import { decodeInstruction } from '../decode.js'
import { sanitize } from '../format'
import { activate } from '../keys'
import { inspectProgram } from '../program-info.js'
import { setProgramLabel } from '../program-labels.js'
import { isValidBase58, toHex } from '../squads.js'
import Address from './Address.svelte'

// biome-ignore lint/suspicious/noExplicitAny: decoded message shapes from squads.js
let { ix, message, index }: { ix: any; message: any; index: number } = $props()

const programId = $derived(message.accountKeys[ix.programIdIndex])
const decoded = $derived.by(() => {
	// Local program labels feed the decoded program name
	app.labelsVersion
	return decodeInstruction(programId, ix.data, message.accountKeys, ix.accountIndexes)
})

const badge = $derived.by((): [string, string] => {
	if (decoded.type === 'decoded' && decoded.severity === 'critical') return ['critical', 'Critical']
	if (decoded.type === 'decoded') return ['known', 'Decoded']
	if (decoded.isKnown) return ['known', 'Known']
	return ['unknown', 'Unknown']
})

let open = $state(false)
const toggle = () => (open = !open)

// biome-ignore lint/suspicious/noExplicitAny: program-info.js result
let inspection: { info?: any; error?: string } | null = $state(null)
let inspecting = $state(false)
let label = $state('')

async function inspect(e: MouseEvent) {
	e.stopPropagation()
	inspecting = true
	try {
		inspection = { info: await inspectProgram(app.rpcUrl, decoded.programId) }
	} catch (err) {
		inspection = { error: `Inspection failed: ${(err as Error).message}` }
	} finally {
		inspecting = false
	}
}

function saveLabel(e: MouseEvent) {
	e.stopPropagation()
	setProgramLabel(decoded.programId, label)
	app.labelsVersion++
}

function accountFlags(accIdx: number) {
	return {
		writable:
			accIdx < message.numWritableSigners ||
			(accIdx >= message.numSigners && accIdx < message.numSigners + message.numWritableNonSigners),
		signer: accIdx < message.numSigners,
	}
}
</script>

<div class="ix-card" class:ix-collapsed={!open}>
	<div
		class="ix-summary"
		role="button"
		tabindex="0"
		aria-expanded={open}
		onclick={(e) => {
			e.stopPropagation()
			toggle()
		}}
		onkeydown={activate(toggle)}
	>
		<div class="ix-summary-left">
			<span class="ix-badge {badge[0]}">{badge[1]}</span>
			<span class="ix-summary-text">
				{#if decoded.action}
					<strong>{`${decoded.action}: `}</strong><span>{sanitize(decoded.description)}</span>
				{:else if decoded.anchorHint}
					<span class="ix-anchor-hint"
						>anchor? {decoded.anchorHint.discriminator} · {decoded.anchorHint.argBytes} bytes args</span
					>
				{:else if decoded.description}
					<span>{sanitize(decoded.description)}</span>
				{:else}
					<span>Instruction {index + 1}</span>
				{/if}
			</span>
		</div>
		<span class="ix-program-name" title={decoded.programId}>{sanitize(decoded.program)}</span>
		<span class="ix-chevron">{open ? '▾' : '▸'}</span>
	</div>

	<div class="ix-detail" class:hidden={!open}>
		{#if decoded.details}
			<div class="ix-details">
				{#each Object.entries(decoded.details) as [key, value] (key)}
					{@const v = String(value)}
					<span class="ix-details-key">{key}</span>
					<span class="ix-details-value">
						{#if isValidBase58(v)}<Address pubkey={v} />{:else}{sanitize(v)}{/if}
					</span>
				{/each}
			</div>
		{/if}

		{#if !decoded.isKnown}
			<!-- Unknown program: on-demand inspection + local label -->
			<div class="ix-tools">
				<button class="btn btn-sm" disabled={inspecting} onclick={inspect}
					>{inspecting ? 'Inspecting...' : 'Inspect program'}</button
				>
				<input
					class="ix-label-input"
					type="text"
					maxlength="32"
					placeholder="Local label for this program..."
					bind:value={label}
					onclick={(e) => e.stopPropagation()}
				/>
				<button class="btn btn-ghost btn-sm" onclick={saveLabel}>Save label</button>
			</div>
			<div class="ix-inspect-result" class:hidden={!inspection}>
				{#if inspection?.error}
					{inspection.error}
				{:else if inspection?.info}
					{@const info = inspection.info}
					{#if info.kind === 'upgradeable'}
						<div class={info.upgradeAuthority ? 'ix-inspect-warn' : 'ix-inspect-ok'}>
							{info.upgradeAuthority ? 'Upgradeable program' : 'Immutable program (no upgrade authority)'}
						</div>
						{#if info.upgradeAuthority}
							<div>Upgrade authority: <Address pubkey={info.upgradeAuthority} /></div>
						{/if}
						<div class="text-muted">Last deployed at slot {info.slot}</div>
					{:else if info.kind === 'loader-v2'}
						<div class="ix-inspect-ok">Non-upgradeable program (loader v2)</div>
					{:else if info.kind === 'not-found'}
						<div class="ix-inspect-warn">Account not found on-chain</div>
					{:else if info.kind === 'not-program'}
						<div class="ix-inspect-warn">Not an executable program</div>
					{:else}
						<div>Owned by <Address pubkey={info.owner} /></div>
					{/if}
				{/if}
			</div>
		{/if}

		{#if ix.accountIndexes.length > 0}
			<table class="accounts-table">
				<tbody>
					<tr><th>#</th><th>Account</th><th>Flags</th></tr>
					{#each ix.accountIndexes as accIdx, i (i)}
						{@const flags = accountFlags(accIdx)}
						<tr>
							<td>{i}</td>
							<td><Address pubkey={message.accountKeys[accIdx] || '?'} /></td>
							<td
								>{#if flags.writable}<span class="flag flag-w">W</span>{/if}{#if flags.signer}<span
										class="flag flag-s">S</span
									>{/if}</td
							>
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}

		{#if ix.data && ix.data.length > 0}
			<div class="ix-raw-label">Raw data</div>
			<div class="raw-hex">{toHex(ix.data)}</div>
		{/if}
	</div>
</div>
