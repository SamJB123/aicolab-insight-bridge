import { defineConfig } from 'vitest/config'

// Isolated, plugin-free vitest config for the package's pure-TS unit tests
// (galaxy layout/fixture). Runs in plain Node — no Solid, no three.js, no
// DOM, no Cloudflare plugins.
export default defineConfig({
	test: {
		environment: 'node',
		include: ['src/**/*.test.ts'],
	},
})
