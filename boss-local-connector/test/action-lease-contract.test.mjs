import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReceipt, validateClaimEnvelope } from '../src/lib/action-lease-contract.mjs';

test('an empty claim never exposes an executor',()=>{assert.deepEqual(validateClaimEnvelope({available:false}),{available:false,mode:'NO_APPROVED_TASK'});});
test('a valid contract remains explicitly non executable',()=>{const result=validateClaimEnvelope({available:true,mode:'CONTRACT_ONLY_NO_EXECUTOR',leaseId:'1',taskId:'2',leaseToken:'secret',targetDigest:'a'.repeat(64),leaseUntil:'2026-08-30T11:00:30Z'});assert.equal(result.executorAvailable,false);assert.equal('content' in result,false);});
test('receipt requires before and after evidence plus an explicit outcome',()=>{
  assert.throws(()=>buildReceipt('secret','SUCCEEDED','bad','b'.repeat(64),'c'.repeat(64),'成功'));
  assert.throws(()=>buildReceipt('secret','SUCCEEDED','a'.repeat(64),'a'.repeat(64),'c'.repeat(64),'没有变化'));
  assert.equal(buildReceipt('secret','UNKNOWN','a'.repeat(64),'a'.repeat(64),'b'.repeat(64),'页面结果无法确认').outcome,'UNKNOWN');
});
