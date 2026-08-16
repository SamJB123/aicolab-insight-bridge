/**
 * SceneStage adapter — the bridge between ui-solid's canvas organism and the
 * galaxy engine. `mount` is synchronous by contract, so the engine module is
 * dynamic-imported here (keeping three.js out of every SSR/worker bundle and
 * out of the initial client chunk) and commands arriving before it lands are
 * buffered.
 */

import type { SceneStageAdapter } from '@aicolab/ui-solid'
import type { GalaxyEngineHandle } from './engine/engine.ts'
import type { GalaxyNavCore } from './nav-core.ts'
import type { IBGalaxy, IBIntensityMode } from './types.ts'

/** Renderer construction inputs. SceneStage remounts the engine when this
 * value changes — hand it a stable (memoed) object. The intensity mode is a
 * LAYOUT input (it changes the baked sky), so switching it is deliberately a
 * remount. The NAV CORE rides here too (headless-core rewrite, 2026-08-16):
 * it is identity-stable across remounts, so trails, lens and remembered
 * poses survive an intensity re-bake — and there is no command channel at
 * all: the engine subscribes to the core directly. */
export interface GalaxyConfiguration {
	galaxy: IBGalaxy
	intensityMode?: IBIntensityMode
	core: GalaxyNavCore
}

export function createGalaxyAdapter(): SceneStageAdapter<
	undefined,
	Record<string, never>,
	GalaxyConfiguration
> {
	return {
		mount(context) {
			let disposed = false
			let engine: GalaxyEngineHandle | undefined
			void import('./engine/engine.ts')
				.then(({ mountGalaxyEngine }) => {
					if (disposed) return
					engine = mountGalaxyEngine({
						canvas: context.canvas,
						host: context.host,
						galaxy: context.configuration.galaxy,
						intensityMode: context.configuration.intensityMode,
						core: context.configuration.core,
						onReady: context.onReady,
						onError: context.onError,
					})
				})
				.catch((error: unknown) => {
					if (!disposed) {
						context.onError(error instanceof Error ? error.message : String(error))
					}
				})
			return {
				updateCommand(): void {
					// No command channel — the engine reads the nav core.
				},
				dispose(): void {
					disposed = true
					engine?.dispose()
					engine = undefined
				},
			}
		},
	}
}
