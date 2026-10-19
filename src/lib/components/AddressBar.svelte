<script lang="ts" module>
// Module-level so a remounted bar still sees a resolution started by the
// previous one, rather than racing it to switch + reload.
let resolveInFlight: string | null = $state(null)
</script>

<script lang="ts">
	import { app, onRefresh, setMultisigAddress } from '../app.svelte'
	import { resolveMultisigAddress } from '../resolver.js'
	import { isValidBase58 } from '../squads.js'
	import { showToast } from '../toasts.svelte'

	let value = $state(resolveInFlight ?? app.multisigAddress)
	let failure = $state('')

	const trimmed = $derived(value.trim())
	const changed = $derived(trimmed !== app.multisigAddress)
	const valid = $derived(isValidBase58(trimmed))

	// After a failed resolution the hint stays until the input changes.
	let failedFor: string | null = $state(null)
	const showFailure = $derived(failedFor !== null && failedFor === trimmed)

	async function switchMultisig(val: string) {
		if (resolveInFlight) return
		resolveInFlight = val
		failedFor = null
		try {
			const resolved = await resolveMultisigAddress(app.rpcUrl, val)
			if (resolved.type === 'multisig' && resolved.multisigAddress) {
				setMultisigAddress(resolved.multisigAddress)
				location.reload()
				return
			}
			failure = resolved.message || 'Not a Squads v4 multisig.'
		} catch (err) {
			failure = `Failed to resolve: ${(err as Error).message}`
		} finally {
			resolveInFlight = null
		}
		showToast(failure, 'error')
		failedFor = val
	}

	function onAction() {
		if (resolveInFlight) return
		if (!changed && !showFailure) onRefresh()
		else if (valid) switchMultisig(trimmed)
	}

	function onkeydown(e: KeyboardEvent) {
		// Unchanged values are allowed through so a stored non-multisig address
		// (e.g. a vault saved before resolution existed) can be re-resolved in place.
		if (e.key === 'Enter' && isValidBase58(trimmed)) switchMultisig(trimmed)
	}

	const hint = $derived.by(() => {
		if (resolveInFlight) return { text: 'Resolving address...', error: false }
		if (showFailure) return { text: failure, error: true }
		if (changed && !valid) return { text: 'Not a valid base58 address', error: true }
		return null
	})
	const refreshing = $derived(!resolveInFlight && !changed && !showFailure)
</script>

<div
	class="address-bar"
	class:address-bar--invalid={changed && !valid}
	class:address-bar--changed={changed && valid}
>
	<input
		class="address-bar-input"
		type="text"
		placeholder="Enter multisig address..."
		bind:value
		{onkeydown}
	/>
	<button
		class="btn-refresh"
		title={refreshing ? 'Refresh' : 'Switch multisig'}
		disabled={!!resolveInFlight}
		onclick={onAction}>{resolveInFlight ? '…' : refreshing ? '↻' : '→'}</button
	>
</div>
<div
	class="address-bar-hint"
	class:hidden={!hint}
	class:address-bar-hint--error={hint?.error}
>
	{hint?.text ?? ''}
</div>
