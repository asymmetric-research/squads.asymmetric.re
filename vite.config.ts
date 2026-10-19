import { sveltekit } from '@sveltejs/kit/vite'
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
	// RPC_URL is baked into the bundle (see the Dockerfile); .env supplies it
	// locally, the environment in CI.
	const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env }
	return {
		plugins: [sveltekit()],
		define: {
			__RPC_URL__: JSON.stringify(env.RPC_URL || ''),
		},
	}
})
