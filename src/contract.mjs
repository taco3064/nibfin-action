import {readFileSync,lstatSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join,resolve,dirname} from 'node:path';
export const hash=b=>createHash('sha256').update(b).digest('hex');
export const pin=JSON.parse(readFileSync(new URL('../core-release.json',import.meta.url)));
export const outputs='request reason execution_mode status selected runs_on resolution reference issue response outcome conclusion stage ai_status blockage root_cause repair_status verified'.split(' ');
export const need=(ok,category)=>{if(!ok)throw Error('action:'+category);};
export const commit=v=>typeof v==='string' && /^[a-f0-9]{40}$/.test(v);
const opaque=v=>typeof v==='string' && /^[A-Za-z0-9_-]{1,80}$/.test(v);
const id=v=>typeof v==='string'&&/^[1-9][0-9]{0,19}$/.test(v);
const stage=v=>['resolve','shape','shape-validator','publication','deliver','pre-accept-hooks','accept','pre-commit-hooks','pr','ci','shaper-review','merge','final','closure','delivered','fanout','recovery','repair'].includes(v);
export const memberMode=mode=>['execute','compute'].includes(mode);
export const sensitiveMode=mode=>memberMode(mode)||mode==='rescue';
export function regular(root,path) {
  root=resolve(root);let ancestor=root;
  for(;;){need(!lstatSync(ancestor).isSymbolicLink(),'content');const parent=dirname(ancestor);if(parent===ancestor)break;ancestor=parent;}
  let current=root;need(lstatSync(current).isDirectory(),'content');
  for(const part of path.split('/')) {need(/^[A-Za-z0-9_.-]+$/.test(part)&&part!=='.'&&part!=='..','content');current=join(current,part);need(!lstatSync(current).isSymbolicLink(),'content');}
  need(lstatSync(current).isFile(),'content');return readFileSync(current);
}
export function verifyCore(root) {
  need(pin.format===2 && pin.package==='@nibfin/core' && pin.version==='0.1.0'
    && pin.commit==='c460b5b49a05d9e532bc9ab7c8211f5a32cbd8c6'&&pin.status==='reviewed-source','mapping');
  need(pin.distribution.api.installation===1&&pin.distribution.api.runtime===2&&pin.distribution.api.recovery===1,'mapping');
  for(const f of pin.files)need(hash(regular(root,f.path))===f.sha256,'content');
  const p=JSON.parse(regular(root,'package.json'));need(p.name===pin.package&&p.version===pin.version,'content');
  need(JSON.stringify([...new Set(['README.md','package.json',...p.files])].sort())===JSON.stringify(pin.files.map(f=>f.path)),'inventory');
  return root;
}
export function validate(env) {
  need(env.NIBFIN_BUNDLE_COMMIT===pin.commit && commit(env.NIBFIN_HOST_COMMIT),'pins');
  const mode=env.NIBFIN_MODE;need(['lookup','resolve','execute','compute','wake','registration','rescue'].includes(mode),'mode');
  need(typeof env.NIBFIN_INPUT==='string' && Buffer.byteLength(env.NIBFIN_INPUT)<=16384,'input');
  const input=JSON.parse(env.NIBFIN_INPUT);need(input && typeof input==='object' && !Array.isArray(input),'input');
  let keys=mode==='rescue'?'request_id source_run_id source_attempt mode nibfin_correlation nibfin_issue'
    :mode==='registration'?'nibfin_registration public_key level':mode==='lookup'?'nibfin_request nibfin_correlation'
    :mode==='wake'?'event':'nibfin_request nibfin_correlation issue';
  if(mode==='rescue'){
    if(Object.hasOwn(input,'nibfin_stage')){need(stage(input.nibfin_stage),'input');keys+=' nibfin_stage';}
  }else if(!['registration','wake'].includes(mode)&&(Object.hasOwn(input,'nibfin_stage')||Object.hasOwn(input,'nibfin_issue'))){
    need(stage(input.nibfin_stage)&&id(input.nibfin_issue)&&(mode==='lookup'||input.issue===input.nibfin_issue),'input');
    keys+=' nibfin_issue nibfin_stage';
  }
  need(Object.keys(input).sort().join(' ')===keys.split(' ').sort().join(' '),'input');
  if(mode==='rescue')need(/^[a-f0-9]{64}$/.test(input.request_id)&&['repair','diagnose','verify'].includes(input.mode)
    &&id(input.source_run_id)&&id(input.source_attempt)&&id(input.nibfin_issue)&&opaque(input.nibfin_correlation),'input');
  else if(mode==='registration')need(opaque(input.nibfin_registration)&&['repository','organization'].includes(input.level)
    && typeof input.public_key==='string'&&input.public_key.length<=8192,'input');
  else if(mode!=='wake') {
    need(opaque(input.nibfin_request)&&opaque(input.nibfin_correlation),'input');
    if(mode!=='lookup')need(id(input.issue),'input');
    if(memberMode(mode))need(opaque(env.NIBFIN_RESOLUTION),'input');
  } else need(input.event&&typeof input.event==='object'&&!Array.isArray(input.event),'input');
  return mode;
}
const reasons=['host-configuration-unavailable','invalid-or-unavailable','result-reconciliation-required',
  'verified-report','reporting-unsupported','reporting-failed','missing-scope','no-assignees','all-unavailable','existing-work','reconciliation-required'];
const statuses=['blocked','unknown','unconfirmed','denied','unavailable','unresolved','rejected','expired','waiting',
  'ignored','available','resolved','selected','completed','retained','delivered','run-observed','dispatched','superseded','deferred','pending-verification','pending_verification','stage_recovered','not_needed'];
export function project(text,mode) {
  need(Buffer.byteLength(text)<=131072 && !text.includes('\r'),'output');const result={};
  for(const line of text.split('\n').filter(Boolean)) {
    const i=line.indexOf('='),key=line.slice(0,i),value=line.slice(i+1);
    need(i>0&&outputs.includes(key)&&!Object.hasOwn(result,key)&&value.length<=32768&&!/[\x00-\x1f\x7f]/.test(value),'output');
    if(['request','resolution','reference','response'].includes(key))need(opaque(value),'output');
    if(key==='reason')need(reasons.includes(value),'output');
    if(key==='selected')need(['true','false'].includes(value),'output');
    if(key==='execution_mode')need(['execute','compute'].includes(value),'output');
    if(key==='issue')need(id(value),'output');
    if(key==='stage')need(stage(value),'output');
    if(['ai_status','blockage','root_cause','repair_status'].includes(key))need(value.length<=1200&&!value.includes('::')&&!value.includes('##['),'output');
    if(key==='verified')need(['true','false'].includes(value),'output');
    if(key==='status')need(statuses.includes(value),'output');
    if(key==='outcome')need(['RESOLVED','UNRESOLVED','STAGE_RECOVERED','DEFERRED','PENDING_VERIFICATION','SUPERSEDED','NOT_NEEDED'].includes(value),'output');
    if(key==='conclusion')need(['success','failure','neutral'].includes(value),'output');
    if(key==='runs_on') {const route=JSON.parse(value);need(route&&Array.isArray(route.labels)&&route.labels.length>0&&route.labels.length<=100
      && route.labels.every(l=>typeof l==='string'&&l.length>0&&l.length<=256&&!/[\x00-\x1f\x7f]/.test(l))&&new Set(route.labels).size===route.labels.length
      && Object.keys(route).every(k=>['labels','group'].includes(k))
      &&(route.group===undefined||typeof route.group==='string'&&route.group.length>0&&route.group.length<=256&&!/[\x00-\x1f\x7f]/.test(route.group)),'output');}
    result[key]=value;
  }
  need(Object.hasOwn(result,'status'),'output');
  if(mode==='rescue'&&result.outcome){
    const conclusion=result.outcome==='RESOLVED'?'success':result.outcome==='UNRESOLVED'?'failure':'neutral';
    need(result.conclusion===conclusion,'output');
    need(result.status===(result.outcome==='RESOLVED'?'resolved':result.outcome==='UNRESOLVED'?'unresolved':'blocked')
      &&result.reason===(result.outcome==='RESOLVED'||result.outcome==='UNRESOLVED'?'verified-report':'reporting-unsupported'),'output');
  } else need(!Object.hasOwn(result,'outcome')&&!Object.hasOwn(result,'conclusion')&&(mode!=='rescue'||result.status==='blocked'),'output');
  return Object.entries(result).map(([k,v])=>`${k}=${v}\n`).join('');
}
