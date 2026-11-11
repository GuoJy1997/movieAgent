# P2 asset metadata and fixed versions

Library schema is centralized in `packages/contracts/src/schema.ts` (currently 8). Migration 0008 adds asset metadata and rebuilds the old unique-per-asset import journal for repeatable version imports. The existing guarded migration stages a consistent database copy, retains the schema7 backup, verifies integrity/foreign keys, and atomically installs the candidate. Older migration files are unchanged.

## Public operations

| Operation | Input | Result |
| --- | --- | --- |
| `asset.updateMetadata` | `assetId, expectedRevision, name, tags` | Metadata with incremented independent revision |
| `asset.trash`, `asset.restore` | `assetId, expectedRevision` | Metadata with incremented revision and deletion timestamp/null |
| `asset.search` | Optional `name, tag, mediaType, state, latestOnly` | Safe fixed-version views |
| `asset.history` | `assetId` | Ascending fixed versions, source artifact references, timestamps and readable metadata |
| `asset.saveArtifact` | Existing input plus explicit `assetId, expectedVersion` | New fixed version of that asset |
| `asset.importGrantedFiles` | `grantId` plus optional explicit `assetId, expectedVersion` pair | Imported fixed versions |

Names are trimmed and limited to 200 characters for new edits; up to 20 tags are trimmed and deduplicated, each 1–32 characters. Search names use case-insensitive substring matching and tags use exact matching. Empty search remains supported and returns active assets with all versions; the UI requests active/latest explicitly. Latest is determined before filtering the version's media type.

Metadata updates, recycle operations, events and deduplicated receipts share the existing command transaction. Metadata revisions are separate from media versions. Appending retains the asset's name and does not move any old reference. File append requires exactly one selected file; target identity/version persists before collection and is rechecked transactionally at publication. A concurrent version returns `REVISION_CONFLICT`; a retry never guesses another target. Post-collection target rejection is durably recorded before a definitive error is returned. Replays preserve that error and background recovery excludes the rejected import, including after restore/reopen. If terminal-state persistence fails, the result is an indeterminate COMMAND_COMMIT_FAILED and the main outbox retains the operation. Durable originals and accepted identity remain journaled without physical purge.

## New selection versus historical reading

`engine.assets.assertSelectable(ref): Result<MediaMetadata>` validates a new choice and returns safe hash/MIME/size/dimensions. It rejects recycled asset references with `ASSET_TRASHED`. New canvas choices, selected outputs and ordinary generation preparation use this guard.

`engine.assets.metadata(ref)` and `readFixedOriginal(ref, expected?)` are historical fixed readers. Recycled assets remain readable by existing canvas references and already approved/frozen work. Dispatch continues checking frozen original metadata and hash. Restore retains the same asset identity and every version. No permanent purge is provided.

History contains safe refs, import/generation provenance and timestamps. Source filesystem paths remain restricted to main/engine collection records and never enter renderer DTOs. The native picker permits PNG/JPEG/WebP, MP4 and explicit TXT/MD. Text uses the existing strict UTF-8, no-NUL, 1MiB validation and displays as escaped plain text. The shared preview renders according to fixed MIME, including legacy canvas fixed-media envelopes.

## Verification

`tests/integration/asset-management.test.ts` covers revision conflicts/replay, normalized tags/search, fixed histories, repeated imports, concurrent saves, durable append recovery/publication CAS, recycle/restore, old references, new-selection rejection and an approved generation completing once after trash. `migration-p2.test.ts` upgrades a real schema7 database and verifies unchanged PNG/MP4 original bytes, hashes, artifact sources and retained backup.

`tests/electron/asset-management.test.ts` exercises the actual package with isolated config/profile/library and native picker fixture: text escaping, metadata/history, image replacement, recycle/restore, MP4 preview, reopening, and saving a collected Chat artifact to an explicit existing asset version. Screenshots are written to `test-results/p2-assets/`. Use `MOVIEAGENT_TEST_PACKAGE` for an owned alternate package directory; every test launch supplies an isolated `--model-config`. No live service request is needed.

Task3 verification: 339 integration tests passed with serial execution and CLI `--testTimeout=60000 --hookTimeout=60000`; the default 10s run had 18 filesystem timeouts in unchanged directory tests, which also passed separately with the override. Typecheck, production build, package native-module verification and four actual packaged asset/startup tests passed. The 1440×900 text/image/video/history screenshots were visually inspected. All provider traffic used local fixtures.
