# @aicolab/insight-bridge

The layer every Insight Bridge corpus explorer shares:

- **`.`** — the editorial prose (`InsightBridgeAbout`, `InsightBridgeReading`),
  the attribution mark (`PoweredByInsightBridge`), and the corpus registry
  (`CORPORA`).
- **`./server`** — the MCP transport adapter and auth viewer.
- **`./galaxy`** — the **Insight Galaxy**: one WebGPU/TSL dashboard organism
  that renders any corpus as a navigable spiral galaxy.

## The Insight Galaxy

```tsx
import { GalaxyMap, type IBGalaxy } from '@aicolab/insight-bridge/galaxy'

<GalaxyMap
  galaxy={galaxy}            // your ~20-line adapter over landscape queries
  title="Watchful State"
  loadContent={loadContent}  // your adapter over drawer queries → IBNodeContent
  gateAction={() => <Link to="/explorer">Open the flat explorer</Link>}
  posterSrc="/galaxy-poster.png"
/>
```

- **Data contract**: `IBGalaxy` — nodes over three tiers (topic/group/family;
  two-tier corpora pass two `tiers` entries), child→parent edges (multi-parent
  DAGs welcome; exactly one primary per child), `weight` (reach → size),
  `intensity` 0..1 (score → stellar temperature via the host's `--s1…--s5`
  ramp), optional stance `mix`. Must stay serialisable — it crosses the
  loader boundary.
- **Reading contract**: `loadContent(node) → Promise<IBNodeContent | null>` —
  lede, stats, key points with verbatim quotes, lens tables, entity lists,
  related links. Rendered natively in the in-galaxy reader (RaisedSheet).
- **Scene** (settled 2026-08-14 over 16 MCQs + a DS-adoption round): seeded
  deterministic spiral layout (same galaxy for every visitor), raymarched
  arm nebulae, focus-gated beam constellations, mini procedural planets at
  close zoom, CSS2D labels, selective bloom / anamorphic / lensflare / DOF.
  WebGPU-only by design — `probeWebGpu()` gates it and unsupported browsers
  get a styled poster panel with the host's own way back to flat views.
- **Chrome** is ui-solid throughout: Breadcrumb trail (drives the camera),
  CommandPalette type-to-jump, ToolPanel legend and constellation roster,
  StageHint onboarding, WorkspaceStageTooltip hover.
- **Dev bench**: `buildFixtureGalaxy` / `buildFixtureContent` — a seeded
  synthetic corpus for local work (the real corpora live in remote D1).
  The three host routes fall back to it automatically and honour `?demo=1`.

Layout is pure and unit-tested (`pnpm test`): `bakeGalaxyLayout` is both the
render positions and the CPU pick mirror. The engine reaches three.js/kolo
only behind a dynamic import inside the SceneStage adapter, so SSR/worker
bundles never see it.

Host integrations live in each app: `src/lib/galaxy-adapter.ts` +
`src/routes/galaxy.tsx` in `playground/audit-corpus`,
`playground/insightbridge-legal-ai`, `playground/insightbridge-basin`.
