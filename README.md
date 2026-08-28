# @aicolab/insight-bridge

The layer every Insight Bridge corpus explorer shares. A corpus explorer is a
host app over one corpus (a body of audits, judgments, budgets…); this
package gives each host the parts that must read the same everywhere: the
attribution mark, the editorial pages that explain the pipeline and the
reading rules, the MCP server helpers, and the **Insight Galaxy** — a WebGPU
dashboard that renders any corpus as a navigable spiral galaxy.

Anything corpus-specific stays in the host. The test is whether a sentence
stays true when the corpus changes.

## Install

```sh
pnpm add @aicolab/insight-bridge
```

Peers: `solid-js`, `@solidjs/web` (Solid v2), `@tanstack/solid-router`,
`@tanstack/solid-start`, `@aicolab/kolo`, `@aicolab/ui-solid`, `three`, and
`@modelcontextprotocol/sdk` for the server entry.

## Entry points

| Import | What it is |
|---|---|
| `@aicolab/insight-bridge` | `PoweredByInsightBridge`, `InsightBridgeAbout`, `InsightBridgeReading`, the `CORPORA` registry. Light enough for a header. |
| `./galaxy` | `GalaxyMap` and its contracts (`IBGalaxy`, `IBNodeContent`), fixture builders, layout. Reaches three.js/kolo behind a dynamic import. |
| `./server` | `handleMcpRequest`, `resolveViewer` — server-only; never re-exported from the root |
| `./styles.css` | The package's stylesheet |

## Quick start

A host mounts the galaxy at its own route with a ~20-line adapter over its
queries:

```tsx
import { GalaxyMap, type IBGalaxy } from '@aicolab/insight-bridge/galaxy'

<GalaxyMap
  galaxy={galaxy}            // IBGalaxy: tiered nodes, child→parent edges, weight, intensity
  title="Watchful State"
  loadContent={loadContent}  // (node) => Promise<IBNodeContent | null> for the in-galaxy reader
  gateAction={() => <Link to="/explorer">Open the flat explorer</Link>}
  posterSrc="/galaxy-poster.png"
/>
```

A package cannot ship a route (`createFileRoute` is keyed off a per-app
generated augmentation), so each host writes a thin route file that renders
these components — TanStack's intended pattern.

## Concepts

- **Data contract** — `IBGalaxy`: nodes over up to three tiers, child→parent
  edges (multi-parent DAGs welcome, exactly one primary per child), `weight`
  (reach → size), `intensity` 0..1 (score → stellar temperature), optional
  stance `mix`. Serialisable; it crosses the loader boundary.
- **Reading contract** — `loadContent(node)`: lede, stats, key points with
  verbatim quotes, lens tables, entity lists, related links, rendered in the
  in-galaxy reader.
- **Scene** — seeded deterministic spiral layout (the same galaxy for every
  visitor), raymarched arm nebulae, focus-gated constellations, procedural
  planets at close zoom, selective bloom and DOF. WebGPU-only by design:
  `probeWebGpu()` gates it and unsupported browsers get a styled poster
  with the host's way back to flat views.
- **Chrome** is `@aicolab/ui-solid` throughout: breadcrumb trail (drives the
  camera), command palette, tool panel legend, onboarding hints.
- **Dev bench** — `buildFixtureGalaxy` / `buildFixtureContent` give a seeded
  synthetic corpus for local work; hosts fall back to it and honour `?demo=1`.

Layout is pure and unit-tested: `bakeGalaxyLayout` produces both the render
positions and the CPU pick mirror.

## Developing

A git submodule of the `aicolab-portal` monorepo (`packages/insight-bridge`).
`pnpm test`, `pnpm check-types`. Host integrations to learn from live in the
monorepo's `playground/audit-corpus`, `playground/insightbridge-legal-ai` and
`playground/insightbridge-basin`.

## Versioning and publishing

All `@aicolab/*` packages are versioned together. `pnpm publish` rewrites
`workspace:` and `catalog:` specifiers to concrete ranges in the published
manifest.

## License

Proprietary. Published to npm with restricted access; all rights reserved.
