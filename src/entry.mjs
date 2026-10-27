import {appendFileSync,readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {validate,verifyCore,project,need} from './contract.mjs';
export async function main(env=process.env,phase='invoke') {
  let temp;
  try {
    const mode=validate(env);
    if(phase==='validate')return 0;
    const core=join(env.GITHUB_WORKSPACE,'nibfin-core');verifyCore(core);
    if(phase==='content')return 0;
    temp=mkdtempSync(join(tmpdir(),'nibfin-action-'));
    const output=join(temp,'outputs'),childEnv={...env,GITHUB_OUTPUT:output,NIBFIN_HOST_ROOT:join(env.GITHUB_WORKSPACE,'nibfin-host')};
    if(['execute','compute'].includes(mode))for(const k of ['NIBFIN_HOST_TOKEN','NIBFIN_READ_TOKEN','GH_TOKEN','GITHUB_TOKEN'])delete childEnv[k];
    // Capture only the entry's file protocol. Raw child stdout/stderr never enter public logs.
    const child=spawn(process.execPath,[join(core,'src/workflow-entry.mjs')],{env:childEnv,stdio:'ignore'});
    const cancel=()=>child.kill('SIGTERM');process.once('SIGTERM',cancel);process.once('SIGINT',cancel);
    let code;
    try {code=await new Promise((res,rej)=>{child.once('error',rej);child.once('exit',(c,s)=>res(s?1:c));});}
    finally {process.removeListener('SIGTERM',cancel);process.removeListener('SIGINT',cancel);}
    const safe=project(readFileSync(output,'utf8'));appendFileSync(env.GITHUB_OUTPUT,safe);
    need(Number.isInteger(code),'entry');return code;
  } catch {
    if(phase!=='validate'&&phase!=='content'&&env.GITHUB_OUTPUT)try{appendFileSync(env.GITHUB_OUTPUT,'status=blocked\nreason=invalid-or-unavailable\n');}catch{}
    process.stderr.write('nibfin-action: invalid-or-unavailable\n');return 1;
  } finally {if(temp)try{rmSync(temp,{recursive:true,force:true});}catch{}}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)process.exitCode=await main(process.env,process.argv[2]);
