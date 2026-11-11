# Task 1 report — creation revisions and schema 11

Base for task review: `57d6a320e003298278af9df20acab803ceeeae61`. Task 1 commit: `3194f59` (`feat: add versioned project creation content`). Root's intervening `4a96a24` only clarifies the later Agent output budget. Task 1 production files were staged explicitly; unrelated docs and untracked files were excluded.

## Public contracts

`packages/contracts/src/creation.ts` exports:

- `EntityKind = 'character' | 'scene' | 'prop' | 'style'`, `CreationKind = 'entity' | 'script' | 'shot'`.
- `EntityRef { libraryId: string; projectId: string; entityId: string; revision: number }`.
- `SaveEntityInput { projectId; id; expectedRevision; kind; name; description; constraints; references: MediaReference[] }`.
- `SaveScriptInput { projectId; id; expectedRevision; title; synopsis; body; scenes: ScriptScene[] }`, where `ScriptScene { id; title; location; time; description }`.
- `SaveShotInput { projectId; id; expectedRevision; scriptId; sceneId; order; title; durationSeconds; shotSize; cameraMovement; subject; action; dialogue; sound; aspectRatio; prompt; entityRefs: EntityRef[] }`.
- `EntityRevision`, `ScriptRevision`, `ShotRevision` add `libraryId`, `revision`, `createdAt` and omit `expectedRevision` from the respective save input.
- `SelectShotOutputInput { projectId; shotId; expectedRevision; expectedSelectionRevision; role: 'image' | 'video'; reference: MediaReference | null }`; `ShotOutputSelection { libraryId; projectId; shotId; shotRevision; selectionRevision; image; video; updatedAt }`.
- `CreationReadInput { projectId; scriptId? }`; `CreationHistoryInput { projectId; kind; id }`; `CreationSnapshot { libraryId; projectId; entities; scripts; shots; selections; snapshotSeq }`; `CreationHistory` discriminated by `kind` with fixed `revisions`.
- `CreationBatch { projectId; entities: SaveEntityInput[]; scripts: SaveScriptInput[]; shots: SaveShotInput[] }`; `CreationBatchResult { libraryId; projectId; entities: EntityRevision[]; scripts: ScriptRevision[]; shots: ShotRevision[] }`.
- Parsers: `parseSaveEntity`, `parseSaveScript`, `parseSaveShot`, `parseSelectShotOutput`, `parseCreationRead`, `parseCreationHistory`, `parseCreationBatch`; output guards: `isEntityRevision`, `isScriptRevision`, `isShotRevision`, `isShotOutputSelection`, `isCreationSnapshot`, `isCreationHistory`.

Commands and output types: `creation.saveEntity` → `EntityRevision`, `creation.saveScript` → `ScriptRevision`, `creation.saveShot` → `ShotRevision`, `creation.selectOutput` → `ShotOutputSelection`. Queries: `creation.read` → `CreationSnapshot`, `creation.history` → `CreationHistory`. Events: `creation.entitySaved`, `creation.scriptSaved`, `creation.shotSaved`, `creation.outputSelected` carrying corresponding output DTOs. They are advertised by desktop `describe()` and use the existing event/receipt transaction.

`creationFor(library: LibraryHandle, assets: ReturnType<typeof assetsFor>)` returns:

```ts
saveEntity(input: SaveEntityInput): Result<EntityRevision>
saveScript(input: SaveScriptInput): Result<ScriptRevision>
saveShot(input: SaveShotInput): Result<ShotRevision>
selectOutput(input: SelectShotOutputInput): Result<ShotOutputSelection>
read(input: CreationReadInput): Result<CreationSnapshot>
history(input: CreationHistoryInput): Result<CreationHistory>
validateBatch(input: unknown): Result<CreationBatchResult>
applyBatch(input: unknown): Result<CreationBatchResult>
```

For Task 2: `validateBatch` resolves all CAS versions and staged entity/script/shot references against the final proposed state before writing. `applyBatch` requires `library.db.isTransaction`, revalidates, and writes without `BEGIN`/`COMMIT`; the caller owns rollback and receipt/event publication. Both return the new revisions in input order. Create uses `expectedRevision: 0`; editing uses the last revision. A batch may replace a script scene and move its shot in one transaction. Stable IDs for Agent proposals must be assigned by Task 2 before calling this service. Normal command handlers already run in the router's transaction. `creation_current` points to immutable `creation_revision` rows. Selection CAS is independent of shot content CAS; selection history persists in `shot_output_selection_history` for Task 3 to consume.

Schema 11 migration adds the revision/current and selection/history tables, immutability triggers and indexes; it runs through the existing backup/staged migration path. No existing rows or media objects are rewritten.

## Tests and review

The prior Task 1 implementer recorded 23 expected RED creation tests plus migration RED in `task-1-red.log` and `task-1-migration-red.log`. On continuation, one green attempt exposed a test error: an initial event subscription intentionally yields a snapshot and no replay; the test now retains its cursor and reads committed events after the commands. I added a scene-kind regression test, observed its RED result, then changed the enum/validator and observed GREEN.

Final commands, both exit 0:

```text
D:\nodejs\node.exe node_modules\vitest\vitest.mjs run tests/integration/creation.test.ts tests/integration/migration-creation.test.ts tests/integration/command-delivery.test.ts tests/integration/migration-p2.test.ts tests/integration/asset-management.test.ts tests/integration/canvas-result-binding.test.ts
6 files, 76 tests passed
D:\nodejs\node.exe node_modules\typescript\bin\tsc --noEmit -p tsconfig.base.json
no errors
```

Self-review checked cross-project and cross-library refs, staged dependencies, scene deletion, CAS, immutability, receipt replay, event validation, schema10 preservation and the desktop rejection list. No live provider, package, full suite, or user-library operations were run. Task 4 still owns renderer/editor integration. Task 3 still owns generated result history and late automatic selection behavior using the independent CAS surface.

Ruling: map the spec's scene entity category to `kind: 'scene'`; script scenes remain distinct `ScriptScene` rows. Cost if wrong: later Agent/UI consumers might have expected `location`, but no released P3 data exists and this matches the named product entity.
