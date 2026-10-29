// Installed-package adaptation of the producer workflow entry. No lifecycle policy here.
import {readFileSync,appendFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {pin,hash,need,verifyCore,validate,memberMode} from './contract.mjs';
export async function invoke(env=process.env){
  const mode=validate(env),workspace=resolve(env.GITHUB_WORKSPACE),root=join(workspace,'nibfin-bundle');
  verifyCore(root); // All transitive package bytes checked BEFORE dynamic imports.
  const from=path=>import(pathToFileURL(join(root,path)).href);
  const {verifyApprovedSource,protectedHostFiles,loadProtectedDeployment}=await from('src/host-source.mjs');
  const approvals=JSON.parse(env.NIBFIN_SOURCE_APPROVALS);
  need(JSON.stringify(approvals.bundle)===JSON.stringify({repository:pin.repository,commit:pin.commit,files:pin.files}),'approval');
  await verifyApprovedSource({root,allowedRoot:root,repository:pin.repository,commit:pin.commit,approval:approvals.bundle,required:pin.files.map(f=>f.path)});
  const hostRoot=join(workspace,'nibfin-host');
  need(env.NIBFIN_HOST_REPOSITORY===pin.repository,'host');
  const host=await verifyApprovedSource({root:hostRoot,allowedRoot:hostRoot,repository:env.NIBFIN_HOST_REPOSITORY,
    commit:env.NIBFIN_HOST_COMMIT,approval:approvals.host,required:protectedHostFiles});
  // Only this distribution's maintained dependency-free host is executable.
  for(const path of protectedHostFiles)need(hash(host.get(path))===pin.files.find(f=>f.path===path)?.sha256,'host');
  const configuredHost=await import('data:text/javascript;base64,'+host.get('host/entry.mjs').toString('base64'));
  const readinessSource=env.NIBFIN_READINESS_SOURCE;
  need(typeof readinessSource==='string'&&Buffer.byteLength(readinessSource)<=131072
    &&Object.keys(approvals.readiness).join()==='sourceSha256'&&hash(readinessSource)===approvals.readiness.sourceSha256,'readiness');
  const observations=await import('data:text/javascript;base64,'+Buffer.from(readinessSource).toString('base64'));
  need(Object.keys(observations).every(k=>['observeCapability','runner'].includes(k)),'readiness');
  const {createInstallation}=await from('src/installation.mjs');
  const installation=createInstallation({version:pin.distribution.api.installation,
    expected:{packageVersion:pin.version,coreSha256:pin.components.core},profile:memberMode(mode)?'member':'source',
    observeCapability:observations.observeCapability,...(memberMode(mode)?{runner:observations.runner}:{})});
  const readiness=await installation.check();need(readiness.status==='ready'
    &&readiness.scope===(memberMode(mode)?'member-runtime':'source-contract'),'readiness');
  const core=await from('src/index.mjs');
  need(JSON.stringify(core.distributionAPI)===JSON.stringify(pin.distribution.api),'api');
  const identity=core.distributionIdentity();
  for(const name of ['core','workflow','skills'])need(identity.components[name].sha256===pin.components[name],'components');
  const context={repository:env.GITHUB_REPOSITORY?.toLowerCase(),repositoryId:env.GITHUB_REPOSITORY_ID,
    run:{id:env.GITHUB_RUN_ID,attempt:env.GITHUB_RUN_ATTEMPT},eventName:env.GITHUB_EVENT_NAME,
    event:JSON.parse(readFileSync(env.GITHUB_EVENT_PATH,'utf8'))};
  const {projectIssue}=await from('src/workflow.mjs');
  const input=mode==='wake'?{event:projectIssue(context.event)}:JSON.parse(env.NIBFIN_INPUT);
  if(memberMode(mode))input.resolution=env.NIBFIN_RESOLUTION;
  const deployment=await loadProtectedDeployment({source:env.NIBFIN_HOST_CAPABILITY_SOURCE,options:env.NIBFIN_HOST_OPTIONS,
    approval:approvals.deployment,validate:configuredHost.validateHostOptions,mode});
  const controller=new AbortController(),cancel=()=>controller.abort();process.once('SIGTERM',cancel);process.once('SIGINT',cancel);
  let result;
  try{result=await core.createWorkflowEntry(configuredHost.configure({core,mode,context,deployment})).invoke(mode,input,context,{signal:controller.signal});}
  finally{process.removeListener('SIGTERM',cancel);process.removeListener('SIGINT',cancel);}
  for(const [key,value] of Object.entries(result)){
    need(typeof value==='string'&&!/[\r\n]/.test(value),'output');appendFileSync(env.GITHUB_OUTPUT,`${key}=${value}\n`);
  }
  if(mode==='rescue')return result.outcome==='RESOLVED'&&result.conclusion==='success'&&result.status==='resolved'?0:1;
  return ['blocked','unknown','unconfirmed','denied','unavailable','unresolved','rejected','expired'].includes(result.status)?1:0;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{process.exitCode=await invoke();}catch{process.exitCode=1;}
}
