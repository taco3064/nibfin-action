import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {gunzipSync} from 'node:zlib';
import {hash,pin,need,commit,regular} from '../src/contract.mjs';
export const runtimeFiles=['README.md','action.yml','core-release.json','src/contract.mjs','src/entry.mjs','src/invoke.mjs'];
export const sourceFiles=[...runtimeFiles,'package.json','package-lock.json','.gitignore','tooling/package.mjs','tooling/publish.mjs','tooling/check.mjs','tooling/test-input.mjs','tooling/core-source.json',
  'test/action.test.mjs','test/rescue-fixture.mjs','test/grouped-fixture.mjs','test/publication.test.mjs','.github/workflows/action-release.yml','.github/workflows/ci.yml'].sort();
export function inspectArchive(bytes,expected) {
  need(bytes.length<1048576,'archive');const tar=gunzipSync(bytes,{maxOutputLength:2097152}),found=new Map();let offset=0;
  for(;offset+512<=tar.length;){
    const h=tar.subarray(offset,offset+512);if(h.every(b=>b===0))break;
    const field=(a,b)=>h.subarray(a,b).toString().replace(/\0.*$/s,'');
    let sum=0;for(let i=0;i<512;i++)sum+=i>=148&&i<156?32:h[i];
    const octal=s=>{need(/^[0-7]+\0? *$/.test(s),'archive');return parseInt(s,8);};
    need(octal(field(148,156).trim())===sum,'archive');
    const name=field(0,100),size=octal(field(124,136).trim());
    need(h[156]===48||h[156]===0,'archive');need(!field(345,500)&&!field(157,257),'archive');
    need(expected.includes(name)&&!found.has(name)&&offset+512+size<=tar.length,'archive');
    found.set(name,tar.subarray(offset+512,offset+512+size));offset+=512+Math.ceil(size/512)*512;
  }
  need(found.size===expected.length&&tar.subarray(offset).every(b=>b===0)&&tar.length-offset>=1024,'archive');return found;
}
export function source(root,base,merged=null) {
  need(commit(base)&&(merged===null||commit(merged)),'source');
  const files=sourceFiles.map(path=>({path,sha256:hash(regular(root,path))}));
  return {kind:merged?'merged':'candidate',base,commit:merged,files,sha256:hash(JSON.stringify(files))};
}
export function verifyPackage(root=process.cwd()) {
  const archive=regular(root,'out/nibfin-action.tgz'),m=JSON.parse(regular(root,'out/action-release-manifest.json'));
  need(m.format===1&&m.package==='@nibfin/action'&&m.version===JSON.parse(regular(root,'package.json')).version,'mapping');
  need(JSON.stringify(m.core)===JSON.stringify(pin),'mapping');
  need(JSON.stringify(m.source)===JSON.stringify(source(root,m.source.base,m.source.commit)),'source');
  need(m.archive?.name==='nibfin-action.tgz'&&m.archive.sha256===hash(archive)&&m.archive.bytes===archive.length,'archive');
  const files=inspectArchive(archive,runtimeFiles);
  for(const path of runtimeFiles)need(files.get(path).equals(regular(root,path)),'archive');
  return m;
}
export function prepare(root=process.cwd(),base,merged=null) {
  const binding=source(root,base,merged),pkg=JSON.parse(regular(root,'package.json'));
  need(pkg.name==='@nibfin/action'&&/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(pkg.version),'version');
  mkdirSync(join(root,'out'),{recursive:true});
  execFileSync('tar',['--format=ustar','--sort=name','--mtime=@0','--owner=0','--group=0','--numeric-owner','-czf',join(root,'out/nibfin-action.tgz'),...runtimeFiles],{cwd:root});
  const bytes=regular(root,'out/nibfin-action.tgz');
  const m={format:1,package:pkg.name,version:pkg.version,source:binding,core:pin,archive:{name:'nibfin-action.tgz',bytes:bytes.length,sha256:hash(bytes)}};
  writeFileSync(join(root,'out/action-release-manifest.json'),JSON.stringify(m,null,2)+'\n');return verifyPackage(root);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const m=process.argv[2]==='--verify'?verifyPackage():prepare(process.cwd(),process.env.NIBFIN_RELEASE_BASE??JSON.parse(readFileSync('/io/context.json')).repositoryObservation.base,process.env.NIBFIN_RELEASE_COMMIT??null);
  console.log(JSON.stringify({version:m.version,source:m.source.kind,archive:m.archive}));
}
