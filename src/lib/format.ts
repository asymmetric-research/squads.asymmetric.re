// Unicode bidi override characters that can spoof displayed addresses
const BIDI_REGEX = /[‪-‮⁦-⁩]/g

const EXPLORER_URL = 'https://solscan.io'

/** Strip Unicode bidi override characters from on-chain strings before display. */
export function sanitize(str: unknown): string {
	return String(str).replace(BIDI_REGEX, '')
}

/** i64 seconds since epoch → local date + time. */
export function formatTimestamp(ts: bigint | number | null | undefined): string {
	if (!ts) return ''
	const d = new Date(Number(ts) * 1000)
	return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
}

export function getExplorerUrl(type: 'tx' | 'account', value: string): string {
	if (type === 'tx') return `${EXPLORER_URL}/tx/${value}`
	return `${EXPLORER_URL}/account/${value}`
}
