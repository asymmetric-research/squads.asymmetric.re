<script lang="ts">
import { app, onApprove, onReject } from '../app.svelte'
import { activate } from '../keys'
import Address from './Address.svelte'
import Instruction from './Instruction.svelte'

// biome-ignore lint/suspicious/noExplicitAny: deserialized proposal from squads.js
let { proposal }: { proposal: any } = $props()

const tx = $derived(app.expandedTransaction)
const multisig = $derived(app.multisig)
const me = $derived(app.walletAccount?.address)

let membersOpen = $state(false)

const threshold = $derived(multisig?.threshold)
const approvedCount = $derived(proposal.approved.length)
const isExecuted = $derived(proposal.status.tag === 5)

// For executed: only show signers. For active: show all members.
const members = $derived(
	multisig
		? isExecuted
			? multisig.members.filter((m: { key: string }) => proposal.approved.includes(m.key))
			: multisig.members
		: [],
)

function memberStatus(key: string): [string, string] {
	let status: [string, string] = isExecuted
		? ['member-approved', 'Signed']
		: ['member-pending', 'Pending']
	if (!isExecuted && proposal.approved.includes(key)) status = ['member-approved', 'Approved']
	if (proposal.rejected.includes(key)) status = ['member-rejected', 'Rejected']
	if (proposal.cancelled.includes(key)) status = ['member-cancelled', 'Cancelled']
	return status
}

// Vote controls: only for an active proposal and a connected wallet
const voting = $derived.by(() => {
	if (proposal.status.tag !== 1 || !me || !multisig) return null
	const member = multisig.members.find((m: { key: string }) => m.key === me)
	return {
		member,
		canVote: member && member.permissionsMask & 2,
		hasApproved: proposal.approved.includes(me),
		hasRejected: proposal.rejected.includes(me),
	}
})
const actionState = $derived(app.proposalActions.get(String(proposal.index)) || 'idle')
const busy = $derived(actionState !== 'idle')

const batchIxCount = $derived(
	tx?.type === 'batch'
		? tx.innerTransactions?.reduce(
				(n: number, t: { message?: { instructions?: unknown[] } }) =>
					n + (t.message?.instructions?.length || 0),
				0,
			) || 0
		: 0,
)
const plural = (n: number) => `${n} instruction${n === 1 ? '' : 's'}`
</script>

<div class="proposal-detail">
	{#if app.loadingDetail}
		<div class="loading">Loading transaction details...</div>
	{:else}
		{#if multisig}
			<!-- Approval status card (always on top) -->
			<div class="detail-card">
				<div
					class="approval-header"
					role="button"
					tabindex="0"
					aria-expanded={membersOpen}
					onclick={(e) => {
						e.stopPropagation()
						membersOpen = !membersOpen
					}}
					onkeydown={activate(() => (membersOpen = !membersOpen))}
				>
					<div class="approval-header-left">
						<div class="detail-card-title">Approval progress</div>
					</div>
					<div class="approval-header-right">
						<div class="threshold-count">
							<span class="threshold-current">{approvedCount}</span><span class="threshold-sep">/</span><span
								>{threshold}</span
							>
						</div>
						<span class="ix-chevron">{membersOpen ? '▾' : '▸'}</span>
					</div>
				</div>

				<div class="progress-bar">
					<div
						class="progress-fill"
						class:progress-fill--complete={approvedCount >= threshold}
						style:width="{Math.min(100, (approvedCount / threshold) * 100)}%"
					></div>
				</div>

				<div class="member-section" class:hidden={!membersOpen}>
					<div class="member-grid">
						{#each members as member (member.key)}
							{@const [statusClass, statusText] = memberStatus(member.key)}
							<div class="member-card {statusClass}">
								<div class="member-card-top">
									<span class="member-status-dot"></span>
									<span class="member-status-text">{statusText}</span>
									{#if me === member.key}
										<span class="badge-you">you</span>
									{/if}
								</div>
								<div class="member-addr"><Address pubkey={member.key} /></div>
							</div>
						{/each}
					</div>
				</div>

				{#if voting}
					{#if voting.canVote && !voting.hasApproved && !voting.hasRejected}
						<div class="actions">
							<button class="btn btn-primary" disabled={busy} onclick={() => onApprove(proposal.index)}
								>{busy ? `${actionState}...` : 'Approve'}</button
							>
							<button class="btn btn-danger" disabled={busy} onclick={() => onReject(proposal.index)}
								>{busy ? `${actionState}...` : 'Reject'}</button
							>
						</div>
					{:else if voting.hasApproved}
						<div class="voted-status voted-approved">You have approved this proposal</div>
					{:else if voting.hasRejected}
						<div class="voted-status voted-rejected">You have rejected this proposal</div>
					{:else if !voting.canVote && voting.member}
						<div class="voted-status">You do not have Vote permission</div>
					{/if}
				{/if}
			</div>
		{/if}

		{#if !tx}
			<div class="text-muted">Transaction data not available.</div>
		{:else if tx.type === 'config'}
			<div class="detail-card">
				<div class="detail-card-header">
					<div class="detail-card-title">Configuration change</div>
				</div>
				{#each tx.actions as action, i (i)}
					<div class="ix-card">
						<strong>{action.name}</strong>
						{#if action.member}
							<div class="mt-sm">
								<span>{'Member: '}</span><Address pubkey={action.member.key} /><span class="text-muted"
									>{` (${action.member.permissions.join(', ')})`}</span
								>
							</div>
						{/if}
						{#if action.threshold !== undefined}
							<div class="mt-sm">New threshold: {action.threshold}</div>
						{/if}
						{#if action.timeLock !== undefined}
							<div class="mt-sm">Time lock: {action.timeLock}s</div>
						{/if}
						{#if action.key}
							<div class="mt-sm"><span>{'Key: '}</span><Address pubkey={action.key} /></div>
						{/if}
					</div>
				{/each}
			</div>
		{:else if tx.type === 'vault' && tx.message}
			<div class="detail-card">
				<div class="detail-card-header">
					<div class="detail-card-title">Instructions</div>
					<div class="text-sm text-muted">{plural(tx.message.instructions.length)}</div>
				</div>
				{#each tx.message.instructions as ix, i (i)}
					<Instruction {ix} message={tx.message} index={i} />
				{/each}
			</div>
		{:else if tx.type === 'batch'}
			<div class="detail-card">
				<div class="detail-card-header">
					<div class="detail-card-title">Instructions</div>
					<div class="text-sm text-muted">{plural(batchIxCount)}</div>
				</div>
				{#if tx.innerTransactions?.length > 0}
					{#each tx.innerTransactions as inner, t (t)}
						{#if inner.message}
							{#each inner.message.instructions as ix, i (i)}
								<Instruction {ix} message={inner.message} index={i} />
							{/each}
						{/if}
					{/each}
				{:else}
					<div class="text-muted p-lg">No transaction details available.</div>
				{/if}
			</div>
		{:else if tx.type === 'unknown'}
			<div class="detail-card">
				<div class="detail-card-header">
					<div class="detail-card-title">Unknown transaction</div>
				</div>
				<div class="text-sm text-muted">Discriminator: {tx.discriminator}</div>
			</div>
		{/if}
	{/if}
</div>
