import {readFileSync,lstatSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
export const hash=b=>createHash('sha256').update(b).digest('hex');
export const pin=JSON.parse(readFileSync(new URL('../core-release.json',import.meta.url)));
export const outputs='request reason execution_mode status selected runs_on resolution reference issue response'.split(' ');
export const need=(ok,category)=>{if(!ok)throw Error('action:'+category);};
export const commit=v=>typeof v==='string' && /^[a-f0-9]{40}$/.test(v);
const opaque=v=>typeof v==='string' && /^[A-Za-z0-9_-]{1,80}$/.test(v);
export function regular(root,path) {
  let current=root;need(lstatSync(current).isDirectory()&&!lstatSync(current).isSymbolicLink(),'content');
  for(const part of path.split('/')) {need(part!=='.'&&part!=='..'&&part!=='','content');current=join(current,part);need(!lstatSync(current).isSymbolicLink(),'content');}
  need(lstatSync(current).isFile(),'content');return readFileSync(current);
}
export function verifyCore(root) {
  need(pin.format===1 && pin.package==='@nibfin/core' && pin.version==='0.1.0'
    && pin.commit==='ae64437d072d16ebad1ed119f6f7ab9c6b459e44','mapping');
  for(const f of pin.files)need(hash(regular(root,f.path))===f.sha256,'content');
  const p=JSON.parse(regular(root,'package.json'));need(p.name===pin.package&&p.version===pin.version,'content');
}
export function validate(env) {
  need(env.NIBFIN_BUNDLE_COMMIT===pin.commit && commit(env.NIBFIN_HOST_COMMIT),'pins');
  const mode=env.NIBFIN_MODE;need(['lookup','resolve','execute','compute','wake','registration'].includes(mode),'mode');
  need(typeof env.NIBFIN_INPUT==='string' && Buffer.byteLength(env.NIBFIN_INPUT)<=16384,'input');
  const input=JSON.parse(env.NIBFIN_INPUT);need(input && typeof input==='object' && !Array.isArray(input),'input');
  const keys=mode==='registration'?'nibfin_registration public_key level':mode==='lookup'?'nibfin_request nibfin_correlation'
    :mode==='wake'?'event':'nibfin_request nibfin_correlation issue';
  need(Object.keys(input).sort().join(' ')===keys.split(' ').sort().join(' '),'input');
  if(mode==='registration')need(opaque(input.nibfin_registration)&&['repository','organization'].includes(input.level)
    && typeof input.public_key==='string'&&input.public_key.length<=8192,'input');
  else if(mode!=='wake') {
    need(opaque(input.nibfin_request)&&opaque(input.nibfin_correlation),'input');
    if(mode!=='lookup')need(typeof input.issue==='string' && /^[1-9][0-9]*$/.test(input.issue),'input');
    if(['execute','compute'].includes(mode))need(opaque(env.NIBFIN_RESOLUTION),'input');
  }
  return mode;
}
export function project(text) {
  need(Buffer.byteLength(text)<=131072 && !text.includes('\r'),'output');const result={};
  for(const line of text.split('\n').filter(Boolean)) {
    const i=line.indexOf('='),key=line.slice(0,i),value=line.slice(i+1);
    need(i>0&&outputs.includes(key)&&!Object.hasOwn(result,key)&&value.length<=32768&&!/[\x00-\x1f\x7f]/.test(value),'output');
    if(['request','resolution','reference','response'].includes(key))need(opaque(value),'output');
    if(key==='reason')need(['host-configuration-unavailable','invalid-or-unavailable','result-reconciliation-required'].includes(value),'output');
    if(key==='selected')need(['true','false'].includes(value),'output');
    if(key==='execution_mode')need(['execute','compute'].includes(value),'output');
    if(key==='issue')need(/^[1-9][0-9]*$/.test(value),'output');
    if(key==='status')need(/^[a-z][a-z-]{0,79}$/.test(value),'output');
    if(key==='runs_on') {const route=JSON.parse(value);need(route&&Array.isArray(route.labels)&&route.labels.length<=100
      && Object.keys(route).every(k=>['labels','group'].includes(k)),'output');}
    result[key]=value;
  }
  need(Object.hasOwn(result,'status'),'output');return Object.entries(result).map(([k,v])=>`${k}=${v}\n`).join('');
}
