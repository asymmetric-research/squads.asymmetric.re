// See https://svelte.dev/docs/kit/types#app.d.ts
declare global {
	/** Solana RPC URL baked in at build time; empty falls back to the public endpoint. */
	const __RPC_URL__: string
}

export {}
