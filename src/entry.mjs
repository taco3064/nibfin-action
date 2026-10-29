import {appendFileSync,readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {validate,verifyCore,project,need,sensitiveMode} from './contract.mjs';
export async function main(env=process.env,phase='invoke',{timeoutMs=180*60*1000}={}) {
  let temp;
  try {
    need(Number.isSafeInteger(timeoutMs)&&timeoutMs>0&&timeoutMs<=180*60*1000,'timeout');
    const mode=validate(env);
    if(phase==='validate')return 0;
    const core=join(env.GITHUB_WORKSPACE,'nibfin-bundle');verifyCore(core);
    if(phase==='content')return 0;
    temp=mkdtempSync(join(tmpdir(),'nibfin-action-'));
    const output=join(temp,'outputs'),childEnv={...env,GITHUB_OUTPUT:output,NIBFIN_HOST_ROOT:join(env.GITHUB_WORKSPACE,'nibfin-host')};
    if(sensitiveMode(mode))for(const k of ['NIBFIN_HOST_TOKEN','NIBFIN_READ_TOKEN','GH_TOKEN','GITHUB_TOKEN'])delete childEnv[k];
    // Capture only the entry's file protocol. Raw child stdout/stderr never enter public logs.
    const child=spawn(process.execPath,[new URL('./invoke.mjs',import.meta.url).pathname],{env:childEnv,stdio:'ignore',detached:true});
    let timer,hardTimer,interrupted=false;
    const kill=signal=>{try{process.kill(-child.pid,signal);}catch{}};
    const cancel=()=>{interrupted=true;kill('SIGTERM');hardTimer??=setTimeout(()=>kill('SIGKILL'),1000);};
    timer=setTimeout(cancel,timeoutMs);process.once('SIGTERM',cancel);process.once('SIGINT',cancel);
    let code;
    try {code=await new Promise((res,rej)=>{child.once('error',rej);child.once('exit',(c,s)=>res(s?1:c));});}
    finally {process.removeListener('SIGTERM',cancel);process.removeListener('SIGINT',cancel);clearTimeout(timer);clearTimeout(hardTimer);kill('SIGKILL');}
    need(!interrupted&&Number.isInteger(code)&&code>=0,'interrupted');
    const raw=readFileSync(output,'utf8');
    const {containsCredentials}=await import(pathToFileURL(join(core,'src/credential-output.mjs')).href);
    need(!containsCredentials(raw,['NIBFIN_HOST_TOKEN','NIBFIN_READ_TOKEN','GH_TOKEN','GITHUB_TOKEN'].map(k=>env[k]).filter(Boolean)),'credentials');
    const safe=project(raw,mode);
    const failed=/^status=(blocked|unknown|unconfirmed|denied|unavailable|unresolved|rejected|expired)$/m.test(safe);
    need(code===0?!failed:failed,'uncertain');
    appendFileSync(env.GITHUB_OUTPUT,safe);return code;
  } catch {
    if(phase!=='validate'&&phase!=='content'&&env.GITHUB_OUTPUT)try{appendFileSync(env.GITHUB_OUTPUT,'status=blocked\nreason=invalid-or-unavailable\n');}catch{}
    process.stderr.write('nibfin-action: invalid-or-unavailable\n');return 1;
  } finally {if(temp)try{rmSync(temp,{recursive:true,force:true});}catch{}}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)process.exitCode=await main(process.env,process.argv[2]);
