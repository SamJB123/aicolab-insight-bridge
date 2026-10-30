// The chart's scope for this package's TESTS (@aicolab/atlas chart): a
// registry of applets the way a host would give one — the family and its
// reports, placed in the direction the hub gives them — and every
// report's island registered as its program, as a host registers it, so
// a report's declaration finds its own cell. Configured once, before any
// test runs (vitest.config.ts setupFiles).

import { appletRegistry } from '@aicolab/app-kit/applet'
import { configureChart } from '@aicolab/atlas/chart/chart-data.ts'
import { configureSpaces } from '@aicolab/atlas/chessboard/content/space/programs.ts'
import { INSIGHT_BRIDGE_APPLET, REPORT_APPLETS } from '../applets.ts'
import { reportIslandProgram } from './program.ts'

configureChart({
	applets: appletRegistry([INSIGHT_BRIDGE_APPLET, ...REPORT_APPLETS]),
	directions: { [INSIGHT_BRIDGE_APPLET.id]: 2 },
	viewerIslands: [],
})

configureSpaces(REPORT_APPLETS.map((applet) => reportIslandProgram(applet.id)))
