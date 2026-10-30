// Grouped Owner history is input data; installed Core still selects and verifies Accept.
import {acceptFixture} from '../.test-fixtures/accept-fixture.mjs';
import {chain,fixture} from '../.test-fixtures/evidence-fixture.mjs';
import {coreStages,contentIdentity} from '../.test-core/src/index.mjs';
function position(f,stage,a) {
  const p=f.pin,c=chain(true),candidate=a?.workspace?.candidate??c.receipts.deliver.inputs.candidate;
  p.candidate=candidate;p.base=candidate.base;p.head='c'.repeat(40);p.transition=null;
  const values={shape:fixture('shape'),'shape-validator':fixture('shape-validator'),...c.receipts};
  const refs={deliver:{publication:'publication'},accept:{hooks:'pre-accept-hooks'},'pre-commit-hooks':{accept:'accept'},
    pr:{accept:'accept',hooks:'pre-commit-hooks'},ci:{pr:'pr'},'shaper-review':{pr:'pr',ci:'ci'},
    merge:{review:'shaper-review'},final:{merge:'merge'},closure:{final:'final'},delivered:{closure:'closure'}};
  const order=coreStages.slice(0,14);p.receipts={};p.evidenceCurrent={};
  for(const s of order) {
    let e=values[s];e.binding={...p.binding};
    e.execution={...e.execution,id:s+'-id',request:s+'-request',result:s+'-result'};
    if(s==='deliver'&&a){e=structuredClone(a.pin.deliver);e.inputs.publication=contentIdentity(values.publication);
      a.pin.deliver=structuredClone(e);a.pin.deliverCurrent.expected=structuredClone(e);}
    if(s==='pre-accept-hooks'&&a)e=structuredClone(a.pin.hooks.stage);
    values[s]=e;
    if('body' in e.inputs)e.inputs.body=p.binding.shapeHash;
    if(e.inputs.candidate)e.inputs.candidate=candidate;
    if('base' in e.inputs)e.inputs.base=p.base;if('head' in e.inputs)e.inputs.head=p.head;
    if(s==='shape-validator')e.inputs.author=values.shape.execution.id;
    if(s==='publication'){e.inputs.author=values.shape.execution.id;e.inputs.validator=values['shape-validator'].execution.id;}
    if(s==='ci')e.inputs.policy=p.binding.policy;
    if(s==='accept')e.inputs.deliver=values.deliver.execution.id;
    if(s==='shaper-review')for(const [k,up] of Object.entries({author:'shape',validator:'shape-validator',deliver:'deliver',accept:'accept'}))e.inputs[k]=values[up].execution.id;
    for(const [k,up] of Object.entries(refs[s]??{}))e.inputs[k]=contentIdentity(values[up]);
    if(s===stage)break;
    p.receipts[s]=e;p.evidenceCurrent[s]={expected:structuredClone(e),consumed:[]};
  }
  p.stageInput=null;p.prior={state:'new'};
}

export async function prepareGrouped(f,reused=false){
  const a=await acceptFixture({empty:true,repository:'example-org/core',issueId:'I_101'});
  f.adopt(a.pin);position(f,'accept',a);Object.assign(f.owners,{accept:a.capabilities});
  const history=structuredClone(f.pin.receipts);
  const old=history.shape.execution.source.runId;
  f.pin.invocation={request:'accept-request',run:{id:reused?old:'999',attempt:'1'}};
  f.identity.run={...f.pin.invocation.run};f.input.nibfin_request='accept-request';f.input.nibfin_stage='accept';
  Object.assign(f.queuedRequest,await f.queued());
  return {a,history,old};
}
