'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const { isSshHost } = require('@tempest-term/remote-sdk');
const host = 'tempest-server-aaaaaaaaaaaa';
let command;
let calls;
let cancel;
let saved;
let remoteFolders;
let failEnsure;
let progressTokens;
let ensurePending;
let ensureReject;
let capabilityProtocol;
const vscode = {
  ProgressLocation: { Notification: 15 },
  CancellationTokenSource: class {
    constructor() { this.token = { isCancellationRequested: false }; }
    cancel() { this.token.isCancellationRequested = true; }
    dispose() {}
  },
  extensions: { getExtension: () => undefined },
  workspace: {
    get workspaceFolders() { return remoteFolders; },
    getConfiguration: section => ({ get: (key, fallback) => section === 'remote.SSH' ? '/tmp/custom ssh config' : fallback }),
  },
  window: {
    withProgress: async (options, task) => {
      calls.push(['progress', options]);
      const token = { callback: undefined, onCancellationRequested(callback) {
        this.callback = callback; return { dispose() { token.callback = undefined; } };
      } };
      progressTokens.push(token);
      return task({ report() {} }, token);
    },
    createOutputChannel: () => ({ appendLine() {}, dispose() {} }),
    showQuickPick: async items => cancel ? undefined : items[0],
    showInputBox: async options => { calls.push(['input', options]); return options.password ? 'password' : '/workspace'; },
    showErrorMessage: async message => calls.push(['error', message]),
  },
  commands: {
    registerCommand: (name, callback) => { if (name === 'tempest.connect') command = callback; return { dispose() {} }; },
    executeCommand: async (...args) => calls.push(['command', ...args]),
  },
  Uri: { from: value => value },
};
class FakeClient {
  constructor(_executable, prompt) { this.prompt = prompt; }
  async request(method, params) {
    calls.push(['request', method, params]);
    if (method === 'capabilities') return { protocol: capabilityProtocol };
    if (method === 'servers.list') {
      await this.prompt({ kind: 'password', message: 'Unlock vault' });
      return [{ id: '["account","vault","server"]', label: 'Server' }];
    }
    if (ensurePending) return new Promise((_, reject) => { ensureReject = reject; });
    if (failEnsure) throw new Error('Test remote failed.');
    return { sshHost: host, sessionId: 'b'.repeat(64) };
  }
  cancel() { calls.push(['cancel']); const error = new Error('cancelled'); error.name = 'CancellationError'; ensureReject?.(error); }
  dispose() { calls.push(['dispose']); }
}
const original = Module._load;
Module._load = function(request, ...args) {
  if (request === 'vscode') return vscode;
  if (request === '@tempest-term/remote-sdk') return { ControlClient: FakeClient, isSshHost };
  return original.call(this, request, ...args);
};
const { activate } = require('../src/extension');
Module._load = original;
function context() {
  calls = []; cancel = false; saved = new Map(); remoteFolders = []; failEnsure = false; progressTokens = []; ensurePending = false; ensureReject = undefined; capabilityProtocol = 1;
  return { subscriptions: [], globalState: {
    update: async (key, value) => saved.set(key, value),
    get: key => saved.get(key),
  } };
}
test('connect prompts locally, passes custom config and opens the saved remote folder', async () => {
  const ctx = context();
  await activate(ctx);
  await command();
  assert.equal(calls.find(call => call[0] === 'input')[1].password, true);
  const ensure = calls.find(call => call[1] === 'remote.ensure');
  assert.equal(ensure[2].configFile, '/tmp/custom ssh config');
  assert.deepEqual(calls.find(call => call[1] === 'vscode.openFolder').slice(2), [
    { scheme: 'vscode-remote', authority: `ssh-remote+${host}`, path: '/workspace' }, { forceNewWindow: true },
  ]);
  assert.ok(saved.has(`remote.${host}`));
  assert.equal(calls.at(-1)[0], 'dispose');
});
test('cancel server picker avoids creating a remote', async () => {
  const ctx = context();
  cancel = true;
  await activate(ctx);
  await command();
  assert.equal(calls.some(call => call[1] === 'remote.ensure'), false);
  assert.equal(calls.some(call => call[1] === 'vscode.openFolder'), false);
});
test('recent remote folder recreates the matching remote during activation', async () => {
  const ctx = context();
  saved.set(`remote.${host}`, { serverId: 'saved-source' });
  remoteFolders = [{ uri: { authority: `ssh-remote+${host}` } }];
  await activate(ctx);
  assert.deepEqual(calls.find(call => call[1] === 'remote.ensure')[2], {
    serverId: 'saved-source', configFile: '/tmp/custom ssh config',
  });
});


test('failed connection releases the lock without waiting for notification dismissal', async () => {
  const ctx = context();
  const original = vscode.window.showErrorMessage;
  vscode.window.showErrorMessage = message => {
    calls.push(['error', message]);
    return new Promise(() => {});
  };
  try {
    failEnsure = true;
    await activate(ctx);
    await command();
    assert.ok(calls.some(call => call[0] === 'error'));
    assert.equal(calls.at(-1)[0], 'dispose');
    failEnsure = false;
    await command();
    assert.equal(calls.filter(call => call[1] === 'remote.ensure').length, 2);
    assert.ok(calls.some(call => call[1] === 'vscode.openFolder'));
  } finally {
    vscode.window.showErrorMessage = original;
  }
});


test('connecting notification stays cancellable while setup is pending and cancellation permits retry', async () => {
  const ctx = context();
  ensurePending = true;
  await activate(ctx);
  const running = command();
  // Allow the loading/picker phases to reach the pending ensure request.
  while (!ensureReject) await new Promise(resolve => setImmediate(resolve));
  const progress = calls.filter(call => call[0] === 'progress').at(-1)[1];
  assert.equal(progress.title, 'Tempest: Connecting to Server');
  assert.equal(progress.location, vscode.ProgressLocation.Notification);
  assert.equal(progress.cancellable, true);
  progressTokens.at(-1).callback();
  await running;
  assert.ok(calls.some(call => call[0] === 'cancel'));
  assert.equal(calls.some(call => call[0] === 'error'), false);
  ensurePending = false;
  await command();
  assert.ok(calls.some(call => call[1] === 'vscode.openFolder'));
});


test('unsupported protocol is rejected before a tunnel is created', async () => {
  const ctx = context();
  capabilityProtocol = 2;
  await activate(ctx);
  await command();
  assert.match(calls.find(call => call[0] === 'error')[1], /protocol v1/);
  assert.equal(calls.some(call => call[1] === 'remote.ensure'), false);
  assert.equal(calls.some(call => call[1] === 'vscode.openFolder'), false);
  assert.equal(calls.at(-1)[0], 'dispose');
});
