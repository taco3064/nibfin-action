// Inert transports and state data for the installed production owners. Not shipped.
import {rescueFixture} from '../.test-fixtures/rescue-fixture.mjs';
import {completionFixture} from '../.test-fixtures/completion-fixture.mjs';
import {fixture as evidenceFixture} from '../.test-fixtures/evidence-fixture.mjs';
import {ciRescueContinuation,contentIdentity} from '../.test-core/src/index.mjs';
export async function makeRescue(scenario='pending'){
  const f=rescueFixture(),observed={};
  let completion;
  if(['resolved','stale-cycle','ambiguous-completion','early-completion'].includes(scenario)){
    const c=await completionFixture();await c.fresh().close();const {receipt}=await c.fresh().complete();
    const expected=Object.fromEntries(Object.entries(receipt.payload.receipts).map(([s,r])=>[s,{expected:r,consumed:[]}]));
    const b=receipt.payload.receipts.publication.binding;
    Object.assign(f.target,{scopeHash:b.scopeHash,shapeHash:b.shapeHash});f.blocked.target=structuredClone(f.target);f.setState({...f.state(),target:structuredClone(f.target)});
    completion={receipt,expected,cycle:f.target.cycle,caseId:null,continuation:null};
  }
  const id=await f.register();
  if(completion&&scenario!=='early-completion')f.flags.final=completion;
  if(scenario==='stale-cycle')f.flags.final.cycle='stale';
  if(scenario==='ambiguous-completion')f.flags.final.receipt.identity='f'.repeat(64);
  if(scenario==='unresolved')f.flags.allowed=false;
  if(scenario==='unsupported')f.flags.adapter={capabilities:{rescueReadOnly:false}};
  if(scenario==='deferred')f.flags.active=true;
  if(scenario==='hold')f.state().hold=true;
  if(scenario==='paused')f.state().paused=true;
  if(scenario==='unknown-write')f.state().unknownWrite=true;
  if(scenario==='cancelled')f.sourceRun.conclusion='cancelled';
  if(scenario==='superseded')f.state().target.scopeHash='f'.repeat(64);
  if(scenario==='not-needed')await f.records.update(s=>{s.cases[id].outcome='NOT_NEEDED';return s;});
  if(scenario==='stage-recovered'){
    await f.controller.run(id);
    f.flags.mutateRead=(data,r)=>r.endpoint.includes('/runs/70/')?{...f.sourceRun,id:'70',conclusion:'success'}:data;
    const receipt=evidenceFixture('deliver');Object.assign(receipt.binding,{repositoryId:'42',issueId:'I_101',scopeHash:f.target.scopeHash,shapeHash:f.target.shapeHash,authority:f.target.authority});
    receipt.execution.source={...receipt.execution.source,runId:'70',attempt:'1'};
    f.flags.stageReceipt={caseId:id,receipt,expected:{expected:structuredClone(receipt),consumed:[]}};
  }
  if(scenario==='early-completion'){
    f.flags.active=true;const before=await f.controller.run(id);f.flags.active=false;
    f.flags.final=completion;
    observed.deferred=before.outcome;observed.deadline=f.snapshot().cases[id].nextCheckAt;observed.now=f.now();
  }
  if(scenario==='unchanged'){
    observed.first=(await f.controller.wake(id)).outcome;
    const count=f.ops.size;f.tick(300001);observed.next=(await f.controller.wake(id)).outcome;
    observed.before=count;observed.after=f.ops.size;
  }
  if(scenario==='ci-change'){
    const checks=[{id:'77',head:'b'.repeat(40),status:'pending'}];
    const input={target:f.target,blocked:{...f.blocked,resumeOn:'ci-change',head:'b'.repeat(40)},previous:contentIdentity([]),current:checks,
      pr:{state:'open',merged:false,draft:false,head:'b'.repeat(40),candidate:f.target.candidate},enabled:['ci-change']};
    const proof=ciRescueContinuation(input);observed.proof=proof;
    try{ciRescueContinuation({...input,current:[]});observed.unchangedAccepted=true;}catch{observed.unchangedAccepted=false;}
    try{ciRescueContinuation({...input,pr:{...input.pr,head:'c'.repeat(40)}});observed.foreignAccepted=true;}catch{observed.foreignAccepted=false;}
    f.flags.remedy={kind:'ci-change',proof,apply:async()=>proof};
  }
  if(scenario==='budget'){
    f.flags.operation=o=>{o.state.failRead=true;o.state.lost=true;};
    await f.controller.run(id);for(let n=0;n<4;n++)await f.controller.run(id);
  }
  if(scenario.startsWith('provenance-')){
    const kind=scenario.slice(11);f.flags.mutateRead=(d,r)=>{
      if(kind==='actor'&&d.actor)d.actor.id='8';
      if(kind==='attempt'&&d.run_attempt)d.run_attempt=2;
      if(kind==='workflow'&&d.path)d.path='.github/workflows/evil.yml';
      if(kind==='repository'&&d.repository)d.repository.private=true;
      if(kind==='version'&&d.sha)d.sha='f'.repeat(40);
      return d;
    };
  }
  if(scenario==='forged-workflow-run'){
    const event=f.event();event.workflow_run.head_sha='d'.repeat(40);
    await f.receiver.receive(...f.signed(event));observed.received=await f.receiver.process();
    f.flags.allowed=false;
  }
  f.options.reporting={capability:{runId:'200',scope:'reporting-run'},report:async()=>({confirmed:scenario!=='report-unconfirmed'})};
  return {f,id,observed};
}
