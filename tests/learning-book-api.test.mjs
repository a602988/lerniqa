import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

const require=createRequire(import.meta.url);
async function load(file,deps={}) {
    const source=await readFile(new URL(file,import.meta.url),'utf8');
    const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    const module={exports:{}};
    vm.runInNewContext(js,{module,exports:module.exports,console,URL,URLSearchParams,Date,Map,Set,Buffer,require:name=>name.startsWith('node:')?require(name):deps[name]??{}});
    return module.exports;
}
const contract=await load('../app/lib/learning-book-contract.ts');
const actor={userId:'10000000-0000-4000-8000-000000000001',learnerId:'20000000-0000-4000-8000-000000000001',role:'parent'};
const ids={plan:'30000000-0000-4000-8000-000000000001',revision:'40000000-0000-4000-8000-000000000001',question:'50000000-0000-4000-8000-000000000001',questionRevision:'60000000-0000-4000-8000-000000000001',subscription:'70000000-0000-4000-8000-000000000001',invite:'80000000-0000-4000-8000-000000000001'};
const input={name:'國文學習本',checkMode:'instant',questions:[{questionId:ids.question,revisionId:ids.questionRevision}],filterSnapshot:{subject:'國文'},idempotencyKey:'test-request-0001'};
const bookRow={id:ids.plan,plan_id:ids.plan,source:'mine',subscription_id:null,creator_id:actor.userId,creator_name:'家長',sharer_id:null,name:input.name,status:'active',lock_version:1,revision_id:ids.revision,latest_revision_id:ids.revision,revision_number:1,active_schedule_count:0,check_mode:'instant',questions:input.questions,settings_snapshot:input.filterSnapshot,created_at:'2026-10-18T00:00:00Z',updated_at:'2026-10-18T00:00:00Z'};
async function setup(handler=()=>undefined) {
    const calls=[];
    const client={query:async(sql,values=[])=>{
        calls.push({sql,values});
        const custom=await handler(sql,values,calls);
        if(custom) return {rowCount:custom.rows?.length??0,...custom};
        if(sql.includes('FROM learner_access access')) return {rows:[{id:'access'}],rowCount:1};
        if(sql.includes('FROM practice_plan_mutation_receipts')) return {rows:[],rowCount:0};
        if(sql.includes('SELECT * FROM practice_plans WHERE')) return {rows:[{id:ids.plan,status:'active',current_published_revision_id:ids.revision,created_by_user_id:actor.userId,learner_id:actor.learnerId,lock_version:1,draft_revision_id:ids.revision}],rowCount:1};
        if(sql.includes('SELECT COALESCE(max(revision_number)')) return {rows:[{value:1}],rowCount:1};
        if(sql.includes('FROM jsonb_to_recordset')) return {rows:[{id:ids.question,revision_id:ids.questionRevision,position:0}],rowCount:1};
        if(sql.includes('SELECT * FROM enriched WHERE id=')) return {rows:[bookRow],rowCount:1};
        if(sql.includes('count(*)::integer total')) return {rows:[{total:0}],rowCount:1};
        return {rows:[],rowCount:0};
    }};
    const store=await load('../app/lib/learning-book-store.ts',{'./learning-book-contract':contract,'./local-postgres':{withLocalPostgresTransaction:fn=>fn(client)}});
    return {store,calls};
}

test('content protocol rejects overlapping whole-question and part targets',()=>{
    assert.throws(()=>contract.parseContent({...input,questions:[input.questions[0],{questionId:ids.question,revisionId:ids.questionRevision,partId:ids.invite}]}),{code:'DUPLICATE_QUESTIONS'});
    assert.throws(()=>contract.parseContent({...input,questions:[input.questions[0],input.questions[0]]}),{code:'DUPLICATE_QUESTIONS'});
    assert.throws(()=>contract.parseScheduleDate('2026-10-18T09:00'),{code:'INVALID_DATE'});
    assert.equal(contract.parseScheduleDate('2026-10-18T09:00+08:00'),'2026-10-18T01:00:00.000Z');
});
test('content permits distinct parts of one revision but rejects mixed explicit or implicit revisions with 409',async()=>{
    const parts=[{questionId:ids.question,revisionId:ids.questionRevision,partId:ids.invite},{questionId:ids.question,revisionId:ids.questionRevision,partId:ids.subscription}];
    assert.equal(contract.parseContent({...input,questions:parts}).questions.length,2);
    assert.equal(contract.parseContent({...input,questions:parts.map(({revisionId,...part})=>part)}).questions.length,2);
    const mixed={...input,questions:[parts[0],{...parts[1],revisionId:ids.revision}]};
    assert.throws(()=>contract.parseContent(mixed),{code:'MIXED_QUESTION_REVISIONS',status:409});
    assert.throws(()=>contract.parseContent({...input,questions:[parts[0],{questionId:ids.question,partId:ids.subscription}]}),{code:'MIXED_QUESTION_REVISIONS',status:409});
    const {store,calls}=await setup();
    await assert.rejects(store.createLearningBook(actor,mixed),{code:'MIXED_QUESTION_REVISIONS',status:409});
    await assert.rejects(store.updateLearningBook(actor,ids.plan,{...mixed,action:'edit',lockVersion:1}),{code:'MIXED_QUESTION_REVISIONS',status:409});
    assert.equal(calls.some(call=>/^(INSERT|UPDATE|DELETE)/.test(call.sql)),false);
});
test('list parsing bounds pagination and whitelists sort and UUID filters',()=>{
    assert.throws(()=>contract.parseListQuery(new URLSearchParams('sort=updated;drop table users')),{code:'INVALID_FILTER'});
    assert.throws(()=>contract.parseListQuery(new URLSearchParams('limit=10000')),{code:'INVALID_PAGE'});
    assert.throws(()=>contract.parseListQuery(new URLSearchParams('creatorIds=parent')),{code:'INVALID_ID'});
    const value=contract.parseListQuery(new URLSearchParams(`arrangement=unscheduled&creatorIds=${actor.userId}&search=國文`));
    assert.equal(value.arrangement,'unscheduled');assert.equal(value.creatorIds[0],actor.userId);
});
test('unaccepted or revoked learner access is rejected before any write',async()=>{
    const {store,calls}=await setup(sql=>sql.includes('FROM learner_access access')?{rows:[]}:undefined);
    await assert.rejects(store.createLearningBook(actor,input),{code:'LEARNING_BOOK_FORBIDDEN'});
    assert.equal(calls.some(call=>call.sql.includes('INSERT')),false);
    assert.match(calls[0].sql,/accepted_at IS NOT NULL/);assert.match(calls[0].sql,/revoked_at IS NULL/);
});
test('learning-book access follows the selected learner grant, not the active application role',async()=>{
    const {store,calls}=await setup(sql=>sql.includes('FROM learner_access access')
        ? (/access\.access_role\s*=\s*\$3/.test(sql)?{rows:[]}:{rows:[{id:'access'}]})
        : undefined);
    const filters=contract.parseListQuery(new URLSearchParams());
    await assert.doesNotReject(()=>store.listLearningBooks(actor,filters));
    const access=calls.find(call=>call.sql.includes('FROM learner_access access'));
    assert.doesNotMatch(access.sql,/access\.access_role\s*=\s*\$3/);
});
test('create resolves authorized published question revisions and builds items before publish',async()=>{
    const {store,calls}=await setup();
    const result=await store.createLearningBook(actor,input);
    assert.equal(result.name,input.name);
    const resolve=calls.find(call=>call.sql.includes('FROM jsonb_to_recordset'));
    assert.match(resolve.sql,/question_bank_learners/);assert.equal(resolve.values[1],actor.learnerId);
    const inserted=calls.findIndex(call=>call.sql.includes('INSERT INTO practice_plan_revision_items'));
    const published=calls.findIndex(call=>call.sql.includes("SET status='published'"));
    assert.ok(inserted>=0&&published>inserted);
    assert.equal(calls[inserted].values[2],ids.question);assert.equal(calls[inserted].values[3],ids.questionRevision);
    assert.ok(calls.some(call=>call.sql.includes('INSERT INTO practice_plan_audit_events')));
});
test('can_create_plans is enforced before plan insertion',async()=>{
    const {store,calls}=await setup((sql,values)=>sql.includes('FROM learner_access access')&&values[2]===true?{rows:[]}:undefined);
    await assert.rejects(store.createLearningBook(actor,input),{code:'LEARNING_BOOK_FORBIDDEN'});
    assert.equal(calls.some(call=>call.sql.includes('INSERT INTO practice_plans')),false);
});
test('edits retain exact owned revision targets before draft replacement without trusting caller provenance',async()=>{
    const {store,calls}=await setup();
    await store.updateLearningBook(actor,ids.plan,{...input,action:'edit',lockVersion:1,existingRevisionId:ids.invite});
    const resolvedIndex=calls.findIndex(call=>call.sql.includes('FROM jsonb_to_recordset'));
    const resolve=calls[resolvedIndex];
    assert.equal(resolve.values[2],ids.revision);assert.equal(resolve.values[3],actor.userId);
    assert.match(resolve.sql,/existing_plan\.created_by_user_id=\$4/);
    assert.match(resolve.sql,/existing_item\.question_revision_id=r\.id/);
    assert.match(resolve.sql,/existing_item\.question_part_id IS NOT DISTINCT FROM target\.part_id/);
    const deletedIndex=calls.findIndex(call=>call.sql.includes('DELETE FROM practice_plan_revision_items'));
    assert.ok(deletedIndex>resolvedIndex);
    assert.equal(calls.filter(call=>call.sql.includes('FROM jsonb_to_recordset')).length,1);
});
test('idempotency identity includes learner and conflicting request bodies are rejected',async()=>{
    const {store,calls}=await setup(sql=>sql.includes('FROM practice_plan_mutation_receipts')?{rows:[{request_hash:'different',response:{}}]}:undefined);
    await assert.rejects(store.createLearningBook(actor,input),{code:'IDEMPOTENCY_CONFLICT'});
    const receipt=calls.find(call=>call.sql.includes('FROM practice_plan_mutation_receipts'));
    assert.equal(receipt.values[1],`${actor.learnerId}:create`);
    assert.equal(calls.some(call=>call.sql.includes('INSERT INTO practice_plans')),false);
});
test('publish syncs subscriptions but never rewrites schedules or historical items',async()=>{
    const {store,calls}=await setup(sql=>sql.includes('UPDATE practice_plan_subscriptions SET current_revision_id')?{rows:[{id:ids.subscription,recipient_learner_id:actor.learnerId}]}:undefined);
    await store.updateLearningBook(actor,ids.plan,{action:'publish',lockVersion:1,idempotencyKey:'publish-test-0001'});
    assert.ok(calls.some(call=>call.sql.includes('UPDATE practice_plan_subscriptions SET current_revision_id')));
    assert.ok(calls.some(call=>call.sql.includes('INSERT INTO practice_plan_notifications')));
    assert.equal(calls.some(call=>/UPDATE practice_schedules|UPDATE practice_schedule_items|UPDATE practice_session_items/.test(call.sql)),false);
});
test('stale optimistic version fails before a draft or publication mutation',async()=>{
    const {store,calls}=await setup();
    await assert.rejects(store.updateLearningBook(actor,ids.plan,{action:'archive',lockVersion:99,idempotencyKey:'archive-test-0001'}),{code:'BOOK_CHANGED'});
    assert.equal(calls.some(call=>call.sql.includes('UPDATE practice_plans')),false);
});
test('share invite persists only a hash and receipt never contains the raw token',async()=>{
    const {store,calls}=await setup(sql=>sql.includes('INSERT INTO practice_plan_share_invites')?{rows:[{created_at:'2026-10-18T00:00:00Z',expires_at:'2026-10-25T00:00:00Z'}]}:undefined);
    const result=await store.createLearningBookInvite(actor,ids.plan,{idempotencyKey:'share-test-0001'});
    assert.match(result.token,/^[A-Za-z0-9_-]{43}$/);
    const insert=calls.find(call=>call.sql.includes('INSERT INTO practice_plan_share_invites'));
    assert.match(insert.values[3],/^[0-9a-f]{64}$/);assert.notEqual(insert.values[3],result.token);
    const receipt=calls.find(call=>call.sql.includes('INSERT INTO practice_plan_mutation_receipts'));
    assert.equal(receipt.values[4].includes(result.token),false);assert.equal(JSON.parse(receipt.values[4]).path,null);
});
test('a claimed invite cannot be redeemed for a different learner',async()=>{
    const {store,calls}=await setup(sql=>{
        if(sql.includes('SELECT source_plan_id FROM practice_plan_share_invites'))return {rows:[{source_plan_id:ids.plan}]};
        if(sql.includes('SELECT *,clock_timestamp()>=expires_at'))return {rows:[{id:ids.invite,source_plan_id:ids.plan,redeemed_at:'2026-10-18T00:00:00Z',redeemed_by_user_id:actor.userId,redeemed_learner_id:'20000000-0000-4000-8000-000000000002'}]};
    });
    await assert.rejects(store.redeemLearningBookInvite(actor,{token:'A'.repeat(43),idempotencyKey:'redeem-test-0001'}),{code:'SHARE_ALREADY_REDEEMED'});
    assert.equal(calls.some(call=>call.sql.includes('INSERT INTO practice_plan_subscriptions')),false);
    const planLock=calls.findIndex(call=>call.sql.includes('SELECT * FROM practice_plans WHERE'));
    const inviteLock=calls.findIndex(call=>call.sql.includes('SELECT *,clock_timestamp()>=expires_at'));
    assert.ok(planLock>=0&&inviteLock>planLock);
});
test('migration preserves filter-only settings without inventing question mappings',async()=>{
    const {store,calls}=await setup();
    const snapshot={questionLimit:15,subject:'國文',scopeFilters:['語文常識（二）']};
    const result=await store.migrateLearningBooks(actor,{migrationId:'migration-test-0001',books:[{legacyId:'browser-plan',name:'原學習設定',checkMode:'complete',questions:[],filterSnapshot:snapshot,schedules:[]}],unresolvedItems:[{legacyId:'missing',reason:'無法對應'}]});
    assert.equal(result.importedBooks,1);assert.equal(result.importedSchedules,0);assert.equal(result.unresolvedItems.length,1);
    assert.equal(calls.some(call=>call.sql.includes('FROM jsonb_to_recordset')),false);
    const revision=calls.find(call=>call.sql.includes('INSERT INTO practice_plan_revisions'));
    assert.equal(revision.values[5],15);assert.equal(revision.values[6],'dynamic');assert.deepEqual(JSON.parse(revision.values[7]),snapshot);
});
test('migration reports invalid records and rolls back their individual savepoint',async()=>{
    const {store,calls}=await setup();
    const result=await store.migrateLearningBooks(actor,{migrationId:'migration-test-0002',books:[{name:'missing questions'}]});
    assert.equal(result.importedBooks,0);assert.equal(result.unresolvedItems.length,1);
    assert.ok(calls.some(call=>call.sql==='ROLLBACK TO SAVEPOINT learning_book_migration_item'));
    assert.ok(calls.some(call=>call.sql.includes('INSERT INTO practice_plan_mutation_receipts')));
});
