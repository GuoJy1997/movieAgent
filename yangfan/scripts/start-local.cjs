// Configuration belongs to the software repository. Never print or overwrite user credentials.
const { mkdirSync, writeFileSync, readFileSync, copyFileSync, constants, existsSync } = require('node:fs');
const { resolve, join } = require('node:path');
const { spawn } = require('node:child_process');
const repository = resolve(__dirname, '..');
const base = resolve(repository, '..');
const executable = resolve(__dirname, '../apps/desktop/release/win-unpacked/MovieAgent.exe');
if (!existsSync(executable)) throw Error('Build and package MovieAgent before local delivery.');
mkdirSync(join(repository, 'config'), { recursive: true });
mkdirSync(join(base, 'projects'), { recursive: true });
const example = JSON.stringify({ schemaVersion: 1, providers: [{ id: 'image-default', name: '默认图像服务', kind: 'image', baseURL: '', apiKey: '', modelId: '', allowPrivateEndpoint: false }] }, null, 2) + '\n';
const config = join(repository, 'config/models.json'), legacyConfig = join(base, 'config/models.json'), command = join(base, '启动MovieAgent.cmd');
function createMissing(path, source) { try { writeFileSync(path, source, { flag: 'wx', mode: 0o600 }); return 'created'; } catch (error) { if (error.code === 'EEXIST') return 'preserved'; throw error; } }
function prepareConfig() {
  if (existsSync(config)) return 'preserved';
  try { copyFileSync(legacyConfig, config, constants.COPYFILE_EXCL); return 'migrated'; }
  catch (error) { if (error.code === 'EEXIST') return 'preserved'; if (error.code !== 'ENOENT') throw error; }
  return createMissing(config, example);
}
const launchCommand = path => `@echo off\r\nchcp 65001 >nul\r\nstart "MovieAgent" "${executable}" --project-launcher "--model-config=${path}"\r\n`;
function prepareLauncher() {
  const state = createMissing(command, launchCommand(config));
  if (state === 'preserved' && readFileSync(command, 'utf8') === launchCommand(legacyConfig)) {
    writeFileSync(command, launchCommand(config)); return 'updated';
  }
  return state;
}
const result = { config: prepareConfig(), example: createMissing(join(repository, 'config/models.example.json'), example), launcher: prepareLauncher(), executable, command, configPath: config };
console.log(JSON.stringify(result));
if (!process.argv.includes('--prepare-only')) { const child = spawn(executable, ['--project-launcher', `--model-config=${config}`], { detached: true, stdio: 'ignore', windowsHide: false }); child.on('error', () => { console.error('MovieAgent could not start.'); process.exitCode = 1; }); child.unref(); }
