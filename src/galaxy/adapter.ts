/**
 * SceneStage adapter — the bridge between ui-solid's canvas organism and the
 * galaxy engine. `mount` is synchronous by contract, so the engine module is
 * dynamic-imported here (keeping three.js out of every SSR/worker bundle and
 * out of the initial client chunk) and commands arriving before it lands are
 * buffered.
 */

import type { SceneStageAdapter } from '@aicolab/ui-solid'
import type { GalaxyEngineHandle } from './engine/engine.ts'
import type { GalaxyCommand, GalaxyEvents, IBGalaxy, IBIntensityMode } from './types.ts'

/** Renderer construction inputs. SceneStage remounts the engine when this
 * value changes — hand it a stable (memoed) object. The intensity mode is a
 * LAYOUT input (it changes the baked sky), so switching it is deliberately a
 * remount, not a command. */
export interface GalaxyConfiguration {
	galaxy: IBGalaxy
	intensityMode?: IBIntensityMode
}

export function createGalaxyAdapter(): SceneStageAdapter<
	GalaxyCommand,
	GalaxyEvents,
	GalaxyConfiguration
> {
	return {
		mount(context) {
			let disposed = false
			let engine: GalaxyEngineHandle | undefined
			let pendingCommand: GalaxyCommand | undefined
			void import('./engine/engine.ts')
				.then(({ mountGalaxyEngine }) => {
					if (disposed) return
					engine = mountGalaxyEngine({
						canvas: context.canvas,
						host: context.host,
						galaxy: context.configuration.galaxy,
						intensityMode: context.configuration.intensityMode,
						events: context.events,
						onReady: context.onReady,
						onError: context.onError,
					})
					if (pendingCommand !== undefined) {
						engine.updateCommand(pendingCommand)
						pendingCommand = undefined
					}
				})
				.catch((error: unknown) => {
					if (!disposed) {
						context.onError(error instanceof Error ? error.message : String(error))
					}
				})
			return {
				updateCommand(command: GalaxyCommand): void {
					if (engine) engine.updateCommand(command)
					else pendingCommand = command
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
