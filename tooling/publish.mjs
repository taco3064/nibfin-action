import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {hash,need,commit} from '../src/contract.mjs';
import {verifyPackage} from './package.mjs';
export const repository='taco3064/nibfin-action',repositoryId='1428543343';
export async function publish({manifest:m,assets,run,request,record}) {
  need(m?.format===1&&m.package==='@nibfin/action'&&/^\d+\.\d+\.\d+$/.test(m.version)
    &&m.source?.kind==='merged'&&commit(m.source.commit),'publication-source');
  const sha=m.source.commit,tag='v'+m.version,base='/repos/'+repository;
  need(run?.repository===repository&&run.repositoryId===repositoryId&&run.ref==='refs/heads/main'
    &&['push','workflow_dispatch'].includes(run.event)&&run.sha===sha&&/^[1-9]\d*$/.test(run.id)&&/^[1-9]\d*$/.test(run.attempt),'publication-run');
  need(assets instanceof Map&&assets.size===2&&Buffer.isBuffer(assets.get('nibfin-action.tgz'))
    &&Buffer.isBuffer(assets.get('action-release-manifest.json')),'publication-assets');
  need(hash(assets.get('nibfin-action.tgz'))===m.archive.sha256&&assets.get('nibfin-action.tgz').length===m.archive.bytes
    &&JSON.stringify(JSON.parse(assets.get('action-release-manifest.json')))===JSON.stringify(m),'publication-assets');
  const expected=[...assets].map(([name,b])=>({name,size:b.length,digest:'sha256:'+hash(b)}));
  const body=JSON.stringify({format:1,source:sha,manifest:hash(assets.get('action-release-manifest.json'))});
  const receipt={status:'checking',source:sha,tag,run:{...run,url:`https://github.com/${repository}/actions/runs/${run.id}/attempts/${run.attempt}`},assets:expected};
  record(receipt);
  const get=async(path,optional=false)=>{let r;
    try{r=await request({method:'GET',path});}catch{record({...receipt,status:'unavailable',operation:{method:'GET',path}});throw Error('publication:readback-unavailable');}
    if(optional&&r.status===404)return null;
    if(r.status!==200)record({...receipt,status:'blocked',httpStatus:r.status,operation:{method:'GET',path}});
    need(r.status===200,'publication-readback');return r.data;};
  const write=async(method,path,data,bytes)=>{
    record({...receipt,status:'write-intent',operation:{method,path}});let r;
    try {r=await request({method,path,data,bytes});}catch {record({...receipt,status:'unknown',operation:{method,path}});throw Error('publication:reconcile-before-retry');}
    if(![200,201].includes(r.status)){record({...receipt,status:r.status>=500?'unknown':'failed',httpStatus:r.status,operation:{method,path}});throw Error('publication:reconcile-before-retry');}
    return r.data;
  };
  const repo=await get(base),branch=await get(base+'/branches/main');
  need(String(repo.id)===repositoryId&&repo.full_name===repository&&repo.visibility==='public'&&branch.protected===true,'publication-repository');
  const prs=await get(base+'/commits/'+sha+'/pulls?per_page=100');
  need(Array.isArray(prs)&&prs.some(p=>p.merged_at&&p.merge_commit_sha===sha&&p.base?.ref==='main'&&String(p.base.repo?.id)===repositoryId),'publication-merge');
  need((await get(base+'/immutable-releases')).enabled===true,'publication-immutability');
  const target=async()=>{let o=(await get(base+'/git/ref/tags/'+tag,true))?.object;
    for(let n=0;o&&n<4;n++){need(commit(o.sha),'publication-tag');if(o.type==='commit')return o.sha;need(o.type==='tag','publication-tag');o=(await get(base+'/git/tags/'+o.sha)).object;}need(!o,'publication-tag');return null;};
  const priorTag=await target();need(!priorTag||priorTag===sha,'publication-conflict');
  const matches=[];
  for(let page=1;;page++){need(page<=100,'publication-discovery');const list=await get(base+'/releases?per_page=100&page='+page);
    need(Array.isArray(list)&&list.length<=100,'publication-discovery');matches.push(...list.filter(r=>r.tag_name===tag));if(list.length<100)break;}
  need(matches.length<=1,'publication-conflict');let release=matches[0];
  const identity=r=>need(r&&Number.isSafeInteger(r.id)&&r.id>0&&r.tag_name===tag&&r.target_commitish===sha&&r.body===body&&r.prerelease===false,'publication-conflict');
  if(!release){need(!priorTag,'publication-conflict');release=await write('POST',base+'/releases',{tag_name:tag,target_commitish:sha,name:tag,body,draft:true,prerelease:false});identity(release);need(release.draft===true,'publication-draft');}
  const id=release.id;identity(release);release=await get(base+'/releases/'+id);identity(release);need(release.id===id,'publication-id');
  const assetList=()=>get(base+'/releases/'+id+'/assets?per_page=100');
  const check=(list,complete)=>{need(Array.isArray(list)&&list.length<=expected.length,'publication-assets');const seen=new Set();
    for(const a of list){const e=expected.find(e=>e.name===a.name);need(e&&!seen.has(a.name)&&a.size===e.size&&a.digest===e.digest&&a.state==='uploaded','publication-assets');seen.add(a.name);}
    if(complete)need(seen.size===expected.length,'publication-assets');};
  let existing=await assetList();check(existing,!release.draft);
  if(release.draft){
    for(const e of expected)if(!existing.some(a=>a.name===e.name)){
      await write('POST',`https://uploads.github.com${base}/releases/${id}/assets?name=${e.name}`,null,assets.get(e.name));
      existing=await assetList();check(existing,false);need(existing.some(a=>a.name===e.name),'publication-upload');
    }
    check(existing,true);need((await get(base+'/immutable-releases')).enabled===true,'publication-immutability');
    await write('PATCH',base+'/releases/'+id,{draft:false});
  }
  release=await get(base+'/releases/tags/'+tag);identity(release);
  need(release.id===id&&release.draft===false&&release.immutable===true&&!!release.published_at&&await target()===sha,'publication-readback');
  existing=await assetList();check(existing,true);
  const result={...receipt,status:'published',release:{id,url:release.html_url,immutable:true},assets:existing.map(a=>({id:a.id,name:a.name,size:a.size,digest:a.digest,url:a.browser_download_url}))};record(result);return result;
}
export function githubRequest(token){
  need(typeof token==='string'&&token.length>0,'publication-token');
  return async({method,path,data,bytes})=>{
    const url=path.startsWith('/')?'https://api.github.com'+path:path;
    need(url==='https://api.github.com/repos/'+repository||url.startsWith('https://api.github.com/repos/'+repository+'/')
      ||url.startsWith('https://uploads.github.com/repos/'+repository+'/releases/'),'publication-origin');
    const r=await fetch(url,{method,redirect:'error',signal:AbortSignal.timeout(30000),headers:{Authorization:'Bearer '+token,
      Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','Content-Type':bytes?'application/octet-stream':'application/json'},body:bytes??(data?JSON.stringify(data):undefined)});
    return {status:r.status,data:await r.json()};
  };
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try {const m=verifyPackage(),e=process.env;
    await publish({manifest:m,assets:new Map(['nibfin-action.tgz','action-release-manifest.json'].map(n=>[n,readFileSync('out/'+n)])),
      run:{repository:e.GITHUB_REPOSITORY,repositoryId:e.GITHUB_REPOSITORY_ID,ref:e.GITHUB_REF,event:e.GITHUB_EVENT_NAME,sha:e.GITHUB_SHA,id:e.GITHUB_RUN_ID,attempt:e.GITHUB_RUN_ATTEMPT},
      request:githubRequest(e.NIBFIN_RELEASE_TOKEN),record:r=>writeFileSync('out/publication-result.json',JSON.stringify(r,null,2)+'\n')});
  }catch {console.error('nibfin-action: publication blocked; inspect retained receipt and reconcile before retry');process.exitCode=1;}
}
