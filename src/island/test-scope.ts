// The programs this package's TESTS stand on (@aicolab/atlas programs.ts):
// the family, berthing every report on its ring as a host registers it, and
// each report's island as its program — so a report's declaration is written
// where the family says, and a report alone is its own top. Configured once,
// before any test runs (vitest.config.ts setupFiles).

import { configureSpaces } from '@aicolab/atlas/chessboard/content/space/programs.ts'
import { REPORT_APPLETS } from '../applets.ts'
import { insightBridgeProgram } from './family.ts'
import { reportIslandProgram } from './program.ts'

configureSpaces([
	insightBridgeProgram(),
	...REPORT_APPLETS.map((applet) => reportIslandProgram(applet.id)),
])
