<script lang="ts">
import { onMount } from 'svelte'
import { app, boot } from '$lib/app.svelte'
import Layout from '$lib/components/Layout.svelte'
import LockdownHome from '$lib/components/LockdownHome.svelte'
import Setup from '$lib/components/Setup.svelte'
import Toasts from '$lib/components/Toasts.svelte'
import WalletPicker from '$lib/components/WalletPicker.svelte'
import { showToast } from '$lib/toasts.svelte'

let booted = $state(false)

onMount(() => {
	const done = boot()
	booted = true
	done.catch((err: Error) => {
		console.error('Boot failed:', err)
		showToast(`Failed to initialize: ${err.message}`, 'error')
	})
})

const showSetup = $derived(app.mode !== 'lockdown' && !app.multisigAddress)
</script>

{#if booted}
	{#if showSetup}
		<Setup />
	{:else}
		<div class="app">
			{#if app.mode === 'lockdown' && !app.lockdownActive}
				<LockdownHome />
			{:else}
				<Layout />
			{/if}
		</div>
	{/if}
	{#if app.showWalletPicker && !showSetup}
		<WalletPicker />
	{/if}
{/if}
<Toasts />
