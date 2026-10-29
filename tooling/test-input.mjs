// Test preparation only: approved archive bytes, never a producer checkout at runtime.
import {readFileSync,writeFileSync,mkdirSync,existsSync,chmodSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {hash,pin,need,verifyCore,regular} from '../src/contract.mjs';
const build=process.argv[2]==='--build';
const source=resolve(build?process.argv[3]??'.test-producer':process.argv[3]??'.test-producer');
const input=resolve(build?join(source,'out'):process.argv[2]??process.env.NIBFIN_CORE_ARTIFACTS??'.test-producer/out');
if(build){
  need(source!==resolve('/work')&&!source.startsWith('/upstream/'),'test-source-readonly');
  const recipe=JSON.parse(readFileSync(new URL('./core-source.json',import.meta.url)));
  need(recipe.format===1&&recipe.commit===pin.commit&&hash(JSON.stringify(recipe.source.inputs))===recipe.source.contentSha256,'test-recipe');
  verifyCore(source);
  // Validate build tooling too, BEFORE executing it. Only a writable test copy is used.
  for(const f of recipe.source.inputs)need(hash(regular(source,f.path))===f.sha256,'test-build-source');
  need(JSON.stringify(recipe.modes.map(f=>f.path))===JSON.stringify(pin.files.map(f=>f.path)),'test-modes');
  for(const f of recipe.modes){need([384,420,493].includes(f.mode),'test-mode');regular(source,f.path);chmodSync(join(source,f.path),f.mode);}
  // npm pack preserves source permission bits. Reproduce the accepted tar metadata,
  // using the exact tracked modes of this reviewed producer correction.
  const mask=process.umask(0o022);
  try{execFileSync(process.execPath,[join(source,'tooling/release.mjs')],{cwd:source,stdio:'inherit',
    env:Object.fromEntries(Object.entries({...process.env,NIBFIN_RELEASE_BASE:recipe.source.base}).filter(([k])=>k!=='NIBFIN_RELEASE_COMMIT'))});}
  finally{process.umask(mask);}
  for(const f of recipe.source.inputs)need(hash(regular(source,f.path))===f.sha256,'test-build-source');
}
for(const a of pin.assets){const b=readFileSync(join(input,a.name));need(hash(b)===a.sha256&&b.length===a.bytes,'test-artifact');}
const manifest=JSON.parse(readFileSync(join(input,'release-manifest.json'))),compatibility=JSON.parse(readFileSync(join(input,'compatibility.json')));
for(const name of ['core','workflow','skills'])need(manifest.components[name].sha256===pin.components[name],'test-components');
need(JSON.stringify(compatibility.distribution)===JSON.stringify(pin.distribution),'test-distribution');
need(!existsSync('.test-core'),'test-destination-exists');mkdirSync('.test-core');
execFileSync('tar',['-xzf',join(input,'nibfin-core.tgz'),'--strip-components=1','-C','.test-core']);
verifyCore('.test-core');
// Explicit nested locked preparation; the archive ships the producer shrinkwrap.
execFileSync('npm',['ci','--prefix','.test-core','--ignore-scripts','--no-bin-links','--no-audit','--no-fund'],{stdio:'inherit'});
verifyCore('.test-core');
mkdirSync('.test-fixtures');
for(const f of pin.testFixtures){
  const bytes=readFileSync(join(source,f.path));need(hash(bytes)===f.sha256,'test-fixture');
  writeFileSync(join('.test-fixtures',f.path.split('/').pop()),bytes.toString().replaceAll('../src/','../.test-core/src/'));
}
console.log('Installed exact reviewed #233 distribution with PR246 correction with lifecycle scripts disabled; source-contract input only.');
