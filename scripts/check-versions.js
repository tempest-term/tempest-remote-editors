'use strict';
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = file => readFileSync(path.join(root, file), 'utf8');
const version = JSON.parse(read('package.json')).version;
for (const file of ['package-lock.json','vscode/package.json','vscode/package-lock.json']) {
  const manifest = JSON.parse(read(file));
  assert.equal(manifest.version, version, `${file} release version`);
  if (manifest.packages) assert.equal(manifest.packages[''].version, version, `${file} root version`);
}
assert.equal(read('jetbrains/build.gradle.kts').match(/^version = "([^"]+)"/m)?.[1], version, 'JetBrains Gradle version');
assert.equal(read('jetbrains/src/main/resources/META-INF/plugin.xml').match(/<version>([^<]+)<\/version>/)?.[1], version, 'JetBrains plugin version');
const extension = JSON.parse(read('vscode/package.json'));
assert.equal(extension.name, 'tempest-remote');
assert.equal(extension.publisher, 'AltasExpressLLC');
console.log(`All editor versions match ${version}; VS Code Marketplace identity is preserved.`);
