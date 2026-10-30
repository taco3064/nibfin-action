import test from'node:test';import assert from'node:assert/strict';import{parse}from'yaml';import{workflowLintProjection}from'../tooling/lint-workflows.mjs';
test('validate documented root and job queue policies before projecting only unsupported syntax',()=>{
 const source='name: Test\non: workflow_dispatch\nconcurrency: {group: a, queue: max, cancel-in-progress: false}\njobs:\n  test:\n    runs-on: ubuntu-latest\n    concurrency: {group: b, queue: single, cancel-in-progress: true}\n    steps:\n      - run: echo hello\n';
 const result=parse(workflowLintProjection(source));assert.equal(result.concurrency.queue,undefined);assert.equal(result.jobs.test.concurrency.queue,undefined);assert.equal(result.concurrency.group,'a');assert.equal(result.jobs.test.steps[0].run,'echo hello');assert.ok(source.includes('queue: max'));
 assert.throws(()=>workflowLintProjection(source.replace('queue: max','queue: unlimited')),/concurrency-queue/);
 assert.throws(()=>workflowLintProjection(source.replace('queue: max, cancel-in-progress: false','queue: max, cancel-in-progress: true')),/concurrency-queue/);
 assert.throws(()=>workflowLintProjection('on: push\non: pull_request\n'),/yaml/);
 const unsupported=parse(workflowLintProjection(source+'unexpected_key: value\n'));assert.equal(unsupported.unexpected_key,'value','Other invalid syntax must remain for actionlint to reject');
});
