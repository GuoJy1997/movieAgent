# Software-local model configuration correction

User clarified that model configuration belongs inside the MovieAgent software project; unified page editing is a subsequent feature.

- Active local file: D:/movieAgent/libtv-studio/config/models.json. Entry: D:/movieAgent/启动MovieAgent.cmd.
- Preparation copies old configuration bytes only when the new file is missing; old D:/movieAgent/config/models.json remains an unused backup. Existing repository config wins. No credential content is printed.
- Only an exact copy of the previously generated launch script receives the automatic path update; customized scripts remain unchanged. The repository config/ directory is ignored by Git; canonical blank example remains configs/models.example.json.
- Current model settings can import this file and edit database revisions, but do not yet write back the JSON. Future page work must use one main-owned global configuration source, retain/mask existing keys and explicitly import revisions into workspaces.

Verification: focused RED 2 failed/1 passed for old external location; GREEN 3/3. npm test: 17 files,246 tests passed. npm run typecheck: exit0. Existing Node SQLite experimental warnings remain. Electron source/package was unchanged, so no package rebuild/full Electron rerun was warranted.

Actual preparation returned migrated/created/updated, then preserved on repeat. Existing launcher was closed normally and the visible launcher reopened (PID24060, nonzero window handle). launcher-settings.json references the repository file. Only metadata and a boolean byte-equality check were displayed; real JSON/keys were not printed. No provider call was requested. Previously opened workbenches use the new source after reopening through the updated launcher.

Independent focused review approved with no actionable findings; report retained in test-results/local-config-location-review.md.
