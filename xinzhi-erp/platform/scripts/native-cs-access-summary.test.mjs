import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const sql=readFileSync(new URL('../preparation/sql/native-cs-access-summary-readonly.sql',import.meta.url),'utf8');
const receipt=JSON.parse(readFileSync(new URL('../preparation/evidence/2026-09-07-native-cs-access-summary.json',import.meta.url),'utf8'));
test('access query is bounded, readonly and never touches credential or session columns',()=>{
  assert.match(sql,/REPEATABLE READ READ ONLY/);assert.match(sql,/statement_timeout='5s'/);
  assert.match(sql,/lock_timeout='2s'/);assert.match(sql,/ROLLBACK;/);
  const executable=sql.replace(/--[^\n]*/g,'');
  assert.doesNotMatch(executable,/\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE|COPY|CALL|DO)\b/i);
  assert.doesNotMatch(executable,/\b(password_hash|access_token|encrypted_client_secret|encrypted_automation_token|sessions|messages|conversations)\b/i);
  assert.doesNotMatch(executable,/\b(?:SELECT\s+\*|row_to_json|to_jsonb\(users\)|pg_authid|pg_read_file|dblink)\b/i);
});
test('receipt states collection limits, not production readiness',()=>{
  assert.equal(receipt.format,'native-cs-access-summary-v1');assert.equal(receipt.readOnly,'on');
  assert.equal(receipt.isolation,'repeatable read');assert.equal(receipt.credentialsRead,false);
  assert.equal(receipt.sessionRecordsRead,false);assert.equal(receipt.shopifyApiCalled,false);
  assert.equal(receipt.productionReady,false);
});
test('aggregated population totals reconcile',()=>{
  assert.equal(receipt.userGroups.reduce((sum,g)=>sum+g.accounts,0),receipt.users.total);
  for(const module of ['knowledge','monitor','orders','records','shops','tickets']) {
    assert.equal(receipt.storedModuleScopes.filter(g=>g.module===module).reduce((sum,g)=>sum+g.accounts,0),receipt.users.total);
  }
});
test('stored permission counts stay within the observed account population',()=>{
  for(const p of receipt.storedPermissionCounts) {
    assert.ok(Number.isInteger(p.stored_accounts) && p.stored_accounts>=0 && p.stored_accounts<=receipt.users.total);
    assert.ok(Number.isInteger(p.stored_active_accounts) && p.stored_active_accounts>=0 && p.stored_active_accounts<=p.stored_accounts);
  }
});
test('saved scope coverage is explicit, unique and bounded by installations',()=>{
  const names=new Set();
  for(const s of receipt.savedScopeCounts) {
    assert.ok(!names.has(s.scope));names.add(s.scope);
    assert.ok(Number.isInteger(s.saved_installations) && s.saved_installations>=0 && s.saved_installations<=receipt.installations.total);
    assert.ok(s.saved_active_shop_installations>=0 && s.saved_active_shop_installations<=s.saved_installations);
    assert.ok(s.saved_active_shop_installations<=receipt.installations.activeShop);
  }
  for(const scope of ['write_orders','read_all_orders','write_inventory','write_order_edits','read_locations'])assert.ok(names.has(scope));
});
test('recorded production coverage cannot be used as the synthetic inventory grant',()=>{
  const count=name=>receipt.savedScopeCounts.find(s=>s.scope===name).saved_installations;
  assert.equal(count('write_inventory'),0);assert.equal(count('write_order_edits'),0);assert.equal(count('read_all_orders'),0);
  assert.equal(count('write_orders'),receipt.installations.total);
});
test('aggregate evidence contains no account/shop identifiers or arbitrary metadata',()=>{
  const forbidden=new Set(['email','display_name','id','user_id','shop_id','shop_domain','client_id','issuer','subject','metadata','password_hash','access_token']);
  const walk=value=>{if(value && typeof value==='object')for(const [key,child] of Object.entries(value)){assert.ok(!forbidden.has(key),key);walk(child);}};
  walk(receipt);
});
