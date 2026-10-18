import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile,readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { userInfo } from "node:os";
import path from "node:path";
import vm from "node:vm";
import test from "node:test";
import pg from "pg";
import ts from "typescript";
import { verifyLocalPostgresTestLockProof } from "../scripts/with-local-postgres-test-lock.mjs";

const require=createRequire(import.meta.url);
async function load(file,deps={}) {
    const source=await readFile(new URL(file,import.meta.url),'utf8');
    const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    const module={exports:{}};
    vm.runInNewContext(js,{module,exports:module.exports,console,URL,URLSearchParams,Date,Map,Set,Buffer,require:name=>name.startsWith('node:')?require(name):deps[name]??{}});
    return module.exports;
}

test('learning-book PostgreSQL lifecycle, sharing isolation, version pinning and migration replay',async()=>{
    await verifyLocalPostgresTestLockProof();
    const nonce=randomUUID();
    const database=`lerniqa_book_test_${nonce.replaceAll('-','')}`;
    assert.match(database,/^lerniqa_book_test_[0-9a-f]{32}$/);
    const ownership=`isolated-learning-book-api:${nonce}`;
    const config={host:path.join(process.cwd(),'local-data/postgres-socket'),port:55432,user:userInfo().username};
    const admin=new pg.Client({...config,database:'postgres'});
    await admin.connect();
    let pool;let created=false;
    try {
        await admin.query(`CREATE DATABASE "${database}"`);created=true;
        await admin.query(`COMMENT ON DATABASE "${database}" IS '${ownership}'`);
        pool=new pg.Pool({...config,database,max:8});
        for(const file of (await readdir(new URL('../database/migrations/',import.meta.url))).filter(name=>/^\d{4}_.+\.up\.sql$/.test(name)).sort()) await pool.query(await readFile(new URL(`../database/migrations/${file}`,import.meta.url),'utf8'));
        const owner={userId:randomUUID(),learnerId:randomUUID(),role:'parent'};
        const recipient={userId:randomUUID(),learnerId:randomUUID(),role:'parent'};
        const outsider={userId:randomUUID(),learnerId:randomUUID(),role:'parent'};
        for(const actor of [owner,recipient,outsider]) {
            await pool.query(`INSERT INTO users(id,display_name) VALUES($1,$2)`,[actor.userId,actor===owner?'Synthetic owner':'Synthetic recipient']);
            await pool.query(`INSERT INTO learners(id,display_name,education_status) VALUES($1,'Synthetic learner','not_enrolled')`,[actor.learnerId]);
            await pool.query(`INSERT INTO learner_access(id,user_id,learner_id,access_role,can_create_plans,accepted_at) VALUES($1,$2,$3,'parent',true,CURRENT_TIMESTAMP)`,[randomUUID(),actor.userId,actor.learnerId]);
        }
        const questionId=randomUUID(),questionRevision=randomUUID(),unauthorizedQuestionId=randomUUID(),unauthorizedRevision=randomUUID(),typeId=randomUUID(),bankId=randomUUID();
        const newerUnauthorizedRevision=randomUUID(),oldParts=[randomUUID(),randomUUID()],newParts=[randomUUID(),randomUUID()];
        await pool.query(`INSERT INTO question_types(id,code,name) VALUES($1,'synthetic-book-text','Synthetic text')`,[typeId]);
        await pool.query(`INSERT INTO question_banks(id,name,origin) VALUES($1,'Synthetic isolated bank','system')`,[bankId]);
        // Keep publication and current pointer in one transaction.
        const seed=await pool.connect();
        try {
            await seed.query('BEGIN');
            for(const [targetId,revisionId] of [[questionId,questionRevision],[unauthorizedQuestionId,unauthorizedRevision]]) {
                await seed.query(`INSERT INTO questions(id,origin,owner_user_id,created_method) VALUES($1,'account',$2,'migration')`,[targetId,owner.userId]);
                await seed.query(`INSERT INTO question_revisions(id,question_id,revision_number,question_type_id,status,created_by_type) VALUES($1,$2,1,$3,'draft','migration')`,[revisionId,targetId,typeId]);
                if(targetId===unauthorizedQuestionId) for(const [position,partId] of oldParts.entries()) await seed.query(`INSERT INTO question_parts(id,question_revision_id,stable_key,position,answer_mode,grading_policy) VALUES($1,$2,$3,$4,'text','manual_review')`,[partId,revisionId,`part-${position}`,position]);
                await seed.query(`UPDATE question_revisions SET status='published',published_at=CURRENT_TIMESTAMP WHERE id=$1`,[revisionId]);
                await seed.query(`UPDATE questions SET status='published',current_revision_id=$2 WHERE id=$1`,[targetId,revisionId]);
            }
            await seed.query(`INSERT INTO question_revisions(id,question_id,revision_number,question_type_id,status,created_by_type) VALUES($1,$2,2,$3,'draft','migration')`,[newerUnauthorizedRevision,unauthorizedQuestionId,typeId]);
            for(const [position,partId] of newParts.entries()) await seed.query(`INSERT INTO question_parts(id,question_revision_id,stable_key,position,answer_mode,grading_policy) VALUES($1,$2,$3,$4,'text','manual_review')`,[partId,newerUnauthorizedRevision,`part-${position}`,position]);
            await seed.query(`UPDATE question_revisions SET status='published',published_at=CURRENT_TIMESTAMP WHERE id=$1`,[newerUnauthorizedRevision]);
            await seed.query(`UPDATE questions SET current_revision_id=$2 WHERE id=$1`,[unauthorizedQuestionId,newerUnauthorizedRevision]);
            await seed.query(`UPDATE question_revisions SET status='superseded' WHERE id=$1`,[unauthorizedRevision]);
            await seed.query('COMMIT');
        }catch(error){await seed.query('ROLLBACK');throw error;}finally{seed.release();}
        for(const targetId of [questionId,unauthorizedQuestionId]) await pool.query(`INSERT INTO question_bank_items(question_bank_id,question_id) VALUES($1,$2)`,[bankId,targetId]);
        await pool.query(`INSERT INTO question_bank_learners(question_bank_id,learner_id) VALUES($1,$2)`,[bankId,owner.learnerId]);
        const contract=await load('../app/lib/learning-book-contract.ts');
        const store=await load('../app/lib/learning-book-store.ts',{'./learning-book-contract':contract,'./local-postgres':{withLocalPostgresTransaction:async fn=>{
            const client=await pool.connect();
            try{await client.query('BEGIN');const result=await fn(client);await client.query('COMMIT');return result;}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
        }}});
        const sameRevisionParts=oldParts.map(partId=>({questionId:unauthorizedQuestionId,revisionId:unauthorizedRevision,partId}));
        const mixedRevisionParts=[sameRevisionParts[0],{questionId:unauthorizedQuestionId,revisionId:newerUnauthorizedRevision,partId:newParts[1]}];
        const partContent={name:'Synthetic selected parts',checkMode:'instant',questions:sameRevisionParts,filterSnapshot:{},idempotencyKey:randomUUID()};
        await assert.rejects(store.createLearningBook(owner,{...partContent,questions:mixedRevisionParts}),{code:'MIXED_QUESTION_REVISIONS',status:409});
        assert.equal((await pool.query(`SELECT count(*)::integer total FROM practice_plans`)).rows[0].total,0);
        const partBook=await store.createLearningBook(owner,partContent);
        assert.equal(partBook.questions.length,2);assert.ok(partBook.questions.every(item=>item.revisionId===unauthorizedRevision));
        await assert.rejects(store.updateLearningBook(owner,partBook.id,{...partContent,questions:mixedRevisionParts,action:'edit',lockVersion:partBook.lockVersion,idempotencyKey:randomUUID()}),{code:'MIXED_QUESTION_REVISIONS',status:409});
        const unchangedPartBook=await store.getLearningBook(owner,partBook.id);
        assert.equal(unchangedPartBook.revisionId,partBook.revisionId);assert.equal(unchangedPartBook.lockVersion,partBook.lockVersion);assert.equal(unchangedPartBook.hasDraft,false);
        await store.updateLearningBook(owner,partBook.id,{action:'archive',lockVersion:partBook.lockVersion,idempotencyKey:randomUUID()});
        const content={name:'Synthetic immutable book',checkMode:'instant',questions:[{questionId,revisionId:questionRevision}],filterSnapshot:{subject:'synthetic'},idempotencyKey:randomUUID(),publish:false};
        let book=await store.createLearningBook(owner,content);
        assert.equal(book.status,'draft');assert.equal(book.hasDraft,true);
        const replay=await store.createLearningBook(owner,content);assert.equal(replay.id,book.id);
        book=await store.updateLearningBook(owner,book.id,{action:'publish',lockVersion:book.lockVersion,idempotencyKey:randomUUID()});
        const firstRevision=book.revisionId;
        assert.equal(book.hasDraft,false);
        const scheduleOne=await store.createLearningBookSchedule(owner,{bookId:book.id,scheduledFor:'2026-10-25T09:00:00+08:00',idempotencyKey:randomUUID()});
        const scheduleTwo=await store.createLearningBookSchedule(owner,{bookId:book.id,scheduledFor:'2026-10-26T09:00:00+08:00',idempotencyKey:randomUUID()});
        assert.notEqual(scheduleOne.id,scheduleTwo.id);assert.equal(scheduleOne.revisionId,firstRevision);
        const scheduled=await store.listLearningBooks(owner,contract.parseListQuery(new URLSearchParams('arrangement=scheduled')));
        assert.equal(scheduled.books.length,1);assert.equal(scheduled.books[0].activeScheduleCount,2);
        await assert.rejects(store.getLearningBook(outsider,book.id),{code:'BOOK_NOT_FOUND'});
        const inviteInput={idempotencyKey:randomUUID()};
        const share=await store.createLearningBookInvite(owner,book.id,inviteInput);
        assert.ok(share.token);const shareReplay=await store.createLearningBookInvite(owner,book.id,inviteInput);assert.equal(shareReplay.token,null);
        const preview=await store.inspectLearningBookInvite(recipient,share.token);assert.equal(preview.name,content.name);
        const redeem={token:share.token,idempotencyKey:randomUUID()};
        const shared=await store.redeemLearningBookInvite(recipient,redeem);
        assert.equal(shared.source,'shared');assert.equal(shared.creator.id,owner.userId);assert.equal(shared.sharer.id,owner.userId);
        const again=await store.redeemLearningBookInvite(recipient,redeem);assert.equal(again.id,shared.id);
        await assert.rejects(store.redeemLearningBookInvite(outsider,{token:share.token,idempotencyKey:randomUUID()}),{code:'SHARE_ALREADY_REDEEMED'});
        const sharedSchedule=await store.createLearningBookSchedule(recipient,{bookId:shared.id,scheduledFor:'2026-10-26T10:00:00+08:00',idempotencyKey:randomUUID()});
        assert.equal(sharedSchedule.planId,null);assert.equal(sharedSchedule.subscriptionId,shared.id);assert.equal(sharedSchedule.revisionId,firstRevision);
        const copied=await store.forkLearningBook(recipient,shared.id,{idempotencyKey:randomUUID()});
        assert.equal(copied.source,'mine');assert.equal(copied.creator.id,recipient.userId);assert.equal(copied.questions[0].questionId,questionId);
        assert.equal((await pool.query(`SELECT count(*)::integer total FROM question_bank_learners WHERE learner_id=$1`,[recipient.learnerId])).rows[0].total,0);
        const copyName='Synthetic personal fork';
        let editedCopy=await store.updateLearningBook(recipient,copied.id,{...copied,name:copyName,checkMode:'complete',action:'edit',lockVersion:copied.lockVersion,idempotencyKey:randomUUID()});
        // Replacing an existing draft must authorize its exact targets before deleting it.
        editedCopy=await store.updateLearningBook(recipient,copied.id,{...editedCopy,action:'edit',lockVersion:editedCopy.lockVersion,idempotencyKey:randomUUID()});
        editedCopy=await store.updateLearningBook(recipient,copied.id,{action:'publish',lockVersion:editedCopy.lockVersion,idempotencyKey:randomUUID()});
        assert.equal(editedCopy.name,copyName);assert.equal(editedCopy.checkMode,'complete');assert.notEqual(editedCopy.revisionId,copied.revisionId);
        assert.deepEqual(editedCopy.questions,copied.questions);
        await assert.rejects(store.updateLearningBook(recipient,copied.id,{...editedCopy,questions:[...editedCopy.questions,{questionId:unauthorizedQuestionId,revisionId:unauthorizedRevision}],action:'edit',lockVersion:editedCopy.lockVersion,idempotencyKey:randomUUID()}),{code:'QUESTION_UNAVAILABLE'});
        const intactCopy=await store.getLearningBook(recipient,copied.id);
        assert.equal(intactCopy.hasDraft,false);assert.equal(intactCopy.revisionId,editedCopy.revisionId);assert.equal(intactCopy.lockVersion,editedCopy.lockVersion);
        book=await store.updateLearningBook(owner,book.id,{...content,name:'Synthetic version two',action:'edit',lockVersion:book.lockVersion,idempotencyKey:randomUUID()});
        assert.equal(book.hasDraft,true);
        book=await store.updateLearningBook(owner,book.id,{action:'publish',lockVersion:book.lockVersion,idempotencyKey:randomUUID()});
        assert.notEqual(book.revisionId,firstRevision);
        const afterSync=await store.getLearningBook(recipient,shared.id);assert.equal(afterSync.revisionId,book.revisionId);
        const historical=await store.listLearningBookSchedules(recipient);assert.equal(historical.schedules[0].revisionId,firstRevision);assert.equal(historical.schedules[0].sourceHasUpdate,true);
        const copyAfter=await store.getLearningBook(recipient,copied.id);assert.equal(copyAfter.name,copyName);
        await store.revokeLearningBookShare(owner,book.id,{subscriptionId:shared.id,idempotencyKey:randomUUID()});
        await assert.rejects(store.getLearningBook(recipient,shared.id),{code:'SHARE_REVOKED'});
        await assert.rejects(store.createLearningBookSchedule(recipient,{bookId:shared.id,scheduledFor:'2026-10-28T09:00:00+08:00',idempotencyKey:randomUUID()}),{code:'BOOK_UNAVAILABLE'});
        const blocked=await store.listLearningBookSchedules(recipient);assert.equal(blocked.schedules[0].canStart,false);
        const inbox=await store.learningBookNotifications(recipient);assert.equal(inbox.notifications.length,3);
        const readInbox=await store.learningBookNotifications(recipient,[inbox.notifications[0].id]);assert.ok(readInbox.notifications[0].readAt);
        const migration={migrationId:randomUUID(),books:[{name:'Synthetic legacy filters',checkMode:'complete',questions:[],filterSnapshot:{questionLimit:15,subject:'國文'},schedules:[]}],unresolvedItems:[{id:'unmatched-legacy'}]};
        const migrated=await store.migrateLearningBooks(owner,migration);const migratedAgain=await store.migrateLearningBooks(owner,migration);
        assert.equal(migrated.importedBooks,1);assert.equal(migratedAgain.bookIds[0],migrated.bookIds[0]);assert.equal(migrated.unresolvedItems.length,1);
        for(const sort of ['updated','created','scheduled','name']) {
            const pageOne=await store.listLearningBooks(owner,contract.parseListQuery(new URLSearchParams({limit:'1',sort})));
            assert.ok(pageOne.nextCursor,`${sort} provides a continuation cursor`);
            const pageTwo=await store.listLearningBooks(owner,contract.parseListQuery(new URLSearchParams({limit:'1',sort,cursor:pageOne.nextCursor})));
            assert.equal(pageTwo.books.length,1);assert.notEqual(pageOne.books[0].id,pageTwo.books[0].id);assert.equal(pageTwo.nextCursor,null);
        }
        const receipts=await pool.query(`SELECT response::text FROM practice_plan_mutation_receipts`);assert.equal(receipts.rows.some(row=>row.response.includes(share.token)),false);
        const audit=await pool.query(`SELECT count(*)::integer total FROM practice_plan_audit_events`);assert.ok(audit.rows[0].total>=10);
        // Two accounts racing for a fresh one-use invite must yield exactly one subscription.
        const concurrent=await store.createLearningBookInvite(owner,book.id,{idempotencyKey:randomUUID()});
        const outcomes=await Promise.allSettled([recipient,outsider].map(who=>store.redeemLearningBookInvite(who,{token:concurrent.token,idempotencyKey:randomUUID()})));
        assert.equal(outcomes.filter(result=>result.status==='fulfilled').length,1);
        assert.equal(outcomes.filter(result=>result.status==='rejected'&&result.reason.code==='SHARE_ALREADY_REDEEMED').length,1);
    }finally{
        if(pool) await pool.end();
        if(created){
            const owned=await admin.query(`SELECT shobj_description(oid,'pg_database') ownership FROM pg_database WHERE datname=$1`,[database]);
            assert.equal(owned.rows[0]?.ownership,ownership,'refuse cleanup without matching isolated DB provenance');
            await admin.query(`DROP DATABASE "${database}"`);
        }
        await admin.end();
    }
});
