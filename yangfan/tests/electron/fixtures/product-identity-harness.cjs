// Fresh appData only. Import the actual built main; no renderer/engine stubs.
const { app } = require('electron');
const path = require('node:path');
const root = process.argv.find(value => value.startsWith('--test-app-data=')).slice('--test-app-data='.length);
app.setPath('appData', root);
require(path.resolve(__dirname, '../../..', 'apps/desktop/out/main/index.js'));
