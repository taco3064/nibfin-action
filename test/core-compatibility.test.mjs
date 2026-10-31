import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { pin, verifyCore } from '../src/contract.mjs';

const root = fileURLToPath(new URL('../.test-core', import.meta.url));
verifyCore(root);
const core = await import('../.test-core/src/index.mjs');

test('Action snapshot matches Core stage and component identities', () => {
  const identity = core.distributionIdentity();
  for (const name of ['core', 'workflow', 'skills']) {
    assert.equal(identity.components[name].sha256, pin.components[name]);
  }
  assert.equal(identity.packageVersion, pin.version);
  assert.deepEqual(pin.stages, core.coreStages);
  assert.equal(core.distributionAPI.deliveryRevision, 1);
  assert.equal(core.distributionAPI.protectedDiagnosis, 1);
});

test('wrapper Core preserves main integration and independent gates', () => {
  const plan = core.deliveryBaseRevisionPolicy({ stage: 'pr', hasWorkspace: true });
  const receipts = Object.fromEntries(
    plan.retainedStages.map((stage) => [stage, { result: null }]),
  );
  assert.equal(core.nextDeliveryStage(receipts), 'deliver');
  assert.equal(plan.status, 'UNACCEPTED');
  assert.equal(plan.repairBudget, 'unchanged');
  assert.ok(plan.repeatedStages.includes('accept'));
  assert.ok(plan.repeatedStages.includes('ci'));
  assert.ok(plan.repeatedStages.includes('shaper-review'));
});

test('verified wrapper Core distinguishes a missing AI record from a repair', () => {
  const result = core.protectedStageDiagnosisPlan({
    stage: 'merge',
    attemptPhase: 'unresolved',
    marker: { status: 'diagnosed', attempts: 1 },
  });
  assert.equal(result.outcome, 'correct-marker');
  assert.equal(result.status, 'diagnosis-unavailable');
  const diagnosed = core.protectedStageDiagnosisResult({
    diagnosis: { record: 'retained-diagnosis' },
  });
  assert.equal(diagnosed.outcome, 'UNRESOLVED');
  assert.equal(diagnosed.status, 'diagnosed');
});
