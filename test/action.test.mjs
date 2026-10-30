import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,cpSync,symlinkSync,rmSync,mkdirSync,readdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {gunzipSync,gzipSync} from 'node:zlib';
import {parse} from 'yaml';
import {pin,hash,verifyCore,project} from '../src/contract.mjs';
import {verifyPackage,inspectArchive,runtimeFiles} from '../tooling/package.mjs';
const readinessSource=`
import {writeFileSync} from 'node:fs';
const calls=[];process.on('exit',()=>{if(process.env.FIXTURE_AUDIT)writeFileSync(process.env.FIXTURE_AUDIT+'.readiness',JSON.stringify(calls));});
export async function observeCapability(r){calls.push({capability:r.capability,version:r.version,sha256:r.sha256});if(process.env.FIXTURE_CASE==='readiness-'+r.capability)return null;if(process.env.FIXTURE_CASE==='incompatible-'+r.capability)return {version:99,status:'verified',sha256:r.sha256};return {...r,status:'verified'};}
export const runner={configuration:{version:1,platform:'linux',arch:'x64',path:'/usr/local/bin:/usr/bin:/bin',interpreter:'/usr/local/bin/node',work:'/fixture/work',scratch:'/fixture/scratch',cache:'/fixture/cache',account:{user:'member',uid:1000,githubUserId:'7'}},
observe:async()=>({platform:'linux',arch:'x64',uid:1000,user:'member',tokenOverride:false,roots:{work:true,scratch:true,cache:true}}),probe:async()=>({status:'verified',userId:'7'})};
`;
const root=resolve('.'),upstream=resolve('.test-core'),sentinel='SECRET-RAW-PROVIDER-SENTINEL';
const fixtureSource=`
import {writeFileSync} from 'node:fs';
import {workflowFixture} from 'FIXTURE/workflow-fixture.mjs';
import {registrationFixture} from 'FIXTURE/registration-fixture.mjs';
import {relayFixture} from 'FIXTURE/relay-fixture.mjs';
import {hostIdentityFixture} from 'FIXTURE/host-identity-fixture.mjs';
import {prepareGrouped} from 'GROUPED';
async function fixtureHost({core,mode,context}) {
  const f=await workflowFixture(),fault=process.env.FIXTURE_CASE;
  if(typeof core.createWorkflowEntry!=='function')throw Error('wrong loader');
  process.on('exit',()=>writeFileSync(process.env.FIXTURE_AUDIT,JSON.stringify({records:f.sh.records.length,calls:f.calls.length,tokens:['NIBFIN_READ_TOKEN','NIBFIN_HOST_TOKEN','GH_TOKEN','GITHUB_TOKEN'].filter(k=>process.env[k])})));
  if(fault==='unavailable'){console.log('${sentinel}');throw Error('${sentinel}');}
  if(fault==='missing-auth')delete f.host.authenticate;
  if(fault==='denied-auth')f.host.authenticate=async()=>{throw Error('${sentinel}');};
  if(fault==='permission')f.state.denied=true;
  if(fault==='waiting')for(const r of f.sf.routes[f.sf.prefix+'/actions/runners?per_page=100'].runners)r.status='offline';
  if(fault==='hang')f.host.lookup=async()=>{writeFileSync(process.env.FIXTURE_AUDIT+'.pid',String(process.pid));setInterval(()=>{},1000);return new Promise(()=>{});};
  if(fault==='stdout'){console.log('${sentinel}');console.error('${sentinel}');}
  if(fault==='malformed-output')writeFileSync(process.env.GITHUB_OUTPUT,'status=resolved\\nstatus=completed\\nreference=${sentinel}\\n');
  if(fault.startsWith('credential-output'))f.host.lookup=async()=>{writeFileSync(process.env.GITHUB_OUTPUT,'status=resolved\\nreference='+(fault==='credential-output-encoded'?Buffer.from(process.env.NIBFIN_HOST_TOKEN).toString('base64url'):process.env.NIBFIN_HOST_TOKEN)+'\\n');process.exit(0);};
  if(fault==='nonzero-success')f.host.lookup=async()=>{writeFileSync(process.env.GITHUB_OUTPUT,'status=completed\\n');process.exit(2);};
  if(fault==='zero-failure')f.host.lookup=async()=>{writeFileSync(process.env.GITHUB_OUTPUT,'status=blocked\\n');process.exit(0);};
  if(fault==='newline')f.host.lookup=async()=>({...f.queuedRequest.target,number:'101\\ninjected=yes'});
  if(mode==='execute') {
    const a=await f.core.run(await f.queued()),authored=a.owner.output,r=authored.author.receipt;
    f.pin.shapeBody=authored.author.body;f.pin.binding.shapeHash=core.bodyDigest(f.pin.shapeBody);
    f.pin.receipts.shape=r;f.pin.evidenceCurrent.shape={expected:structuredClone(r),consumed:[]};f.pin.stageInput=authored;
    f.pin.invocation={request:'validator-request',run:{id:'101',attempt:'1'}};
    const v=await f.core.run(await f.queued()),validated=v.owner.output,vr=validated.validator.receipt;
    f.pin.receipts['shape-validator']=vr;f.pin.evidenceCurrent['shape-validator']={expected:structuredClone(vr),consumed:[]};f.pin.stageInput=validated;
    f.pin.invocation={request:'publish-request',run:{id:'102',attempt:'1'}};
    Object.assign(f.queuedRequest,await f.queued());f.input.nibfin_request='publish-request';f.input.nibfin_stage='publication';f.identity.run={id:'102',attempt:'1'};
  }
  let grouped;
  if(fault==='grouped'||fault==='reused-history')grouped=await prepareGrouped(f,fault==='reused-history');
  if(grouped)process.on('exit',()=>{writeFileSync(process.env.FIXTURE_AUDIT+'.grouped',JSON.stringify({history:grouped.history,current:f.pin.receipts,old:grouped.old,run:f.pin.invocation.run,records:grouped.a.records}));grouped.a.close();});
  if(['compute','execute'].includes(mode))await f.entry.invoke('resolve',f.input,context);
  if(fault==='unknown'){const retain=f.host.retain;f.host.retain=async r=>{if(r.kind==='stage-result')throw Error('${sentinel}');return retain(r);};}
  if(mode==='wake'){const r=await relayFixture();f.host.relay=async()=>r.configuration();}
  if(mode==='registration') {
    const r=registrationFixture();f.host.authenticate=async()=>({...context,visibility:'public',ownership:'personal'});r.s.publicKey=JSON.parse(process.env.NIBFIN_INPUT).public_key;
    f.host.registration=async()=>({config:{authenticate:async()=>r.s,policy:async()=>r.p,transport:r.transport,channel:r.channel,now:()=>r.state.now},handle:'opaque',prior:'new'});
  }
  if(fault.startsWith('oidc-')){
    const h=await hostIdentityFixture('lookup'),kind=fault.slice(5);
    if(kind==='personal')h.replies['/repos/example-org/core'].owner.type='User';
    if(['actor','attempt','repository','workflow','version','audience'].includes(kind))h.state.token=await h.sign({[{actor:'actor_id',attempt:'run_attempt',repository:'repository_id',workflow:'workflow_ref',version:'workflow_sha',audience:'aud'}[kind]]:'forged'});
    if(kind==='signature')h.state.token=h.state.token.slice(0,-10)+'forgeddata';
    const adapter=h.make();
    f.host.authenticate=argument=>adapter.authenticate(argument);
    f.host.lookup=async()=>{h.state.lookup++;return {repository:h.config.options.repository,repositoryId:h.config.options.repositoryId,number:'101'};};
    process.on('exit',()=>writeFileSync(process.env.FIXTURE_AUDIT+'.oidc',JSON.stringify({calls:h.calls.length,lookup:h.state.lookup})));
  }
  return Object.fromEntries(names[mode].map(k=>[k,f.host[k]]));
}
const names={lookup:['authenticate','lookup'],resolve:['authenticate','delivery','retain'],execute:['authenticate','delivery','retain','retrieve','verifyRunner'],compute:['authenticate','delivery','retain','retrieve','verifyRunner'],wake:['authenticate','relay'],registration:['authenticate','registration','retain']};
const mode=process.env.NIBFIN_MODE;
const context={repository:process.env.GITHUB_REPOSITORY,repositoryId:process.env.GITHUB_REPOSITORY_ID,run:{id:process.env.GITHUB_RUN_ID,attempt:process.env.GITHUB_RUN_ATTEMPT}};
const core=await import('CORE');
export const capabilities={[mode]:await fixtureHost({core,mode,context})};
`;
export function consumer(){
  verifyPackage(root);verifyCore(upstream);
  
  const dir=mkdtempSync(join(tmpdir(),'nibfin-consumer-')),pkg=join(dir,'action');mkdirSync(pkg);
  const files=inspectArchive(readFileSync('out/nibfin-action.tgz'),runtimeFiles);
  for(const [name,bytes] of files){mkdirSync(join(pkg,name,'..'),{recursive:true});writeFileSync(join(pkg,name),bytes);}
  cpSync(upstream,join(dir,'nibfin-bundle'),{recursive:true,filter:p=>!p.split('/').includes('node_modules')&&!p.split('/').includes('.git')});
  cpSync(join(upstream,'node_modules'),join(dir,'nibfin-bundle/node_modules'),{recursive:true});mkdirSync(join(dir,'nibfin-host'));
  cpSync(join(upstream,'host'),join(dir,'nibfin-host/host'),{recursive:true});
  cpSync(join(root,'.test-fixtures'),join(dir,'.test-fixtures'),{recursive:true});
  for(const file of readdirSync(join(dir,'.test-fixtures'))){const p=join(dir,'.test-fixtures',file);writeFileSync(p,readFileSync(p,'utf8').replaceAll('../.test-core/','../nibfin-bundle/'));}
  cpSync(join(root,'node_modules'),join(dir,'node_modules'),{recursive:true});
  mkdirSync(join(dir,'test'));for(const name of ['rescue-fixture.mjs','grouped-fixture.mjs'])writeFileSync(join(dir,'test',name),readFileSync('test/'+name,'utf8').replaceAll('../.test-core/','../nibfin-bundle/'));
  return {dir,pkg,meta:parse(readFileSync(join(pkg,'action.yml'),'utf8'))};
}
export function invoke(c,mode,{fault='',change={},input,deploymentSource,timeoutMs}={}) {
  const data=input??(mode==='lookup'?{nibfin_request:'request-1',nibfin_correlation:'correlation-1'}:mode==='registration'?
    {nibfin_registration:'request-1',level:'repository',public_key:readFileSync(join(c.dir,'public.pem'),'utf8')}:mode==='wake'?{event:{}}:
    {nibfin_request:mode==='execute'?'publish-request':'request-1',nibfin_correlation:'correlation-1',issue:'101'});
  const env={...process.env,GITHUB_WORKSPACE:c.dir,GITHUB_REPOSITORY:mode==='registration'?'example/core':'example-org/core',GITHUB_REPOSITORY_ID:'42',
    GITHUB_RUN_ID:fault==='grouped'?'999':mode==='rescue'?'200':mode==='execute'?'102':mode==='registration'?'91':'100',GITHUB_RUN_ATTEMPT:'1',GITHUB_EVENT_NAME:mode==='rescue'?'workflow_dispatch':'issues',GITHUB_EVENT_PATH:join(c.dir,'event.json'),
    GITHUB_OUTPUT:join(c.dir,'output'),FIXTURE_AUDIT:join(c.dir,'audit'),FIXTURE_CASE:fault,NIBFIN_ACTION_ROOT:c.pkg,
    NIBFIN_BUNDLE_COMMIT:pin.commit,NIBFIN_HOST_COMMIT:'b'.repeat(40),NIBFIN_MODE:mode,NIBFIN_INPUT:JSON.stringify(data),NIBFIN_RESOLUTION:'ref-resolution',
    NIBFIN_HOST_REPOSITORY:pin.repository,NIBFIN_HOST_TOKEN:sentinel,NIBFIN_READ_TOKEN:sentinel,GH_TOKEN:sentinel,GITHUB_TOKEN:sentinel,...change};
  env.NIBFIN_HOST_OPTIONS=JSON.stringify({[mode]:{version:1,repository:env.GITHUB_REPOSITORY,repositoryId:env.GITHUB_REPOSITORY_ID,environment:['compute','execute'].includes(mode)?'nibfin-member':'nibfin-hosted'}});
  env.NIBFIN_HOST_CAPABILITY_SOURCE=fixtureSource.replaceAll('FIXTURE/',pathToFileURL(join(c.dir,'.test-fixtures/')).href).replace('CORE',pathToFileURL(join(c.dir,'nibfin-bundle/src/index.mjs')).href).replace('GROUPED',pathToFileURL(join(c.dir,'test/grouped-fixture.mjs')).href);
  if(deploymentSource)env.NIBFIN_HOST_CAPABILITY_SOURCE=deploymentSource;
  env.NIBFIN_READINESS_SOURCE=readinessSource;
  env.NIBFIN_SOURCE_APPROVALS=JSON.stringify({bundle:{repository:pin.repository,commit:pin.commit,files:pin.files},host:{repository:pin.repository,commit:env.NIBFIN_HOST_COMMIT,files:pin.files.filter(f=>f.path.startsWith('host/'))},deployment:{sourceSha256:hash(env.NIBFIN_HOST_CAPABILITY_SOURCE),optionsSha256:hash(env.NIBFIN_HOST_OPTIONS)},readiness:{sourceSha256:hash(env.NIBFIN_READINESS_SOURCE)}});
  Object.assign(env,change);
  writeFileSync(env.GITHUB_OUTPUT,'');rmSync(env.FIXTURE_AUDIT,{force:true});
  writeFileSync(env.GITHUB_EVENT_PATH,JSON.stringify({action:'labeled',repository:{id:42},issue:{node_id:'I_101',number:101,labels:[]},label:{name:fault==='ignored'?'not-nibfin':'shaped'}}));
  const step=c.meta.runs.steps.find(s=>s.id==='entry');assert.equal(step.run,'node "$NIBFIN_ACTION_ROOT/src/entry.mjs"');
  const r=timeoutMs?spawnSync(process.execPath,['--input-type=module','-e',`const {main}=await import(${JSON.stringify(pathToFileURL(join(c.pkg,'src/entry.mjs')).href)});process.exitCode=await main(process.env,'invoke',{timeoutMs:${timeoutMs}});`],{env,encoding:'utf8',timeout:10000})
    :spawnSync('bash',['-e','-o','pipefail','-c',step.run],{env,encoding:'utf8',timeout:30000});
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
    assert(!c.meta.runs.steps.some(s=>s.uses?.startsWith('actions/checkout')));
    const wired=c.meta.runs.steps.find(s=>s.id==='entry').env;
    for(const k of ['BUNDLE_COMMIT','HOST_COMMIT','MODE','INPUT','RESOLUTION'])assert.equal(wired['NIBFIN_'+k],'${{ inputs.'+k.toLowerCase()+' }}');
    for(const token of ['read_token','host_token'])assert.equal(wired['NIBFIN_'+token.toUpperCase()],"${{ inputs.mode != 'execute' && inputs.mode != 'compute' && inputs.mode != 'rescue' && inputs."+token+" || '' }}");
    const {generateKeyPairSync}=await import('node:crypto');writeFileSync(join(c.dir,'public.pem'),generateKeyPairSync('rsa',{modulusLength:2048}).publicKey.export({format:'pem',type:'spki'}));
    for(const [mode,expected] of [['lookup','resolved'],['resolve','selected'],['compute','completed'],['execute','completed'],['wake','run-observed'],['registration','delivered']]){
      const r=invoke(c,mode);assert.equal(r.status,0,mode+': '+r.output+r.stderr);assert(r.output.includes('status='+expected+'\n'),mode+': '+r.output);
      if(['compute','execute'].includes(mode)){assert.deepEqual(r.audit.tokens,[]);assert(r.output.includes('reference=ref-stage-result'));}
      if(mode==='resolve'){assert(r.output.includes('resolution=ref-resolution'));assert(r.output.includes('execution_mode=compute'));assert(r.output.includes('runs_on='));}
      if(mode==='lookup')assert(r.output.includes('issue=101'));if(mode==='registration')assert(r.output.includes('response=ref-registration-result'));
    }
  }finally{rmSync(c.dir,{recursive:true,force:true});}
});
test('Issue-stage metadata reaches real entry validation and pre-model progress without exposing raw child output',()=>{
 const c=consumer();try{
  const input={nibfin_request:'request-1',nibfin_correlation:'correlation-1',nibfin_issue:'101',nibfin_stage:'shape'};
  assert.equal(invoke(c,'lookup',{input}).status,0);
  const result=invoke(c,'compute',{input:{...input,issue:'101'}});
  assert.equal(result.status,0,result.output+result.stderr);
  assert.match(result.stdout,/"stage":"shape","status":"running"/);
  for(const changed of [{nibfin_issue:'102'},{nibfin_stage:'accept'},{nibfin_stage:'shell'}]){
   const denied=invoke(c,'compute',{input:{...input,issue:'101',...changed}});
   assert.notEqual(denied.status,0);assert.equal(denied.audit?.records??0,0);
  }
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
    writeFileSync(join(c.dir,'nibfin-bundle/src/workflow-entry.mjs'),'throw Error("changed")');
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
    for(const mutate of [m=>m.format=2,m=>m.package='wrong',m=>m.version='9.0.0',m=>m.core.commit='main',m=>m.core.status='published',
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

async function rescueCall(c,scenario,{inputChange={},change={}}={}){
  const {makeRescue}=await import('./rescue-fixture.mjs');const {id}=await makeRescue(scenario);
  const source=`import {writeFileSync} from 'node:fs';
import {makeRescue} from '${pathToFileURL(join(c.dir,'test/rescue-fixture.mjs')).href}';
const {f,id,observed}=await makeRescue(process.env.FIXTURE_CASE);
process.on('exit',()=>writeFileSync(process.env.FIXTURE_AUDIT,JSON.stringify({id,observed,state:f.snapshot(),target:f.target,
repairs:f.flags.repairs,diagnoses:f.flags.diagnoses,dispatches:[...f.ops.values()].map(o=>o.writes().length),retained:f.retained,
tokens:['NIBFIN_READ_TOKEN','NIBFIN_HOST_TOKEN','GH_TOKEN','GITHUB_TOKEN'].filter(k=>process.env[k])})));
export const capabilities={rescue:{authenticate:async({context})=>({...context,visibility:'public',ownership:'organization'}),rescue:async()=>f.options}};`;
  return invoke(c,'rescue',{fault:scenario,deploymentSource:source,
    input:{request_id:id,source_run_id:'100',source_attempt:'1',mode:['resolved','stage-recovered','stale-cycle','ambiguous-completion','early-completion'].includes(scenario)?'verify':'repair',nibfin_correlation:'correlation-1',nibfin_issue:'101',...inputChange},change});
}
test('packaged recovery uses production completion, provenance and bounded gray reporting; dispatch is not resolution',async()=>{
  const c=consumer();try{
    for(const [scenario,outcome,code] of [['resolved','RESOLVED',0],['unresolved','UNRESOLVED',1],['unsupported','UNRESOLVED',1],
      ['stage-recovered','STAGE_RECOVERED',1],['deferred','DEFERRED',1],['pending','PENDING_VERIFICATION',1],
      ['superseded','SUPERSEDED',1],['not-needed','NOT_NEEDED',1]]){
      const r=await rescueCall(c,scenario);assert.equal(r.status,code,scenario+': '+r.output+r.stderr);
      const report=Object.fromEntries(r.output.trim().split('\n').map(line=>{const at=line.indexOf('=');return [line.slice(0,at),line.slice(at+1)];}));
      assert.deepEqual(Object.fromEntries(['status','outcome','conclusion','reason'].map(k=>[k,report[k]])),{
        status:outcome==='RESOLVED'?'resolved':outcome==='UNRESOLVED'?'unresolved':'blocked',outcome,
        conclusion:outcome==='RESOLVED'?'success':outcome==='UNRESOLVED'?'failure':'neutral',
        reason:outcome==='RESOLVED'||outcome==='UNRESOLVED'?'verified-report':'reporting-unsupported'},scenario);
      assert.equal(report.issue,'101');assert.equal(report.stage,'deliver');assert.equal(report.verified,outcome==='RESOLVED'?'true':'false');
      assert.match(r.stdout,/Nibfin execution /);
      assert.deepEqual(r.audit.tokens,[]);assert.equal(r.audit.target.cycle,'cycle-1');
      assert.equal(r.audit.state.cases[r.audit.id].source.runId,'100');assert.equal(r.audit.state.cases[r.audit.id].source.attempt,'1');
      if(scenario==='pending'){assert.equal(r.audit.repairs,1);assert.equal(r.audit.diagnoses,1);
        assert.equal(report.root_cause,'Invocation failure');assert.equal(report.repair_status,'pending-verification');
        assert.deepEqual(r.audit.dispatches,[1]);assert.equal(r.audit.state.cases[r.audit.id].continuation.outcome,'confirmed-success');}
    }
    for(const scenario of ['stale-cycle','ambiguous-completion','cancelled','unknown-write','paused','hold','budget','forged-workflow-run',
      'provenance-actor','provenance-attempt','provenance-workflow','provenance-repository','provenance-version']){
      const r=await rescueCall(c,scenario);assert.notEqual(r.status,0,scenario);assert(!r.output.includes('conclusion=success'),scenario);
      assert(r.audit.repairs<=1,scenario);assert(r.audit.diagnoses<=1,scenario);
      if(scenario.startsWith('provenance-')||['cancelled','unknown-write','paused','hold','forged-workflow-run'].includes(scenario))assert.equal(r.audit.repairs,0,scenario);
    }
    for(const inputChange of [{command:'shell'},{cancel_run:'123'},{display_outcome:'RESOLVED'},{source_attempt:'2'},{source_run_id:'101'},{nibfin_issue:'102'},{request_id:'a'.repeat(64)}]){
      const r=await rescueCall(c,'pending',{inputChange});assert.notEqual(r.status,0);assert(!r.output.includes('conclusion=success'));
      assert.equal(r.audit?.repairs??0,0);
    }
    const wrongEvent=await rescueCall(c,'pending',{change:{GITHUB_EVENT_NAME:'workflow_run'}});assert.notEqual(wrongEvent.status,0);assert.equal(wrongEvent.audit.repairs,0);
  }finally{rmSync(c.dir,{recursive:true,force:true});}
});
test('packaged continuation preserves early completion, unchanged observations and changed exact-head identities',async()=>{
  const c=consumer();try{
    const early=await rescueCall(c,'early-completion');assert.equal(early.status,0,early.output);assert(early.output.includes('outcome=RESOLVED'));
    assert.equal(early.audit.observed.deferred,'DEFERRED');assert(early.audit.observed.now<early.audit.observed.deadline);assert.equal(early.audit.repairs,0);
    const unchanged=await rescueCall(c,'unchanged');assert.notEqual(unchanged.status,0);assert.equal(unchanged.audit.observed.next,'UNCHANGED');
    assert.equal(unchanged.audit.observed.before,unchanged.audit.observed.after);
    const changed=await rescueCall(c,'ci-change');assert.notEqual(changed.status,0);assert(changed.output.includes('outcome=PENDING_VERIFICATION'));
    assert.equal(changed.audit.observed.proof.kind,'ci-change');assert.equal(changed.audit.observed.unchangedAccepted,false);assert.equal(changed.audit.observed.foreignAccepted,false);
    assert.equal(changed.audit.repairs,1);assert.equal(changed.audit.diagnoses,1);assert.deepEqual(changed.audit.dispatches,[1]);
    const next=changed.audit.retained.find(r=>r.status==='UNACCEPTED');assert.equal(next.session,changed.audit.target.session);
    assert(next.requiredGates.includes('accept'));assert.notEqual(changed.audit.state.cases[changed.audit.id].continuation.observation.id,'100');
  }finally{rmSync(c.dir,{recursive:true,force:true});}
});
test('installed source/member readiness rejects missing protected observations and forged approvals before effects',()=>{
  const c=consumer();try{
    for(const mode of ['lookup','compute'])for(const capability of ['runtime','workflow','skills','source','recovery','jobAdmission']){
      for(const prefix of ['readiness-','incompatible-']){const r=invoke(c,mode,{fault:prefix+capability});assert.notEqual(r.status,0,mode+': '+capability);assert.equal(r.audit,null);}
    }
    for(const change of [{NIBFIN_SOURCE_APPROVALS:'{}'},{NIBFIN_READINESS_SOURCE:'export const observeCapability=()=>({status:"verified"})'},
      {NIBFIN_HOST_REPOSITORY:'attacker/project'},{NIBFIN_HOST_OPTIONS:'{}'},{NIBFIN_HOST_CAPABILITY_SOURCE:'throw Error("'+sentinel+'")'}]){
      const r=invoke(c,'lookup',{change});assert.notEqual(r.status,0);assert.equal(r.audit,null);
    }
    const path=join(c.dir,'nibfin-host/host/entry.mjs'),original=readFileSync(path);
    writeFileSync(path,'throw Error("'+sentinel+'")');const denied=invoke(c,'lookup');assert.notEqual(denied.status,0);assert.equal(denied.audit,null);writeFileSync(path,original);
    rmSync(join(c.dir,'nibfin-host'),{recursive:true});const missing=invoke(c,'lookup');assert.notEqual(missing.status,0);assert.equal(missing.audit,null);
  }finally{rmSync(c.dir,{recursive:true,force:true});}
});

test('packaged compute dispatches fresh independent Accept after grouped Owner history',()=>{
  const c=consumer();try{
    const r=invoke(c,'compute',{fault:'grouped',input:{nibfin_request:'accept-request',nibfin_correlation:'correlation-1',issue:'101'}});
    assert.equal(r.status,0,r.output+r.stderr);assert(r.output.includes('status=completed'));
    const a=JSON.parse(readFileSync(join(c.dir,'audit.grouped')));
    assert.equal(a.history.shape.execution.source.runId,a.history['shape-validator'].execution.source.runId);
    assert.notEqual(a.run.id,a.old);assert.equal(a.run.id,'999');assert.deepEqual(a.current,a.history);
    assert.equal(a.records.length,1);assert.equal(a.records[0].role,'accept');
    const reused=invoke(c,'compute',{fault:'reused-history',input:{nibfin_request:'accept-request',nibfin_correlation:'correlation-1',issue:'101'}});
    assert.notEqual(reused.status,0);assert(!reused.output.includes('status=completed'));
  }finally{rmSync(c.dir,{recursive:true,force:true});}
});

test('packaged timeout and uncertain exits cannot publish success or leak credentials',()=>{
  const c=consumer();try{
    for(const fault of ['malformed-output','credential-output','credential-output-encoded','nonzero-success','zero-failure']){
      const r=invoke(c,'lookup',{fault});assert.equal(r.status,1,fault+': '+r.output);assert.equal(r.output,'status=blocked\nreason=invalid-or-unavailable\n');
    }
    const loud=invoke(c,'lookup',{fault:'stdout'});assert.equal(loud.status,0);assert.equal(loud.output,'status=resolved\nissue=101\n');
    const timed=invoke(c,'lookup',{fault:'hang',timeoutMs:1500});assert.equal(timed.status,1);assert.equal(timed.output,'status=blocked\nreason=invalid-or-unavailable\n');
    const pid=Number(readFileSync(join(c.dir,'audit.pid'),'utf8'));assert.throws(()=>process.kill(pid,0),{code:'ESRCH'});
  }finally{rmSync(c.dir,{recursive:true,force:true});}
});

test('packaged public personal/Organization calls execute producer cryptographic source verification',()=>{
  const c=consumer();try{
    const change={GITHUB_REPOSITORY_ID:'9007199254740993',GITHUB_RUN_ID:'44',GITHUB_EVENT_NAME:'workflow_dispatch'};
    for(const kind of ['personal','organization','actor','attempt','repository','workflow','version','audience','signature']){
      const r=invoke(c,'lookup',{fault:'oidc-'+kind,change});
      const audit=JSON.parse(readFileSync(join(c.dir,'audit.oidc')));
      if(['personal','organization'].includes(kind)){assert.equal(r.status,0,r.output);assert.equal(audit.lookup,1);}
      else {assert.equal(r.status,1,kind);assert.equal(audit.lookup,0);assert.equal(audit.calls,0);}
    }
  }finally{rmSync(c.dir,{recursive:true,force:true});}
});

test('installed executable, manifest, API and lock tampering and symlink paths are rejected before host effects',()=>{
  const c=consumer();try{
    for(const name of ['src/runtime.mjs','src/index.mjs','src/distribution-map.json','src/distribution-contract.mjs','npm-shrinkwrap.json','package.json',
      'skills/deliver/SKILL.md','.github/workflows/nibfin-delivery.yml','host/runner-job-hook.sh']){
      const path=join(c.dir,'nibfin-bundle',name),bytes=readFileSync(path);
      for(const attack of ['change','missing','link']){
        rmSync(path);if(attack==='change')writeFileSync(path,Buffer.concat([bytes,Buffer.from('unsafe')]));
        if(attack==='link')symlinkSync(join(upstream,name),path);
        const r=invoke(c,'lookup');assert.equal(r.status,1,name+': '+attack);assert.equal(r.audit,null);
        rmSync(path,{force:true});writeFileSync(path,bytes);
      }
    }
    const host=join(c.dir,'nibfin-host');rmSync(host,{recursive:true});symlinkSync(join(upstream),host);
    const r=invoke(c,'lookup');assert.equal(r.status,1);assert.equal(r.audit,null);
  }finally{rmSync(c.dir,{recursive:true,force:true});}
});
test('installed readiness constructor is inert and check distinguishes source/member without admission or lifecycle effects',async()=>{
  const {createInstallation}=await import('../.test-core/src/installation.mjs');
  for(const profile of ['source','member']){
    const observed=[],probes=[];
    const configuration={version:1,expected:{packageVersion:pin.version,coreSha256:pin.components.core},profile,
      observeCapability:async r=>{observed.push(r.capability);return {...r,status:'verified'};}};
    if(profile==='member')configuration.runner={configuration:{version:1,platform:'linux',arch:'x64',path:'/usr/local/bin:/usr/bin:/bin',interpreter:'/usr/local/bin/node',work:'/fixture/work',scratch:'/fixture/scratch',cache:'/fixture/cache',account:{user:'member',uid:1000,githubUserId:'7'}},
      observe:async()=>({platform:'linux',arch:'x64',uid:1000,user:'member',tokenOverride:false,roots:{work:true,scratch:true,cache:true}}),
      probe:async r=>{probes.push(r);return {status:'verified',userId:'7'};}};
    const api=createInstallation(configuration);assert.deepEqual(observed,[]);assert.deepEqual(probes,[]);
    const result=await api.check();assert.equal(result.status,'ready');assert.equal(result.scope,profile==='source'?'source-contract':'member-runtime');
    assert.deepEqual(observed,['runtime','workflow','skills','source','recovery','jobAdmission']);
    assert(!JSON.stringify(probes).includes('runner-job-hook'));assert(!JSON.stringify(probes).includes('register'));
  }
});

test('Action CI prepares the exact integrated archive without dependency lifecycle scripts',()=>{
  const w=parse(readFileSync('.github/workflows/action-ci.yml','utf8')),steps=w.jobs.action.steps;
  assert.deepEqual(w.permissions,{contents:'read'});
  for(const s of steps){if(s.uses)assert.match(s.uses,/@[a-f0-9]{40}$/);if(s.uses?.startsWith('actions/checkout'))assert.equal(s.with['persist-credentials'],false);}
  const source=steps.find(s=>s.with?.repository===pin.repository);assert.equal(source.with.ref,pin.commit);assert.equal(source.with.path,'.test-producer');
  const prepare=steps.find(s=>s.name==='Prepare reviewed producer archive');assert(prepare.run.includes('--ignore-scripts'));assert(prepare.run.includes('node tooling/test-input.mjs --build .test-producer'));
  assert.equal(steps.at(-1).run,'node tooling/check.mjs');
});

test('waiting selection and ignored wake remain distinct non-delivery results',()=>{
  const c=consumer();try{
    const waiting=invoke(c,'resolve',{fault:'waiting'});assert.equal(waiting.status,0,waiting.output);
    assert.equal(waiting.output,'status=waiting\nselected=false\nreason=all-unavailable\n');assert.equal(waiting.audit.records,0);
    const ignored=invoke(c,'wake',{fault:'ignored'});assert.equal(ignored.status,0,ignored.output);assert.equal(ignored.output,'status=ignored\n');
  }finally{rmSync(c.dir,{recursive:true,force:true});}
});
