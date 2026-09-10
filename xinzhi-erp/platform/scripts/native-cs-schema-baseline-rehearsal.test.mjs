import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {compareCatalogs} from './native-cs-schema-baseline-rehearsal.mjs';
const baseline=()=>({format:'native-cs-catalog-v1',readOnly:'on',isolation:'repeatable read',serverVersion:'16.14',
  schemas:['public'],extensions:[{name:'plpgsql',version:'1.0'}],objects:[{kind:'column',name:'users.id',properties:{type:'text',notNull:true}}]});
test('equal catalog never grants deployment or production readiness',()=>{
  const r=compareCatalogs(baseline(),baseline());assert.equal(r.status,'CATALOG_MATCH_NOT_RELEASE_APPROVAL');
  assert.equal(r.productionReady,false);assert.equal(r.deploymentAllowed,false);
});
test('missing additional and changed objects are distinct',()=>{
  const a=baseline(),b=baseline();a.objects.push({kind:'index',name:'users.old',properties:{valid:true}});
  b.objects[0].properties.type='uuid';b.objects.push({kind:'relation',name:'historical_links',properties:{kind:'r'}});
  const r=compareCatalogs(a,b);assert.deepEqual(r.missing,['index:users.old']);
  assert.deepEqual(r.additional,['relation:historical_links']);assert.deepEqual(r.changed,['column:users.id']);
  assert.equal(r.status,'STRUCTURE_REVIEW_REQUIRED');
});
test('object and property ordering does not create drift',()=>{
  const a=baseline(),b=baseline();b.objects[0].properties={notNull:true,type:'text'};
  const r=compareCatalogs(a,b);assert.equal(r.referenceDigest,r.observedDigest);assert.deepEqual(r.changed,[]);
});
test('non readonly and duplicate catalogs fail closed',()=>{
  const a=baseline();a.readOnly='off';assert.throws(()=>compareCatalogs(a,baseline()),/CATALOG_INVALID/);
  const b=baseline();b.objects.push(b.objects[0]);assert.throws(()=>compareCatalogs(baseline(),b),/CATALOG_DUPLICATE/);
  const c=baseline();delete c.serverVersion;assert.throws(()=>compareCatalogs(baseline(),c),/CATALOG_INVALID/);
});
test('schema extension and major version differences require review',()=>{
  for(const [key,value] of [['schemas',['public','unexpected']],['extensions',[]],['serverVersion','17.1']]) {
    const b=baseline();b[key]=value;assert.equal(compareCatalogs(baseline(),b).status,'STRUCTURE_REVIEW_REQUIRED');
  }
});
test('checked catalog SQL stays read-only and catalog-only',()=>{
  const sql=readFileSync(new URL('../preparation/sql/native-cs-schema-readonly.sql',import.meta.url),'utf8');
  assert.match(sql,/REPEATABLE READ READ ONLY/);assert.match(sql,/statement_timeout = '5s'/);
  assert.match(sql,/lock_timeout = '2s'/);assert.match(sql,/ROLLBACK;/);
  assert.doesNotMatch(sql,/\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE|COPY|CALL|DO)\b/i);
  assert.doesNotMatch(sql,/\b(?:FROM|JOIN)\s+public\./i);
  assert.doesNotMatch(sql,/pg_authid|pg_roles|pg_stat_activity|pg_read_file|dblink/i);
});
