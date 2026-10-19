'use strict';
const { mkdirSync, copyFileSync, readFileSync } = require('node:fs');
const path = require('node:path');
const sdk = path.dirname(require.resolve('@tempest-term/remote-sdk'));
const output = path.resolve(__dirname, '../lib');
mkdirSync(output, { recursive: true });
// The SDK has no runtime dependencies. Bundle its released entry point and
// license so an editor installation needs neither npm install nor node_modules.
copyFileSync(path.join(sdk, 'index.js'), path.join(output, 'remote-sdk.cjs'));
copyFileSync(path.join(sdk, '../LICENSE'), path.join(output, 'REMOTE-SDK-LICENSE'));
const { version } = JSON.parse(readFileSync(path.join(sdk, '../package.json'), 'utf8'));
console.log(`Bundled tempest-remote-sdk ${version}.`);
