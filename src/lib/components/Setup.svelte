<script lang="ts">
import { onMount } from 'svelte'
import { asset } from '$app/paths'
import { onSetupComplete } from '../app.svelte'
import { hasAnyPins } from '../pins.js'
import { isValidBase58 } from '../squads.js'
import Logo from './Logo.svelte'
import ModeToggle from './ModeToggle.svelte'

const META = [
	['Pinned RPC', 'Triton One', 'https://triton.one'],
	['Pinned Explorer', 'Solscan', 'https://solscan.io'],
	[
		'Upstream',
		'Solana-Multisig-Tools/multisig-verifier',
		'https://github.com/Solana-Multisig-Tools/multisig-verifier',
	],
	[
		'This fork',
		'asymmetric-research/squads.asymmetric.re',
		'https://github.com/asymmetric-research/squads.asymmetric.re',
	],
]

let address = $state('')
let error = $state('')
let resolving = $state(false)
let input: HTMLInputElement

onMount(() => input.focus())

async function submit() {
	const addr = address.trim()
	if (!isValidBase58(addr)) {
		error = 'Invalid base58 address (must be 32 bytes)'
		return
	}
	error = ''
	resolving = true
	try {
		await onSetupComplete(addr)
	} finally {
		resolving = false
	}
}
</script>

<div class="setup-wrapper">
	{#if hasAnyPins()}
		<div class="setup-mode-bar"><ModeToggle /></div>
	{/if}

	<div class="setup-main">
		<div class="setup-left">
			<div class="setup-brand">
				<Logo kind="logotype" height={28} />
				<span class="setup-brand-badge">Verifier</span>
			</div>

			<p class="setup-about">
				An independently hosted fork of the Squads multisig verifier, operated by <a
					href="https://asymmetric.re"
					target="_blank"
					rel="noopener noreferrer">Asymmetric Research</a
				> as part of the <a href="https://stride.asymmetric.re/" target="_blank" rel="noopener noreferrer"
					>STRIDE</a
				> initiative.
			</p>
			<p class="setup-about">
				Independent hosting reduces single-point supply chain risk for multisig operators. RPC for this
				instance generously provided as a public good by <a
					href="https://triton.one"
					target="_blank"
					rel="noopener noreferrer"
					class="triton-link"
					><img
						src={asset('/triton-mark.svg')}
						alt="Triton One"
						class="triton-mark"
						width="18"
						height="18"
					/>Triton One</a
				>. ❤️
			</p>

			<div class="setup-meta">
				{#each META as [label, text, href] (label)}
					<span class="setup-meta-label">{label}</span>
					<a {href} target="_blank" rel="noopener noreferrer" class="setup-meta-value">{text}</a>
				{/each}
			</div>
		</div>

		<div class="setup-right">
			<div class="setup-card">
				<h2>Connect to your multisig</h2>
				<p>Enter your multisig address to get started.</p>
				<div class="field">
					<label for="setup-address">Multisig address</label>
					<input
						id="setup-address"
						type="text"
						placeholder="Enter base58 address..."
						bind:value={address}
						bind:this={input}
					/>
				</div>
				<p class="error-inline" class:visible={error}>{error}</p>
				<button class="btn btn-primary mt-md" disabled={resolving} onclick={submit}
					>{resolving ? 'Resolving...' : 'Continue'}</button
				>
			</div>
		</div>
	</div>
</div>
