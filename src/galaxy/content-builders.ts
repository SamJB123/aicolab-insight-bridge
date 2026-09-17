/**
 * The content builders moved to ../reader on 2026-09-14 (the app drawers
 * read the same content the galaxy does). This path stays so the galaxy's
 * own imports and any host importing from the galaxy subpath keep working.
 */

export * from '../reader/content-builders.ts'
