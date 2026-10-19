'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {target}=require('../scripts/clients');
const host='tempest-cloudnet-123456789abc';
test('editor targets preserve spaces, unicode and URL delimiters without executing a shell', () => {
  const folder = '/home/me/项目 a#b?c';
  assert.equal(target('zed',host,folder).args[0], `ssh://${host}/home/me/%E9%A1%B9%E7%9B%AE%20a%23b%3Fc`);
  assert.deepEqual(target('cursor',host,folder).args, ['--new-window','--remote',`ssh-remote+${host}`,folder]);
  assert.throws(()=>target('zed','-oProxyCommand=evil',folder));
  assert.throws(()=>target('zed',host,'relative'));
  assert.throws(()=>target('cursor',host,'/a\nb'));
});
