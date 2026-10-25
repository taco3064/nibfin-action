import {execFileSync} from 'node:child_process';
import {existsSync,readFileSync} from 'node:fs';

const files=execFileSync('git',['ls-files','-z'],{encoding:'utf8'}).split('\0').filter(Boolean);
for(const path of files.filter(p=>/\.(?:mjs|cjs|js)$/.test(p)))
 execFileSync(process.execPath,['--check',path],{stdio:'inherit'});

const tests=files.filter(p=>/^test\/.+\.test\.(?:mjs|cjs|js)$/.test(p));
const pkg=existsSync('package.json')?JSON.parse(readFileSync('package.json','utf8')):null;
if(pkg){
 if(!existsSync('package-lock.json'))throw Error('A package requires a committed lockfile for reproducible CI');
 execFileSync('npm',['ci','--ignore-scripts','--no-audit','--no-fund'],{stdio:'inherit'});
}
if(pkg?.scripts?.test){
 execFileSync('npm',['test'],{stdio:'inherit'});
}else if(existsSync('tooling/check.py')){
 execFileSync('python3',['tooling/check.py'],{stdio:'inherit'});
}else if(tests.length){
 execFileSync(process.execPath,['--test',...tests],{stdio:'inherit'});
}else if(existsSync('action.yml')||existsSync('action.yaml')){
 throw Error('Action implementation requires maintained tests: npm test, tooling/check.py or test/*.test.mjs');
}else{
 console.log('Bootstrap only: workflow/source syntax checked; no Action implementation or runtime test exists yet.');
}
