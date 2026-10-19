import adapter from '@sveltejs/adapter-static'

// Vite's HMR socket; only `vite dev` needs it.
const devConnect = process.argv.includes('dev') ? ['ws://localhost:*'] : []

/** @type {import('@sveltejs/kit').Config} */
const config = {
	compilerOptions: {
		runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true),
	},
	kit: {
		adapter: adapter(),
		// No `paths.base`: with the default `paths.relative`, the same build
		// serves at the domain root in production and under a path prefix on
		// the PR-preview bucket (see .github/workflows/preview.yml).
		// The default name is the build timestamp, which would make every build's
		// output differ and break the build-hash check (scripts/verify.sh).
		version: { name: 'squads-verifier' },
		csp: {
			// SvelteKit boots from an inline script; hash mode adds its hash to
			// script-src in the page's <meta> CSP. nginx's header CSP must not
			// set script-src or default-src, or it would block that script.
			mode: 'hash',
			directives: {
				'default-src': ['none'],
				'script-src': ['self'],
				'style-src': ['self', 'unsafe-inline'],
				'connect-src': ['https:', 'http://localhost:*', 'http://127.0.0.1:*', ...devConnect],
				'img-src': ['self', 'data:'],
				'font-src': ['self'],
				'form-action': ['self'],
				'base-uri': ['self'],
				'object-src': ['none'],
			},
		},
	},
}

export default config
