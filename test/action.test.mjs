import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,cpSync,symlinkSync,rmSync,mkdirSync,readdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {gunzipSync,gzipSync} from 'node:zlib';
import {parse} from 'yaml';
import {pin,hash,verifyCore,project} from '../src/contract.mjs';
import {verifyPackage,inspectArchive,runtimeFiles} from '../tooling/package.mjs';
const root=resolve('.'),upstream=resolve('.test-core'),sentinel='SECRET-RAW-PROVIDER-SENTINEL';
const hostSource=`
import {writeFileSync} from 'node:fs';
import {workflowFixture} from '../nibfin-core/tooling/workflow-fixture.mjs';
import {registrationFixture} from '../nibfin-core/tooling/registration-fixture.mjs';
import {relayFixture} from '../nibfin-core/tooling/relay-fixture.mjs';
export async function configure({core,mode,context}) {
  const f=await workflowFixture(),fault=process.env.FIXTURE_CASE;
  if(typeof core.createWorkflowEntry!=='function')throw Error('wrong loader');
  process.on('exit',()=>writeFileSync(process.env.FIXTURE_AUDIT,JSON.stringify({records:f.sh.records.length,calls:f.calls.length,tokens:['NIBFIN_READ_TOKEN','NIBFIN_HOST_TOKEN','GH_TOKEN','GITHUB_TOKEN'].filter(k=>process.env[k])})));
  if(fault==='unavailable'){console.log('${sentinel}');throw Error('${sentinel}');}
  if(fault==='missing-auth')delete f.host.authenticate;
  if(fault==='denied-auth')f.host.authenticate=async()=>{throw Error('${sentinel}');};
  if(fault==='permission')f.state.denied=true;
  if(fault==='newline')f.host.lookup=async()=>({...f.queuedRequest.target,number:'101\\ninjected=yes'});
  if(mode==='execute') {
    const a=await f.core.run(await f.queued()),authored=a.owner.output,r=authored.author.receipt;
    f.pin.shapeBody=authored.author.body;f.pin.binding.shapeHash=core.bodyDigest(f.pin.shapeBody);
    f.pin.receipts.shape=r;f.pin.evidenceCurrent.shape={expected:structuredClone(r),consumed:[]};f.pin.stageInput=authored;
    f.pin.invocation={request:'validator-request',run:{id:'101',attempt:'1'}};
    const v=await f.core.run(await f.queued()),validated=v.owner.output,vr=validated.validator.receipt;
    f.pin.receipts['shape-validator']=vr;f.pin.evidenceCurrent['shape-validator']={expected:structuredClone(vr),consumed:[]};f.pin.stageInput=validated;
    f.pin.invocation={request:'publish-request',run:{id:'102',attempt:'1'}};
    Object.assign(f.queuedRequest,await f.queued());f.input.nibfin_request='publish-request';f.identity.run={id:'102',attempt:'1'};
  }
  if(['compute','execute'].includes(mode))await f.entry.invoke('resolve',f.input,context);
  if(fault==='unknown'){const retain=f.host.retain;f.host.retain=async r=>{if(r.kind==='stage-result')throw Error('${sentinel}');return retain(r);};}
  if(mode==='wake'){const r=await relayFixture();f.host.relay=async()=>r.configuration();}
  if(mode==='registration') {
    const r=registrationFixture();f.host.authenticate=async()=>({...context,visibility:'public',ownership:'personal'});r.s.publicKey=JSON.parse(process.env.NIBFIN_INPUT).public_key;
    f.host.registration=async()=>({config:{authenticate:async()=>r.s,policy:async()=>r.p,transport:r.transport,channel:r.channel,now:()=>r.state.now},handle:'opaque',prior:'new'});
  }
  return f.host;
}
`;
function consumer(){
  verifyPackage(root);verifyCore(upstream);
  for(const f of pin.contractFixtures)assert.equal(hash(readFileSync(join(upstream,f.path))),f.sha256,f.path);
  const dir=mkdtempSync(join(tmpdir(),'nibfin-consumer-')),pkg=join(dir,'action');mkdirSync(pkg);
  const files=inspectArchive(readFileSync('out/nibfin-action.tgz'),runtimeFiles);
  for(const [name,bytes] of files){mkdirSync(join(pkg,name,'..'),{recursive:true});writeFileSync(join(pkg,name),bytes);}
  cpSync(upstream,join(dir,'nibfin-core'),{recursive:true,filter:p=>!p.split('/').includes('node_modules')&&!p.split('/').includes('.git')});
  cpSync(join(root,'node_modules'),join(dir,'nibfin-core/node_modules'),{recursive:true});mkdirSync(join(dir,'nibfin-host'));
  writeFileSync(join(dir,'nibfin-host/entry.mjs'),hostSource);return {dir,pkg,meta:parse(readFileSync(join(pkg,'action.yml'),'utf8'))};
}
function invoke(c,mode,{fault='',change={},input}={}) {
  const data=input??(mode==='lookup'?{nibfin_request:'request-1',nibfin_correlation:'correlation-1'}:mode==='registration'?
    {nibfin_registration:'request-1',level:'repository',public_key:readFileSync(join(c.dir,'public.pem'),'utf8')}:mode==='wake'?{event:{}}:
    {nibfin_request:mode==='execute'?'publish-request':'request-1',nibfin_correlation:'correlation-1',issue:'101'});
  const env={...process.env,GITHUB_WORKSPACE:c.dir,GITHUB_REPOSITORY:mode==='registration'?'example/core':'example-org/core',GITHUB_REPOSITORY_ID:'42',
    GITHUB_RUN_ID:mode==='execute'?'102':mode==='registration'?'91':'100',GITHUB_RUN_ATTEMPT:'1',GITHUB_EVENT_NAME:'issues',GITHUB_EVENT_PATH:join(c.dir,'event.json'),
    GITHUB_OUTPUT:join(c.dir,'output'),FIXTURE_AUDIT:join(c.dir,'audit'),FIXTURE_CASE:fault,NIBFIN_ACTION_ROOT:c.pkg,
    NIBFIN_BUNDLE_COMMIT:pin.commit,NIBFIN_HOST_COMMIT:'b'.repeat(40),NIBFIN_MODE:mode,NIBFIN_INPUT:JSON.stringify(data),NIBFIN_RESOLUTION:'ref-resolution',
    NIBFIN_HOST_TOKEN:sentinel,NIBFIN_READ_TOKEN:sentinel,GH_TOKEN:sentinel,GITHUB_TOKEN:sentinel,...change};
  writeFileSync(env.GITHUB_OUTPUT,'');rmSync(env.FIXTURE_AUDIT,{force:true});
  writeFileSync(env.GITHUB_EVENT_PATH,JSON.stringify({action:'labeled',repository:{id:42},issue:{node_id:'I_101',number:101,labels:[]},label:{name:'shaped'}}));
  const step=c.meta.runs.steps.find(s=>s.id==='entry');assert.equal(step.run,'node "$NIBFIN_ACTION_ROOT/src/entry.mjs"');
  const r=spawnSync('bash',['-e','-o','pipefail','-c',step.run],{env,encoding:'utf8',timeout:30000});
  const output=readFileSync(env.GITHUB_OUTPUT,'utf8');assert(!output.includes(sentinel));assert(!(r.stdout+r.stderr).includes(sentinel));
  let audit=null;try{audit=JSON.parse(readFileSync(env.FIXTURE_AUDIT));}catch{}
  return {...r,output,audit};
}
test('isolated Candidate workspace contains no symlinks, including ignored dependencies',()=>{
  function scan(path){for(const entry of readdirSync(path,{withFileTypes:true})){const next=join(path,entry.name);
    assert.equal(entry.isSymbolicLink(),false,next);if(entry.isDirectory())scan(next);}}
  scan(root);
});
test('submitted package metadata, exact official release mapping and real-entry consumer modes',async()=>{
  const c=consumer();try{
    const m=verifyPackage();assert.equal(m.source.kind,'candidate');assert.equal(m.source.commit,null);
    const inputs=c.meta.inputs;assert.deepEqual(Object.keys(inputs),'bundle_commit host_commit mode input resolution read_token host_token'.split(' '));
    for(const [k,v] of Object.entries(inputs))assert.equal(v.required,!['resolution','read_token','host_token'].includes(k));
    for(const [k,v] of Object.entries(c.meta.outputs))assert.equal(v.value,'${{ steps.entry.outputs.'+k+' }}');
    for(const s of c.meta.runs.steps){if(s.uses)assert.match(s.uses,/@[a-f0-9]{40}$/);if(s.run)assert(!s.run.includes('${{'));}
    assert.equal(c.meta.runs.steps.find(s=>s.with?.repository).with.ref,pin.commit);
    const wired=c.meta.runs.steps.find(s=>s.id==='entry').env;
    for(const k of ['BUNDLE_COMMIT','HOST_COMMIT','MODE','INPUT','RESOLUTION'])assert.equal(wired['NIBFIN_'+k],'${{ inputs.'+k.toLowerCase()+' }}');
    for(const token of ['read_token','host_token'])assert.equal(wired['NIBFIN_'+token.toUpperCase()],"${{ inputs.mode != 'execute' && inputs.mode != 'compute' && inputs."+token+" || '' }}");
    const {generateKeyPairSync}=await import('node:crypto');writeFileSync(join(c.dir,'public.pem'),generateKeyPairSync('rsa',{modulusLength:2048}).publicKey.export({format:'pem',type:'spki'}));
    for(const [mode,expected] of [['lookup','resolved'],['resolve','selected'],['compute','completed'],['execute','completed'],['wake','run-observed'],['registration','delivered']]){
      const r=invoke(c,mode);assert.equal(r.status,0,mode+': '+r.output+r.stderr);assert(r.output.includes('status='+expected+'\n'),mode+': '+r.output);
      if(['compute','execute'].includes(mode)){assert.deepEqual(r.audit.tokens,[]);assert(r.output.includes('reference=ref-stage-result'));}
      if(mode==='resolve'){assert(r.output.includes('resolution=ref-resolution'));assert(r.output.includes('execution_mode=compute'));assert(r.output.includes('runs_on='));}
      if(mode==='lookup')assert(r.output.includes('issue=101'));if(mode==='registration')assert(r.output.includes('response=ref-registration-result'));
    }
    const official='/inputs/release-manifest.json';
    try {const b=readFileSync(official),p=JSON.parse(b),r=JSON.parse(readFileSync('/inputs/release-api.json')),cd=JSON.parse(readFileSync('/inputs/release-cd-api.json'));
      assert.equal(hash(b),pin.assets.find(a=>a.name==='release-manifest.json').sha256);assert.equal(String(r.id),pin.release.id);assert.equal(r.immutable,true);
      assert.equal(p.source.commit,pin.commit);assert.equal(cd.head_sha,pin.commit);assert.equal(cd.conclusion,'success');
      for(const a of pin.assets){const bytes=readFileSync('/inputs/'+a.name);assert.equal(hash(bytes),a.sha256);assert.equal(bytes.length,a.bytes);}
      assert.equal(p.components.workflow.sha256,pin.components.workflow);assert.deepEqual(p.components.action,{version:'unknown',content:'unknown',status:'unreleased'});
    }catch(e){if(e.code!=='ENOENT')throw e; /* CI uses the fixed source checkout; publication records are supplied to independent roles. */}
  }finally{rmSync(c.dir,{recursive:true,force:true});}
});
test('early transport/content rejection, safe permission failures and opaque unknown result',()=>{
  const c=consumer();try{
    for(const change of [{NIBFIN_MODE:'shell'},{NIBFIN_BUNDLE_COMMIT:'main'},{NIBFIN_BUNDLE_COMMIT:'a'.repeat(40)},
      {NIBFIN_HOST_COMMIT:'main'},{NIBFIN_INPUT:'{'},{NIBFIN_INPUT:'[]'},{NIBFIN_INPUT:'{}'},{NIBFIN_INPUT:'x'.repeat(16385)},
      {NIBFIN_INPUT:'{"nibfin_request":"x","nibfin_correlation":"x","command":"echo SECRET"}'},
      {NIBFIN_INPUT:'{"nibfin_request":1,"nibfin_correlation":"x"}'}]){
      const r=invoke(c,'lookup',{change});assert.notEqual(r.status,0);assert.equal(r.audit,null);assert(!r.output.includes('SECRET'));
    }
    for(const change of [{NIBFIN_RESOLUTION:''},{NIBFIN_RESOLUTION:'x\ny=z'}]){const r=invoke(c,'compute',{change});assert.notEqual(r.status,0);assert.equal(r.audit,null);}
    for(const mode of ['resolve','compute','execute','registration','wake']){const r=invoke(c,mode,{input:{}});assert.notEqual(r.status,0);assert.equal(r.audit,null);}
    for(const issue of [1,'01','0','1\nfoo=bar']){const r=invoke(c,'resolve',{input:{issue,nibfin_request:'a',nibfin_correlation:'b'}});assert.notEqual(r.status,0);assert.equal(r.audit,null);}
    for(const fault of ['unavailable','missing-auth','denied-auth','permission','newline']){
      const r=invoke(c,fault==='permission'?'resolve':'lookup',{fault});assert.notEqual(r.status,0);assert(r.output.includes('status=blocked'));assert.equal(r.audit.records,0);
    }
    const r=invoke(c,'compute',{fault:'unknown'});assert.notEqual(r.status,0);assert(r.output.includes('status=unresolved'));assert(r.output.includes('request=request-1'));assert.equal(r.audit.records,1);
    writeFileSync(join(c.dir,'nibfin-core/src/workflow-entry.mjs'),'throw Error("changed")');
    const wrong=invoke(c,'lookup');assert.notEqual(wrong.status,0);assert.equal(wrong.audit,null);
    for(const s of ['status=resolved\ninjected=yes\n','status=resolved\nstatus=completed\n','status=resolved\nreference=x\rfoo=y\n',
      'status=resolved\nreference=bad value\n','status=resolved\nrequest='+('a'.repeat(81))+'\n'])assert.throws(()=>project(s));
  }finally{rmSync(c.dir,{recursive:true,force:true});}
});
test('mapping/archive alteration, missing entry, unexpected entries and symlinks fail closed',()=>{
  const dir=mkdtempSync(join(tmpdir(),'nibfin-package-'));try{
    for(const file of [...runtimeFiles,'out/nibfin-action.tgz','out/action-release-manifest.json',...verifyPackage().source.files.map(f=>f.path)]){
      mkdirSync(join(dir,file,'..'),{recursive:true});cpSync(file,join(dir,file));
    }
    const original=readFileSync(join(dir,'out/action-release-manifest.json'));
    for(const mutate of [m=>m.format=2,m=>m.package='wrong',m=>m.version='9.0.0',m=>m.core.commit='main',m=>delete m.core.release,
      m=>m.archive.sha256='0'.repeat(64),m=>m.source.commit='a'.repeat(40)]){
      const m=JSON.parse(original);mutate(m);writeFileSync(join(dir,'out/action-release-manifest.json'),JSON.stringify(m));assert.throws(()=>verifyPackage(dir));
    }
    writeFileSync(join(dir,'out/action-release-manifest.json'),original);writeFileSync(join(dir,'src/entry.mjs'),'changed');assert.throws(()=>verifyPackage(dir));
    const bytes=readFileSync('out/nibfin-action.tgz');
    for(const attack of [h=>{h.fill(0,0,100);h.write('../action.yml');},h=>{h[156]=50;h.write('/tmp/unsafe',157);}]){
      const tar=gunzipSync(bytes),h=tar.subarray(0,512);attack(h);h.fill(32,148,156);let sum=0;for(const b of h)sum+=b;h.write(sum.toString(8).padStart(6,'0')+'\0 ',148);assert.throws(()=>inspectArchive(gzipSync(tar),runtimeFiles));
    }
    assert.throws(()=>inspectArchive(bytes,[...runtimeFiles,'missing']));assert.throws(()=>inspectArchive(bytes,runtimeFiles.slice(1)));
    rmSync(join(dir,'src/entry.mjs'));symlinkSync(join(root,'src/entry.mjs'),join(dir,'src/entry.mjs'));assert.throws(()=>verifyPackage(dir));
  }finally{rmSync(dir,{recursive:true,force:true});}
});
