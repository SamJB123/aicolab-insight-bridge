/**
 * Ambient module shape for Vite's `?url` asset imports (brand.tsx pulls the
 * icon as a URL). Declared locally instead of referencing `vite/client` so
 * the package's type program doesn't depend on Vite being a direct dep —
 * consuming apps' bundlers supply the real behaviour.
 */
declare module '*.svg?url' {
	const url: string
	export default url
}
