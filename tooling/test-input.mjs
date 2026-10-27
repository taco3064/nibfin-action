// Local test data preparation only. Never changes supplied evidence or runtime checks.
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {hash,pin,need,verifyCore} from '../src/contract.mjs';
const input=process.argv[2];need(input,'test-input');
const source=readFileSync(join(input,'released-source.tgz'));
need(hash(source)==='d633db765ba86d2572eba0af55598404c9ed87e782a3c48edde2e55fdf8e3fce','test-source');
const archive=readFileSync(join(input,'nibfin-core.tgz')),identity=pin.assets.find(a=>a.name==='nibfin-core.tgz');
need(hash(archive)===identity.sha256&&archive.length===identity.bytes,'test-archive');
// Both archive identities are approved data, not arbitrary input archives.
need(!existsSync('.test-core'),'test-destination-exists');mkdirSync('.test-core');
execFileSync('tar',['-xzf',join(input,'released-source.tgz'),'-C','.test-core']);
execFileSync('tar',['-xzf',join(input,'nibfin-core.tgz'),'--strip-components=1','-C','.test-core']);
// Supplemental fixture/lock text uses CRLF. Produce only exact manifest-bound bytes.
for(const f of [...pin.files,...pin.contractFixtures]){
  const path=join('.test-core',f.path),bytes=readFileSync(path);
  if(hash(bytes)!==f.sha256){const canonical=Buffer.from(bytes.toString('utf8').replaceAll('\r\n','\n'));
    need(hash(canonical)===f.sha256,'test-source-content');writeFileSync(path,canonical);}
}
verifyCore('.test-core');console.log('Prepared exact published Core bytes and hash-verified local fixtures; no live installation claim.');
