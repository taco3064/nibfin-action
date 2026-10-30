import{parseDocument,isMap}from'yaml';import{readdirSync,readFileSync}from'node:fs';import{spawnSync}from'node:child_process';import{pathToFileURL}from'node:url';
// actionlint 1.7.12 predates GitHub's documented concurrency.queue field.
// Validate that field first, then lint a stdin projection of all other syntax.
// The repository source is never modified and no diagnostics are ignored.
export function workflowLintProjection(source){
 const document=parseDocument(source);if(document.errors.length)throw Error('workflow-lint:yaml');
 const check=node=>{if(!isMap(node)||!node.has('queue'))return;const value=node.get('queue');
  if(!['single','max'].includes(value)||value==='max'&&![undefined,false].includes(node.get('cancel-in-progress')))throw Error('workflow-lint:concurrency-queue');
  node.delete('queue');};
 check(document.get('concurrency',true));const jobs=document.get('jobs',true);
 if(isMap(jobs))for(const job of jobs.items)if(isMap(job.value))check(job.value.get('concurrency',true));
 return document.toString();
}
export function lintWorkflows({directory='.github/workflows',executable='actionlint',run=spawnSync}={}){
 for(const name of readdirSync(directory).filter(name=>/\.ya?ml$/.test(name)).sort()){
  const path=directory+'/'+name,source=readFileSync(path,'utf8'),input=workflowLintProjection(source);
  const result=run(executable,['-color','-shellcheck=','-pyflakes=','-stdin-filename',path,'-'],{input,encoding:'utf8',timeout:30000,stdio:['pipe','pipe','pipe']});
  if(result.stdout)process.stdout.write(result.stdout);if(result.stderr)process.stderr.write(result.stderr);
  if(result.error||result.signal||result.status!==0)throw Error('workflow-lint:rejected');
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)lintWorkflows();
