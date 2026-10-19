'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');

test('launcher completes prompt handoff, emits no secret/session token and releases its SSH child', {skip: process.platform === 'win32', timeout: 10000}, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'tempest lifecycle '));
  const cli = path.join(root,'tempest');
  fs.writeFileSync(cli, `#!${process.execPath}
const rl=require('node:readline').createInterface({input:process.stdin});
let pending;
const send=(id,result)=>console.log(JSON.stringify({type:'response',id,result}));
rl.on('line',line=>{const f=JSON.parse(line);
 if(f.type==='prompt_response'){if(f.value!=='test-local-secret')process.exit(4);send(pending,[{id:'opaque-id',label:'cloudnet'}]);return;}
 if(f.method==='capabilities')send(f.id,{protocol:1});
 if(f.method==='servers.list'){pending=f.id;console.log(JSON.stringify({type:'prompt',id:'p1',kind:'password',message:'Unlock test vault'}));}
 if(f.method==='remote.ensure')send(f.id,{sshHost:'tempest-cloudnet-123456789abc',sessionId:'b'.repeat(64)});
});
`, {mode:0o755});
  fs.writeFileSync(path.join(root,'ssh'), `#!${process.execPath}
if(process.argv.includes('-N')){require('node:fs').writeFileSync(process.env.TEMPEST_TEST_PID,String(process.pid));setInterval(()=>{},1000);} else process.exit(0);
`, {mode:0o755});
  const child = spawn(process.execPath,[path.resolve(__dirname,'../scripts/remote.js'),'connect','--server','cloudnet','--editor','zed','--folder','/tmp/a b','--no-open','--prompt-json','--cli-path',cli], {
    env:{...process.env,PATH:root+path.delimiter+process.env.PATH,TEMPEST_TEST_PID:path.join(root,'pid')},stdio:['pipe','pipe','pipe']
  });
  let output=''; let error=''; child.stdout.on('data',x=>output+=x); child.stderr.on('data',x=>error+=x);
  const closed=once(child,'exit');
  try {
    await new Promise((resolve,reject)=>{
      const lines=readline.createInterface({input:child.stdout});
      child.once('exit',()=>reject(Error('Launcher exited before ready: '+error)));
      lines.on('line',line=>{const frame=JSON.parse(line);if(frame.type==='prompt')child.stdin.write(JSON.stringify({id:frame.prompt.id,answer:'test-local-secret'})+'\n');if(frame.type==='connected'){lines.close();resolve();}});
    });
    assert.ok(output.includes('ssh://tempest-cloudnet-123456789abc/tmp/a%20b'));
    assert.ok(!output.includes('test-local-secret'));assert.ok(!output.includes('b'.repeat(64)));
    const pid=Number(fs.readFileSync(path.join(root,'pid'),'utf8'));
    child.kill('SIGTERM');
    assert.equal((await closed)[0],130);
    assert.throws(()=>process.kill(pid,0),{code:'ESRCH'});
  } finally {child.kill();fs.rmSync(root,{recursive:true,force:true});}
});

test('GUI protocol reports a missing CLI as a structured error and exits', {timeout: 10000}, async () => {
  const child = spawn(process.execPath,[path.resolve(__dirname,'../scripts/remote.js'),'--prompt-json','--cli-path',path.join(os.tmpdir(),'tempest-missing-executable-73e1c0'),'list'],{stdio:['ignore','pipe','pipe']});
  let output=''; child.stdout.on('data',x=>output+=x);
  const [code] = await once(child,'exit');
  assert.equal(code,1);
  const frames=output.trim().split('\n').map(line=>JSON.parse(line));
  assert.ok(frames.some(frame=>frame.type==='progress' && frame.stage==='servers'));
  assert.ok(frames.some(frame=>frame.type==='error' && /Cannot launch Tempest CLI/.test(frame.message)));
});

test('GUI server loading can be cancelled before the CLI responds', {skip:process.platform==='win32',timeout:10000},async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'tempest pending '));
  const cli=path.join(root,'tempest');
  fs.writeFileSync(cli,`#!${process.execPath}\nprocess.stdin.resume();setInterval(()=>{},1000);\n`,{mode:0o755});
  const child=spawn(process.execPath,[path.resolve(__dirname,'../scripts/remote.js'),'--prompt-json','--cli-path',cli,'list'],{stdio:['pipe','pipe','pipe']});
  const closed=once(child,'exit');
  try {
    await once(child.stdout,'data');
    child.kill('SIGTERM');
    assert.equal((await closed)[0],130);
  } finally {child.kill();fs.rmSync(root,{recursive:true,force:true});}
});

for (const direct of [true, false]) test(`Gateway bootstrap ${direct ? 'hands off a direct SSH endpoint' : 'rejects an older CLI endpoint'} without SSH or IDE commands`, {skip:process.platform==='win32',timeout:10000},async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'tempest gateway '));
 const cli=path.join(root,'tempest');
 const requests=path.join(root,'requests');const disposed=path.join(root,'disposed');const sshCalled=path.join(root,'ssh-called');
 fs.writeFileSync(cli,`#!${process.execPath}
const fs=require('node:fs');const rl=require('node:readline').createInterface({input:process.stdin});
const send=(id,result)=>console.log(JSON.stringify({type:'response',id,result}));
rl.on('line',line=>{const f=JSON.parse(line);fs.appendFileSync(process.env.TEMPEST_TEST_REQUESTS,f.method+'\\n');
 if(f.method==='capabilities')send(f.id,{protocol:1});
 if(f.method==='servers.list')send(f.id,[{id:'saved-server',label:'cloudnet'}]);
 if(f.method==='remote.ensure')send(f.id,{sshHost:'tempest-cloudnet-123456789abc',sessionId:'b'.repeat(64),...${direct ? JSON.stringify({ssh:{host:'127.0.0.1',port:43210,user:'tempest',identityFile:'/test/client_key',hostKey:'ssh-ed25519 test-public-key'}}) : '{}'}});
});
rl.on('close',()=>{fs.writeFileSync(process.env.TEMPEST_TEST_DISPOSED,'disposed');process.exit(0)});
process.on('SIGTERM',()=>{fs.writeFileSync(process.env.TEMPEST_TEST_DISPOSED,'killed');process.exit(1)});
`,{mode:0o755});
 fs.writeFileSync(path.join(root,'ssh'),`#!${process.execPath}\nrequire('node:fs').writeFileSync(process.env.TEMPEST_TEST_SSH,'unexpected');process.exit(99);\n`,{mode:0o755});
 const child=spawn(process.execPath,[path.resolve(__dirname,'../scripts/remote.js'),'connect','--server','cloudnet','--editor','jetbrains','--prompt-json','--cli-path',cli],{stdio:['ignore','pipe','pipe'],env:{...process.env,PATH:root+path.delimiter+process.env.PATH,TEMPEST_TEST_REQUESTS:requests,TEMPEST_TEST_DISPOSED:disposed,TEMPEST_TEST_SSH:sshCalled}});
 let output='';child.stdout.on('data',b=>output+=b);child.stderr.resume();
 try {
  const [code]=await once(child,'exit');assert.equal(code,direct ? 0 : 1);
  const frames=output.trim().split('\n').map(s=>JSON.parse(s));
  if (!direct) {
   assert.ok(frames.some(f=>f.type==='error' && /direct SSH endpoint/.test(f.message)));
   assert.ok(!frames.some(f=>f.type==='connected'));
  }
  const ready=frames.find(f=>f.type==='connected');
  if (direct) {
  assert.equal(ready.gateway.sshHost,'tempest-cloudnet-123456789abc');assert.equal(ready.gateway.port,43210);
  assert.equal(ready.gateway.host,'127.0.0.1');
  assert.equal(ready.gateway.hostKey,'ssh-ed25519 test-public-key');
  assert.equal(ready.target,undefined);assert.equal(ready.gateway.identityFile,'/test/client_key');
  }
  assert.ok(!output.includes('b'.repeat(64)));assert.ok(!fs.existsSync(sshCalled));
  assert.deepEqual(fs.readFileSync(requests,'utf8').trim().split('\n'),['capabilities','servers.list','capabilities','remote.ensure']);
  const deadline=Date.now()+1500;
  while(!fs.existsSync(disposed)&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(fs.readFileSync(disposed,'utf8'),'disposed');
 }finally{child.kill();fs.rmSync(root,{recursive:true,force:true});}
});
