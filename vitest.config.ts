import { defineConfig } from 'vitest/config'

// Isolated, plugin-free vitest config for the package's pure-TS unit tests
// (galaxy layout/fixture, the report island). Runs in plain Node — no
// Solid, no DOM, no Cloudflare plugins.
//
// One file at a time: the island suites realise whole islands and a
// report's thousands of rooms, and one of them builds every space with
// no renderer. Run side by side they starve each other and time out; in
// sequence each has the machine.
export default defineConfig({
	test: {
		environment: 'node',
		include: ['src/**/*.test.ts'],
		fileParallelism: false,
		// The chart's scope: the registry of applets the tests see
		// (src/island/test-scope.ts), as a host sets it before the chart is
		// first read.
		setupFiles: ['src/island/test-scope.ts'],
	},
})
