'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ControlClient } = require('@tempest-term/remote-sdk');

test('real CLI negotiates control protocol and rejects invalid requests', {
  skip: !process.env.TEMPEST_TEST_CLI,
}, async () => {
  const client = new ControlClient(process.env.TEMPEST_TEST_CLI, async () => undefined);
  try {
    assert.deepEqual(await client.request('capabilities'), { protocol: 1 });
    await assert.rejects(client.request('unknown.method'), /remote request failed/);
    // Fails before account/vault access or remote file creation.
    await assert.rejects(client.request('remote.ensure', { serverId: 'invalid' }), /remote request failed/);
  } finally {
    client.dispose();
  }
});
