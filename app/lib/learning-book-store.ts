import "server-only";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { PoolClient, QueryResultRow } from "pg";
import { withLocalPostgresTransaction } from "./local-postgres";
import { LEARNING_BOOK_POLICY, LearningBookError, decodeLearningBookCursor, encodeLearningBookCursor, parseContent, parseLearningBookSettings, parseLock, parseScheduleDate, parseShareToken, record, uuid, type LearningBookActor, type LearningBookContent, type LearningBookDetail, type LearningBookDto, type LearningBookListQuery, type LearningBookListResult, type LearningBookQuestion, type LearningBookScheduleDto } from "./learning-book-contract";

type Row = QueryResultRow & Record<string, any>; // PostgreSQL row shape is narrowed at the DTO boundary.
const fail = (code: string, message: string, status = 400): never => { throw new LearningBookError(code, message, status); };
const iso = (value: Date | string) => value instanceof Date ? value.toISOString() : new Date(value).toISOString();
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
function canonical(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    if (record(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
    return JSON.stringify(value) ?? "null";
}
export async function requireLearningBookAccess(client: PoolClient, actor: LearningBookActor, create = false) {
    const found = await client.query(`SELECT access.id FROM learner_access access JOIN learners learner ON learner.id=access.learner_id AND learner.status='active' WHERE access.user_id=$1 AND access.learner_id=$2 AND access.accepted_at IS NOT NULL AND access.revoked_at IS NULL AND (NOT $3::boolean OR access.can_create_plans) FOR SHARE OF access,learner`, [actor.userId, actor.learnerId, create]);
    if (!found.rowCount) fail("LEARNING_BOOK_FORBIDDEN", create ? "你沒有為這位學習者建立或安排學習本的權限。" : "無法存取這位學習者的學習本。", 403);
}
async function audit(client: PoolClient, actor: LearningBookActor, event: string, planId: string | null, subscriptionId: string | null = null, metadata: unknown = {}) {
    await client.query(`INSERT INTO practice_plan_audit_events(id,actor_user_id,learner_id,practice_plan_id,subscription_id,event_type,metadata) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)`, [randomUUID(),actor.userId,actor.learnerId,planId,subscriptionId,event,JSON.stringify(metadata)]);
}
async function notify(client: PoolClient, learnerId: string, kind: string, planId: string, subscriptionId: string, revisionId: string | null) {
    await client.query(`INSERT INTO practice_plan_notifications(id,user_id,learner_id,kind,practice_plan_id,subscription_id,revision_id) SELECT gen_random_uuid(),user_id,$1,$2,$3,$4,$5 FROM learner_access WHERE learner_id=$1 AND accepted_at IS NOT NULL AND revoked_at IS NULL GROUP BY user_id`, [learnerId,kind,planId,subscriptionId,revisionId]);
}
async function mutation<T>(actor: LearningBookActor, action: string, key: unknown, input: unknown, fn: (client: PoolClient) => Promise<T>, receiptValue: (value:T)=>unknown = value=>value): Promise<T> {
    if (typeof key !== "string" || key.length < 8 || key.length > 140 || !/^[A-Za-z0-9_:.\-]+$/.test(key)) fail("INVALID_IDEMPOTENCY_KEY", "請提供有效的重送識別碼。");
    action=`${actor.learnerId}:${action}`;
    return withLocalPostgresTransaction(async (client) => {
        await requireLearningBookAccess(client, actor);
        await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [`learning-book:${actor.userId}:${action}:${key}`]);
        const requestHash = hash(canonical(input));
        const receipt = await client.query<Row>(`SELECT request_hash,response FROM practice_plan_mutation_receipts WHERE actor_user_id=$1 AND action=$2 AND idempotency_key=$3`, [actor.userId,action,key]);
        if (receipt.rows[0]) {
            if (receipt.rows[0].request_hash !== requestHash) fail("IDEMPOTENCY_CONFLICT", "這個重送識別碼已用於不同內容。", 409);
            const response=receipt.rows[0].response;
            if(record(response)&&response.subscriptionId) {
                const subscription=await client.query(`SELECT id FROM practice_plan_subscriptions WHERE id=$1 AND recipient_learner_id=$2 AND status='active'`,[response.subscriptionId,actor.learnerId]);
                if(!subscription.rowCount) fail("SHARE_REVOKED","分享已停止。",403);
            }
            return receipt.rows[0].response as T;
        }
        const result = await fn(client);
        await client.query(`INSERT INTO practice_plan_mutation_receipts(actor_user_id,action,idempotency_key,request_hash,response) VALUES($1,$2,$3,$4,$5::jsonb)`, [actor.userId,action,key,requestHash,JSON.stringify(receiptValue(result))]);
        return result;
    });
}
const librarySql = `WITH library AS (
 SELECT p.id,p.id plan_id,NULL::uuid subscription_id,'mine'::text source,p.learner_id,p.created_by_user_id creator_id,NULL::uuid sharer_id,p.name,p.status,p.lock_version,CASE WHEN p.created_by_user_id=$2 THEN COALESCE(p.draft_revision_id,p.current_published_revision_id) ELSE p.current_published_revision_id END revision_id,p.created_at,p.updated_at,false revoked,p.current_published_revision_id latest_revision_id
 FROM practice_plans p WHERE p.learner_id=$1 AND (p.status<>'draft' OR p.created_by_user_id=$2)
 UNION ALL
 SELECT sub.id,p.id,sub.id,'shared',sub.recipient_learner_id,p.created_by_user_id,sub.shared_by_user_id,r.name,CASE WHEN p.status='archived' THEN 'archived' ELSE 'active' END,p.lock_version,sub.current_revision_id,sub.accepted_at,GREATEST(p.updated_at,sub.accepted_at),sub.status='revoked',p.current_published_revision_id
 FROM practice_plan_subscriptions sub JOIN practice_plans p ON p.id=sub.source_plan_id JOIN practice_plan_revisions r ON r.id=sub.current_revision_id WHERE sub.recipient_learner_id=$1
), enriched AS (
 SELECT l.*,r.name revision_name,creator.display_name creator_name,sharer.display_name sharer_name,r.revision_number,r.check_mode,r.selection_mode,r.question_limit,r.settings_snapshot,
 (SELECT revision_number FROM practice_plan_revisions published WHERE published.id=l.latest_revision_id) published_revision_number,
 (l.source='mine' AND l.revision_id IS DISTINCT FROM l.latest_revision_id) has_draft,
 (SELECT count(*)::integer FROM practice_schedules s WHERE s.learner_id=$1 AND s.status IN ('scheduled','available') AND (s.practice_plan_id=l.id OR s.practice_plan_subscription_id=l.subscription_id)) active_schedule_count,
 (SELECT max(s.scheduled_for) FROM practice_schedules s WHERE s.learner_id=$1 AND (s.practice_plan_id=l.id OR s.practice_plan_subscription_id=l.subscription_id)) last_scheduled,
 COALESCE((SELECT jsonb_agg(jsonb_build_object('questionId',i.question_id,'revisionId',i.question_revision_id)||CASE WHEN i.question_part_id IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('partId',i.question_part_id) END ORDER BY i.position) FROM practice_plan_revision_items i WHERE i.practice_plan_revision_id=l.revision_id),'[]'::jsonb) questions
 FROM library l JOIN users creator ON creator.id=l.creator_id LEFT JOIN users sharer ON sharer.id=l.sharer_id LEFT JOIN practice_plan_revisions r ON r.id=l.revision_id
)`;
function bookDto(row: Row, actor: LearningBookActor): LearningBookDto {
    row={...row,name:row.revision_name??row.name};
    return { id:row.id,planId:row.plan_id,subscriptionId:row.subscription_id,source:row.source,name:row.name,status:row.status,lockVersion:row.lock_version,revisionId:row.revision_id,revisionNumber:row.revision_number ?? 0,hasDraft:!!row.has_draft,publishedRevisionNumber:row.published_revision_number??null,creator:{id:row.creator_id,displayName:row.creator_name},sharer:row.sharer_id ? {id:row.sharer_id,displayName:row.sharer_name}:null,activeScheduleCount:row.active_schedule_count,syncStatus:row.revoked ? "revoked" : row.revision_id !== row.latest_revision_id && row.source === "shared" ? "updated":"synced",canEdit:row.source === "mine" && row.creator_id === actor.userId,createdAt:iso(row.created_at),updatedAt:iso(row.updated_at),questions:row.revoked ? [] : row.questions,checkMode:row.check_mode ?? "instant",filterSnapshot:row.revoked ? {} : row.settings_snapshot ?? {} };
}
export async function listLearningBooks(actor: LearningBookActor, filters: LearningBookListQuery): Promise<LearningBookListResult> {
    return withLocalPostgresTransaction(async(client) => {
        await requireLearningBookAccess(client,actor);
        const where = `($3='all' OR ($3='scheduled' AND active_schedule_count>0) OR ($3='unscheduled' AND active_schedule_count=0)) AND ($4='all' OR ($4='mine' AND source='mine' AND creator_id=$2) OR ($4='shared' AND source='shared')) AND ($5='all' OR ($5='active' AND status IN ('active','draft')) OR status=$5) AND (cardinality($6::uuid[])=0 OR creator_id=ANY($6)) AND (cardinality($7::uuid[])=0 OR sharer_id=ANY($7)) AND ($8='' OR position(lower($8) IN lower(COALESCE(revision_name,name)))>0) AND ($9='all' OR ($9='revoked' AND revoked) OR ($9='synced' AND NOT revoked AND (source='mine' OR revision_id=latest_revision_id)) OR ($9='updated' AND NOT revoked AND source='shared' AND revision_id<>latest_revision_id))`;
        const sortKey={updated:'updated_at',created:'created_at',scheduled:'last_scheduled',name:'COALESCE(revision_name,name) COLLATE "C"'}[filters.sort];
        const order=`${sortKey}${filters.sort==='name'?' ASC':' DESC NULLS LAST'},id`;
        const cursor=decodeLearningBookCursor(filters.cursor,filters.sort);
        const after=filters.sort==='name' ? `(NOT $10::boolean OR ${sortKey}>$11::text COLLATE "C" OR (${sortKey}=$11::text COLLATE "C" AND id>$12::uuid))` : filters.sort==='scheduled' ? `(NOT $10::boolean OR ($11::timestamptz IS NULL AND last_scheduled IS NULL AND id>$12::uuid) OR ($11::timestamptz IS NOT NULL AND (last_scheduled<$11::timestamptz OR last_scheduled IS NULL OR (last_scheduled=$11::timestamptz AND id>$12::uuid))))` : `(NOT $10::boolean OR ${sortKey}<$11::timestamptz OR (${sortKey}=$11::timestamptz AND id>$12::uuid))`;
        const cursorKey=filters.sort==='name'?'COALESCE(revision_name,name)':`to_char(${sortKey} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
        const values=[actor.learnerId,actor.userId,filters.arrangement,filters.source,filters.status,filters.creatorIds,filters.sharerIds,filters.search,filters.sync];
        const rows=await client.query<Row>(`${librarySql} SELECT *,${cursorKey} cursor_key FROM enriched WHERE ${where} AND ${after} ORDER BY ${order} LIMIT $13`,[...values,!!cursor,cursor?.key??null,cursor?.id??null,filters.limit+1]);
        const total=await client.query<Row>(`${librarySql} SELECT count(*)::integer total FROM enriched WHERE ${where}`,values);
        const facets=await client.query<Row>(`${librarySql} SELECT DISTINCT creator_id,creator_name,sharer_id,sharer_name FROM enriched`,[actor.learnerId,actor.userId]);
        const people=(prefix:"creator"|"sharer")=>[...new Map(facets.rows.filter(row=>row[`${prefix}_id`]).map(row=>[row[`${prefix}_id`],{id:row[`${prefix}_id`],displayName:row[`${prefix}_name`]}])).values()];
        const page=rows.rows.slice(0,filters.limit);const last=page.at(-1);
        return {books:page.map(row=>bookDto(row,actor)),nextCursor:rows.rows.length>filters.limit&&last ? encodeLearningBookCursor({sort:filters.sort,key:last.cursor_key,id:last.id}):null,total:total.rows[0].total,facets:{creators:people("creator"),sharers:people("sharer")}};
    });
}
async function readBook(client: PoolClient,actor:LearningBookActor,id:string) {
    const result=await client.query<Row>(`${librarySql} SELECT * FROM enriched WHERE id=$3`,[actor.learnerId,actor.userId,id]);
    if (!result.rows[0]) fail("BOOK_NOT_FOUND","找不到這本學習本。",404);
    return result.rows[0];
}
async function ownPlan(client: PoolClient,actor:LearningBookActor,id:string,lockVersion?:number) {
    await requireLearningBookAccess(client,actor,true);
    const result=await client.query<Row>(`SELECT * FROM practice_plans WHERE id=$1 AND learner_id=$2 AND created_by_user_id=$3 FOR UPDATE`,[id,actor.learnerId,actor.userId]);
    const plan=result.rows[0];
    if(!plan) fail("BOOK_NOT_FOUND","找不到可管理的學習本。",404);
    if(lockVersion!==undefined && plan.lock_version!==lockVersion) fail("BOOK_CHANGED","學習本已更新，請重新載入。",409);
    return plan;
}
async function resolveQuestions(client:PoolClient,actor:LearningBookActor,questions:LearningBookQuestion[],existingRevisionId:string|null=null) {
    // An owned revision can retain its exact targets (including a shared fork), but
    // does not grant access to other questions, revisions or parts in the source bank.
    const result=await client.query<Row>(`SELECT q.id,COALESCE(target.revision_id,q.current_revision_id) revision_id,target.part_id,target.position FROM jsonb_to_recordset($1::jsonb) AS target(question_id uuid,revision_id uuid,part_id uuid,position integer) JOIN questions q ON q.id=target.question_id AND q.status='published' JOIN question_revisions r ON r.id=COALESCE(target.revision_id,q.current_revision_id) AND r.question_id=q.id AND r.status IN ('published','superseded') LEFT JOIN question_parts part ON part.id=target.part_id AND part.question_revision_id=r.id WHERE (target.part_id IS NULL OR part.id IS NOT NULL) AND (EXISTS(SELECT 1 FROM question_bank_items bi JOIN question_banks b ON b.id=bi.question_bank_id AND b.status='active' JOIN question_bank_learners bl ON bl.question_bank_id=b.id AND bl.learner_id=$2 WHERE bi.question_id=q.id) OR EXISTS(SELECT 1 FROM practice_plan_revision_items existing_item JOIN practice_plan_revisions existing_revision ON existing_revision.id=existing_item.practice_plan_revision_id JOIN practice_plans existing_plan ON existing_plan.id=existing_revision.practice_plan_id WHERE existing_revision.id=$3::uuid AND existing_plan.learner_id=$2 AND existing_plan.created_by_user_id=$4 AND existing_revision.id IN (existing_plan.draft_revision_id,existing_plan.current_published_revision_id) AND existing_item.question_id=q.id AND existing_item.question_revision_id=r.id AND existing_item.question_part_id IS NOT DISTINCT FROM target.part_id)) ORDER BY target.position`,[JSON.stringify(questions.map((q,position)=>({question_id:q.questionId,revision_id:q.revisionId??null,part_id:q.partId??null,position}))),actor.learnerId,existingRevisionId,actor.userId]);
    if(result.rows.length!==questions.length) fail("QUESTION_UNAVAILABLE","部分題目或版本無法安全對應，請重新選擇題目。",409);
    return result.rows;
}
async function insertRevision(client:PoolClient,actor:LearningBookActor,planId:string,content:LearningBookContent,publish:boolean,trustedQuestions?:Row[],dynamicLimit?:number) {
    const items=trustedQuestions??await resolveQuestions(client,actor,content.questions);
    const revisionId=randomUUID();
    const number=await client.query<Row>(`SELECT COALESCE(max(revision_number),0)+1 value FROM practice_plan_revisions WHERE practice_plan_id=$1`,[planId]);
    await client.query(`INSERT INTO practice_plan_revisions(id,practice_plan_id,revision_number,status,name,check_mode,question_limit,selection_mode,settings_snapshot,created_by_user_id) VALUES($1,$2,$3,'draft',$4,$5,$6,$7,$8::jsonb,$9)`,[revisionId,planId,number.rows[0].value,content.name,content.checkMode,dynamicLimit??items.length,dynamicLimit?"dynamic":"fixed",JSON.stringify(content.filterSnapshot),actor.userId]);
    for(const item of items) await client.query(`INSERT INTO practice_plan_revision_items(id,practice_plan_revision_id,question_id,question_revision_id,question_part_id,position,reason) VALUES($1,$2,$3,$4,$5,$6,'selected')`,[randomUUID(),revisionId,item.question_id??item.id,item.revision_id??item.question_revision_id,item.part_id??item.question_part_id??null,item.position]);
    if(publish) await client.query(`UPDATE practice_plan_revisions SET status='published',published_by_user_id=$2,published_at=CURRENT_TIMESTAMP WHERE id=$1`,[revisionId,actor.userId]);
    await client.query(`UPDATE practice_plans SET name=$2,check_mode=$3,question_limit=$4,selection_mode=$5,filter_snapshot=$6::jsonb,draft_revision_id=CASE WHEN $7 THEN NULL ELSE $8::uuid END,current_published_revision_id=CASE WHEN $7 THEN $8::uuid ELSE current_published_revision_id END,status=CASE WHEN $7 THEN 'active' ELSE status END,updated_at=CURRENT_TIMESTAMP WHERE id=$1`,[planId,content.name,content.checkMode,dynamicLimit??items.length,dynamicLimit?"dynamic":"fixed",JSON.stringify(content.filterSnapshot),publish,revisionId]);
    return revisionId;
}
async function createBook(client:PoolClient,actor:LearningBookActor,content:LearningBookContent,publish:boolean,trustedQuestions?:Row[],dynamicLimit?:number) {
    await requireLearningBookAccess(client,actor,true);
    const id=randomUUID();
    await client.query(`INSERT INTO practice_plans(id,learner_id,created_by_user_id,created_role,name,basis,check_mode,question_limit,selection_mode,status,filter_snapshot) VALUES($1,$2,$3,$4,$5,'chapter',$6,$7,$8,'draft',$9::jsonb)`,[id,actor.learnerId,actor.userId,actor.role,content.name,content.checkMode,dynamicLimit??content.questions.length,dynamicLimit?"dynamic":"fixed",JSON.stringify(content.filterSnapshot)]);
    await insertRevision(client,actor,id,content,publish,trustedQuestions,dynamicLimit);
    await audit(client,actor,publish?"created_published":"created_draft",id);
    return bookDto(await readBook(client,actor,id),actor);
}
export async function createLearningBook(actor:LearningBookActor,body:Record<string,unknown>) {
    const content=parseContent(body);
    return mutation(actor,"create",body.idempotencyKey,{...content,publish:body.publish!==false},client=>createBook(client,actor,content,body.publish!==false));
}
export async function updateLearningBook(actor:LearningBookActor,id:string,body:Record<string,unknown>) {
    const lock=parseLock(body.lockVersion);
    if(!["edit","publish","archive"].includes(String(body.action))) fail("INVALID_ACTION","學習本操作不正確。");
    return mutation(actor,`update:${id}`,body.idempotencyKey,body,async(client)=>{
        const plan=await ownPlan(client,actor,id,lock);
        if(plan.status==='archived') fail("BOOK_ARCHIVED","這本學習本已封存。",409);
        if(body.action==='edit') {
            const content=parseContent(body);
            const items=await resolveQuestions(client,actor,content.questions,plan.draft_revision_id??plan.current_published_revision_id);
            if(plan.draft_revision_id) {
                await client.query(`UPDATE practice_plans SET draft_revision_id=NULL WHERE id=$1`,[id]);
                await client.query(`DELETE FROM practice_plan_revision_items WHERE practice_plan_revision_id=$1`,[plan.draft_revision_id]);
                await client.query(`DELETE FROM practice_plan_revisions WHERE id=$1 AND status='draft'`,[plan.draft_revision_id]);
            }
            await insertRevision(client,actor,id,content,false,items);
        } else if(body.action==='publish') {
            if(!plan.draft_revision_id) fail("NO_DRAFT","沒有可發布的草稿。",409);
            await client.query(`UPDATE practice_plan_revisions SET status='published',published_by_user_id=$2,published_at=CURRENT_TIMESTAMP WHERE id=$1 AND status='draft'`,[plan.draft_revision_id,actor.userId]);
            await client.query(`UPDATE practice_plans SET current_published_revision_id=draft_revision_id,draft_revision_id=NULL,status='active' WHERE id=$1`,[id]);
            const subscriptions=await client.query<Row>(`UPDATE practice_plan_subscriptions SET current_revision_id=$2 WHERE source_plan_id=$1 AND status='active' AND sync_mode='auto' RETURNING id,recipient_learner_id`,[id,plan.draft_revision_id]);
            for(const sub of subscriptions.rows) await notify(client,sub.recipient_learner_id,"revision_published",id,sub.id,plan.draft_revision_id);
        } else await client.query(`UPDATE practice_plans SET status='archived' WHERE id=$1`,[id]);
        await client.query(`UPDATE practice_plans SET lock_version=lock_version+1,updated_at=CURRENT_TIMESTAMP WHERE id=$1`,[id]);
        await audit(client,actor,String(body.action),id);
        return bookDto(await readBook(client,actor,id),actor);
    });
}
async function schedules(client:PoolClient,actor:LearningBookActor,bookId?:string):Promise<LearningBookScheduleDto[]> {
    const result=await client.query<Row>(`SELECT s.*,session.id session_id,session.status session_status,COALESCE(p.status,source.status) source_status,sub.status subscription_status,COALESCE(p.current_published_revision_id,source.current_published_revision_id) latest_revision_id,COALESCE((SELECT jsonb_agg(jsonb_build_object('questionId',i.question_id,'revisionId',i.question_revision_id)||CASE WHEN i.question_part_id IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('partId',i.question_part_id) END ORDER BY i.position) FROM practice_schedule_items i WHERE i.practice_schedule_id=s.id),'[]'::jsonb) questions FROM practice_schedules s LEFT JOIN practice_plans p ON p.id=s.practice_plan_id LEFT JOIN practice_plan_subscriptions sub ON sub.id=s.practice_plan_subscription_id LEFT JOIN practice_plans source ON source.id=sub.source_plan_id LEFT JOIN practice_sessions session ON session.practice_schedule_id=s.id WHERE s.learner_id=$1 AND ($2::uuid IS NULL OR s.practice_plan_id=$2 OR s.practice_plan_subscription_id=$2) ORDER BY s.scheduled_for DESC,s.id`,[actor.learnerId,bookId??null]);
    return result.rows.map(row=>({id:row.id,planId:row.practice_plan_id,subscriptionId:row.practice_plan_subscription_id,revisionId:row.practice_plan_revision_id,name:row.name,scheduledFor:iso(row.scheduled_for),status:['active','paused'].includes(row.session_status)?'in_progress':row.status,checkMode:row.check_mode,lockVersion:row.lock_version,questions:row.questions,canStart:!row.session_id&&['scheduled','available'].includes(row.status)&&row.source_status==='active'&&row.subscription_status!=='revoked',sourceHasUpdate:row.latest_revision_id!==row.practice_plan_revision_id,sessionId:row.session_id??null}));
}
export async function listLearningBookSchedules(actor:LearningBookActor) {
    return withLocalPostgresTransaction(async client=>{await requireLearningBookAccess(client,actor);return {schedules:await schedules(client,actor)};});
}
export async function getLearningBook(actor:LearningBookActor,id:string):Promise<LearningBookDetail> {
    return withLocalPostgresTransaction(async client=>{
        await requireLearningBookAccess(client,actor);
        const row=await readBook(client,actor,id);
        if(row.revoked) fail("SHARE_REVOKED","分享已停止。",403);
        const invitations=row.source==='mine'&&row.creator_id===actor.userId ? await client.query<Row>(`SELECT i.id,i.created_at,i.expires_at,i.redeemed_at,i.revoked_at,s.id subscription_id FROM practice_plan_share_invites i LEFT JOIN practice_plan_subscriptions s ON s.invite_id=i.id WHERE i.source_plan_id=$1 ORDER BY i.created_at DESC`,[id]):{rows:[]};
        return {...bookDto(row,actor),schedules:await schedules(client,actor,id),invitations:invitations.rows.map(i=>({id:i.id,createdAt:iso(i.created_at),expiresAt:iso(i.expires_at),redeemedAt:i.redeemed_at?iso(i.redeemed_at):null,revokedAt:i.revoked_at?iso(i.revoked_at):null,subscriptionId:i.subscription_id}))};
    });
}
async function createSchedule(client:PoolClient,actor:LearningBookActor,bookId:string,scheduledFor:string) {
    await requireLearningBookAccess(client,actor,true);
    const book=await readBook(client,actor,bookId);
    const locked=await client.query<Row>(`SELECT status,current_published_revision_id FROM practice_plans WHERE id=$1 FOR SHARE`,[book.plan_id]);
    if(book.revoked||locked.rows[0].status!=='active') fail("BOOK_UNAVAILABLE","學習本目前無法安排練習。",409);
    if(book.subscription_id) {
        const sub=await client.query<Row>(`SELECT status,current_revision_id FROM practice_plan_subscriptions WHERE id=$1 FOR SHARE`,[book.subscription_id]);
        if(sub.rows[0]?.status!=='active') fail("SHARE_REVOKED","分享已停止。",403);
        book.revision_id=sub.rows[0].current_revision_id;
    } else book.revision_id=locked.rows[0].current_published_revision_id;
    const revision=await client.query<Row>(`SELECT name,check_mode,selection_mode FROM practice_plan_revisions WHERE id=$1 AND status='published'`,[book.revision_id]);
    if(!revision.rows[0]) fail("NO_PUBLISHED_REVISION","請先發布學習本。",409);
    const count=await client.query<Row>(`SELECT count(*)::integer total FROM practice_plan_revision_items WHERE practice_plan_revision_id=$1`,[book.revision_id]);
    if(!count.rows[0].total) fail("DYNAMIC_BOOK_NEEDS_SELECTION","這份舊版篩選設定尚未選定題目，請先編輯並固定題目後發布。",409);
    const id=randomUUID();
    await client.query(`INSERT INTO practice_schedules(id,learner_id,practice_plan_id,practice_plan_subscription_id,practice_plan_revision_id,name,scheduled_for,check_mode,created_by_user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[id,actor.learnerId,book.subscription_id?null:book.plan_id,book.subscription_id,book.revision_id,revision.rows[0].name,scheduledFor,revision.rows[0].check_mode,actor.userId]);
    await client.query(`INSERT INTO practice_schedule_items(id,practice_schedule_id,question_id,question_revision_id,question_part_id,position,reason) SELECT gen_random_uuid(),$1,question_id,question_revision_id,question_part_id,position,reason FROM practice_plan_revision_items WHERE practice_plan_revision_id=$2`,[id,book.revision_id]);
    await audit(client,actor,"schedule_created",book.plan_id,book.subscription_id,{scheduleId:id,revisionId:book.revision_id});
    return (await schedules(client,actor,bookId)).find(s=>s.id===id)!;
}
export async function createLearningBookSchedule(actor:LearningBookActor,body:Record<string,unknown>) {
    const bookId=uuid(body.bookId);const scheduledFor=parseScheduleDate(body.scheduledFor);
    return mutation(actor,"schedule:create",body.idempotencyKey,{bookId,scheduledFor},client=>createSchedule(client,actor,bookId,scheduledFor));
}
export async function updateLearningBookSchedule(actor:LearningBookActor,body:Record<string,unknown>) {
    const id=uuid(body.scheduleId);const version=parseLock(body.lockVersion);
    if(!['cancelled','missed'].includes(String(body.status))) fail("INVALID_STATUS","排程狀態不正確。");
    return mutation(actor,`schedule:${id}`,body.idempotencyKey,body,async client=>{
        await requireLearningBookAccess(client,actor,true);
        const result=await client.query<Row>(`UPDATE practice_schedules SET status=$4,lock_version=lock_version+1,updated_at=CURRENT_TIMESTAMP WHERE id=$1 AND learner_id=$2 AND lock_version=$3 AND status IN ('scheduled','available') AND NOT EXISTS(SELECT 1 FROM practice_sessions session WHERE session.practice_schedule_id=$1) RETURNING practice_plan_id,practice_plan_subscription_id`,[id,actor.learnerId,version,body.status]);
        if(!result.rowCount) fail("SCHEDULE_CHANGED","排程已更新或已開始，請重新載入。",409);
        await audit(client,actor,"schedule_updated",result.rows[0].practice_plan_id,result.rows[0].practice_plan_subscription_id,{scheduleId:id,status:body.status});
        return {id,status:body.status,lockVersion:version+1};
    });
}
export async function forkLearningBook(actor:LearningBookActor,id:string,body:Record<string,unknown>) {
    return mutation(actor,`fork:${id}`,body.idempotencyKey,body,async client=>{
        await requireLearningBookAccess(client,actor,true);
        const source=await readBook(client,actor,id);
        if(source.revoked||source.status==='archived') fail("BOOK_UNAVAILABLE","來源學習本無法建立副本。",409);
        const items=await client.query<Row>(`SELECT * FROM practice_plan_revision_items WHERE practice_plan_revision_id=$1 ORDER BY position`,[source.revision_id]);
        const content:LearningBookContent={name:source.name.slice(0,132)+"（副本）",checkMode:source.check_mode,questions:source.questions,filterSnapshot:source.settings_snapshot};
        const copy=await createBook(client,actor,content,true,items.rows,source.selection_mode==='dynamic'?source.question_limit:undefined);
        await audit(client,actor,"fork",copy.id,null,{sourcePlanId:source.plan_id,sourceRevisionId:source.revision_id});
        return copy;
    });
}
export async function createLearningBookInvite(actor:LearningBookActor,id:string,body:Record<string,unknown>) {
    // Tokens are deliberately excluded from persisted mutation receipts.
    return mutation(actor,`share:create:${id}`,body.idempotencyKey,{},async client=>{
        const plan=await ownPlan(client,actor,id);
        if(plan.status!=='active'||!plan.current_published_revision_id) fail("BOOK_UNAVAILABLE","請先發布學習本再分享。",409);
        const rate=await client.query<Row>(`SELECT count(*)::integer total FROM practice_plan_share_invites WHERE created_by_user_id=$1 AND created_at>CURRENT_TIMESTAMP-interval '1 hour'`,[actor.userId]);
        if(rate.rows[0].total>=LEARNING_BOOK_POLICY.shareInvitesPerHour) fail("SHARE_RATE_LIMIT","分享次數過多，請稍後再試。",429);
        const token=randomBytes(32).toString('base64url');const inviteId=randomUUID();
        const result=await client.query<Row>(`INSERT INTO practice_plan_share_invites(id,source_plan_id,created_by_user_id,token_hash,expires_at) VALUES($1,$2,$3,$4,CURRENT_TIMESTAMP+($5::integer*interval '1 day')) RETURNING created_at,expires_at`,[inviteId,id,actor.userId,hash(token),LEARNING_BOOK_POLICY.shareDays]);
        await audit(client,actor,"share_created",id,null,{inviteId});
        return {invite:{id:inviteId,createdAt:iso(result.rows[0].created_at),expiresAt:iso(result.rows[0].expires_at),redeemedAt:null,revokedAt:null,subscriptionId:null},token:token as string|null,path:`/learning-books/share/${token}` as string|null,tokenAlreadyReturned:false};
    },value=>({...value,token:null,path:null,tokenAlreadyReturned:true}));
}
export async function inspectLearningBookInvite(actor:LearningBookActor,tokenInput:unknown) {
    const token=parseShareToken(tokenInput);
    await consumeShareLookupBudget(actor);
    return withLocalPostgresTransaction(async client=>{
        await requireLearningBookAccess(client,actor);
        const result=await client.query<Row>(`SELECT i.id,i.expires_at,clock_timestamp()>=i.expires_at expired,i.redeemed_at,i.revoked_at,i.redeemed_by_user_id,p.status,r.name,u.display_name FROM practice_plan_share_invites i JOIN practice_plans p ON p.id=i.source_plan_id JOIN practice_plan_revisions r ON r.id=p.current_published_revision_id JOIN users u ON u.id=i.created_by_user_id WHERE i.token_hash=$1`,[hash(token)]);
        const row=result.rows[0];
        if(!row||row.revoked_at||row.status!=='active'||row.expired) fail("SHARE_UNAVAILABLE","分享網址已失效、過期或撤銷。",410);
        if(row.redeemed_at&&row.redeemed_by_user_id!==actor.userId) fail("SHARE_ALREADY_REDEEMED","分享網址已被領取。",410);
        return {name:row.name,sharerName:row.display_name,expiresAt:iso(row.expires_at),redeemed:!!row.redeemed_at};
    });
}
async function consumeShareLookupBudget(actor:LearningBookActor) {
    // Commit failed lookup attempts too; token values are never audit metadata.
    return withLocalPostgresTransaction(async client=>{
        await requireLearningBookAccess(client,actor);
        await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`,[`share-lookup:${actor.userId}`]);
        const rate=await client.query<Row>(`SELECT count(*)::integer total FROM practice_plan_audit_events WHERE actor_user_id=$1 AND event_type='share_lookup' AND created_at>CURRENT_TIMESTAMP-interval '1 hour'`,[actor.userId]);
        if(rate.rows[0].total>=LEARNING_BOOK_POLICY.shareLookupsPerHour) fail("SHARE_RATE_LIMIT","分享查詢次數過多，請稍後再試。",429);
        await audit(client,actor,"share_lookup",null);
    });
}
export async function redeemLearningBookInvite(actor:LearningBookActor,body:Record<string,unknown>) {
    const token=parseShareToken(body.token);
    await consumeShareLookupBudget(actor);
    return mutation(actor,"share:redeem",body.idempotencyKey,{tokenHash:hash(token),learnerId:actor.learnerId},async client=>{
        const source=await client.query<Row>(`SELECT source_plan_id FROM practice_plan_share_invites WHERE token_hash=$1`,[hash(token)]);
        if(!source.rows[0]) fail("SHARE_UNAVAILABLE","分享網址已失效或撤銷。",410);
        const plan=await client.query<Row>(`SELECT * FROM practice_plans WHERE id=$1 FOR SHARE`,[source.rows[0].source_plan_id]);
        await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`,[`subscription:${source.rows[0].source_plan_id}:${actor.learnerId}`]);
        const found=await client.query<Row>(`SELECT *,clock_timestamp()>=expires_at expired FROM practice_plan_share_invites WHERE token_hash=$1 FOR UPDATE`,[hash(token)]);
        const invite=found.rows[0];
        if(!invite||invite.revoked_at) fail("SHARE_UNAVAILABLE","分享網址已失效或撤銷。",410);
        if(invite.redeemed_at) {
            if(invite.redeemed_by_user_id!==actor.userId||invite.redeemed_learner_id!==actor.learnerId) fail("SHARE_ALREADY_REDEEMED","分享網址已被領取。",410);
            const existing=await client.query<Row>(`SELECT id,status FROM practice_plan_subscriptions WHERE invite_id=$1`,[invite.id]);
            if(existing.rows[0]?.status!=='active') fail("SHARE_REVOKED","分享已停止。",410);
            return bookDto(await readBook(client,actor,existing.rows[0].id),actor);
        }
        if(invite.expired) fail("SHARE_EXPIRED","分享網址已過期。",410);
        if(plan.rows[0]?.status!=='active') fail("BOOK_UNAVAILABLE","來源學習本目前無法領取。",410);
        if(plan.rows[0].learner_id===actor.learnerId) fail("SHARE_SAME_LEARNER","這本學習本已屬於這位學習者。",409);
        const duplicate=await client.query<Row>(`SELECT id FROM practice_plan_subscriptions WHERE source_plan_id=$1 AND recipient_learner_id=$2 AND status='active'`,[invite.source_plan_id,actor.learnerId]);
        if(duplicate.rowCount) fail("SHARE_ALREADY_SUBSCRIBED","這位學習者已領取相同學習本。",409);
        await client.query(`UPDATE practice_plan_share_invites SET redeemed_by_user_id=$2,redeemed_learner_id=$3,redeemed_at=CURRENT_TIMESTAMP WHERE id=$1`,[invite.id,actor.userId,actor.learnerId]);
        const id=randomUUID();
        await client.query(`INSERT INTO practice_plan_subscriptions(id,source_plan_id,recipient_learner_id,shared_by_user_id,invite_id,current_revision_id,sync_mode,status,accepted_by_user_id) VALUES($1,$2,$3,$4,$5,$6,'auto','active',$7)`,[id,invite.source_plan_id,actor.learnerId,invite.created_by_user_id,invite.id,plan.rows[0].current_published_revision_id,actor.userId]);
        await audit(client,actor,"share_redeemed",invite.source_plan_id,id,{inviteId:invite.id});
        await notify(client,actor.learnerId,"share_received",invite.source_plan_id,id,plan.rows[0].current_published_revision_id);
        return bookDto(await readBook(client,actor,id),actor);
    });
}
export async function revokeLearningBookShare(actor:LearningBookActor,id:string,body:Record<string,unknown>) {
    return mutation(actor,`share:revoke:${id}`,body.idempotencyKey,body,async client=>{
        await ownPlan(client,actor,id);
        const inviteId=body.inviteId?uuid(body.inviteId):null;const subscriptionId=body.subscriptionId?uuid(body.subscriptionId):null;
        if(!inviteId&&!subscriptionId) fail("INVALID_SHARE","請選擇要撤銷的分享。");
        const invites=await client.query<Row>(`UPDATE practice_plan_share_invites SET revoked_at=COALESCE(revoked_at,CURRENT_TIMESTAMP) WHERE source_plan_id=$1 AND ($2::uuid IS NULL OR id=$2) AND ($3::uuid IS NULL OR id=(SELECT invite_id FROM practice_plan_subscriptions WHERE id=$3 AND source_plan_id=$1)) RETURNING id`,[id,inviteId,subscriptionId]);
        if(!invites.rowCount) fail("SHARE_NOT_FOUND","找不到這筆分享。",404);
        const subs=await client.query<Row>(`UPDATE practice_plan_subscriptions SET status='revoked',revoked_at=COALESCE(revoked_at,CURRENT_TIMESTAMP) WHERE source_plan_id=$1 AND invite_id=ANY($2::uuid[]) AND status='active' RETURNING id,recipient_learner_id,current_revision_id`,[id,invites.rows.map(i=>i.id)]);
        for(const sub of subs.rows) await notify(client,sub.recipient_learner_id,"share_revoked",id,sub.id,sub.current_revision_id);
        await audit(client,actor,"share_revoked",id,subscriptionId,{inviteIds:invites.rows.map(i=>i.id)});
        return {revoked:true};
    });
}
export async function learningBookNotifications(actor:LearningBookActor,markIds?:string[]) {
    return withLocalPostgresTransaction(async client=>{
        await requireLearningBookAccess(client,actor);
        if(markIds) await client.query(`UPDATE practice_plan_notifications SET read_at=COALESCE(read_at,CURRENT_TIMESTAMP) WHERE user_id=$1 AND (learner_id=$2 OR learner_id IS NULL) AND id=ANY($3::uuid[])`,[actor.userId,actor.learnerId,markIds]);
        const result=await client.query<Row>(`SELECT * FROM practice_plan_notifications WHERE user_id=$1 AND (learner_id=$2 OR learner_id IS NULL) ORDER BY created_at DESC,id LIMIT 100`,[actor.userId,actor.learnerId]);
        return {notifications:result.rows.map(row=>({id:row.id,kind:row.kind,planId:row.practice_plan_id,subscriptionId:row.subscription_id,revisionId:row.revision_id,createdAt:iso(row.created_at),readAt:row.read_at?iso(row.read_at):null}))};
    });
}
export async function migrateLearningBooks(actor:LearningBookActor,body:Record<string,unknown>) {
    const migrationId=typeof body.migrationId==='string'?body.migrationId:fail("INVALID_MIGRATION","請提供搬移識別碼。");
    if(!Array.isArray(body.books)||body.books.length>200) fail("INVALID_MIGRATION","搬移資料格式不正確。");
    return mutation(actor,`migrate:${actor.learnerId}`,migrationId,body,async client=>{
        await requireLearningBookAccess(client,actor,true);
        const unresolvedItems:unknown[]=Array.isArray(body.unresolvedItems)?[...body.unresolvedItems]:[];
        const bookIds:string[]=[];let importedSchedules=0;
        for(const [index,entry] of (body.books as unknown[]).entries()) {
            await client.query('SAVEPOINT learning_book_migration_item');
            try {
                if(!record(entry)) throw new LearningBookError("INVALID_MIGRATION","學習本資料無效。");
                let content:LearningBookContent;let dynamicLimit:number|undefined;
                if(Array.isArray(entry.questions)&&entry.questions.length===0) {
                    const limit=Number(entry.questionLimit??(record(entry.filterSnapshot)?entry.filterSnapshot.questionLimit:undefined));
                    if(!Number.isSafeInteger(limit)||limit<1||limit>500) fail("INVALID_MIGRATION","舊學習本題數無效。");
                    content={...parseLearningBookSettings(entry),questions:[]};dynamicLimit=limit;
                } else content=parseContent(entry);
                const book=await createBook(client,actor,content,true,dynamicLimit?[]:undefined,dynamicLimit);
                const importedIds:string[]=[];
                if(Array.isArray(entry.schedules)) for(const schedule of entry.schedules) {
                    if(!record(schedule)) fail("INVALID_MIGRATION","舊排程資料無效。");
                    if(schedule.result) fail("HISTORICAL_RESULT_UNVERIFIED","舊排程成績尚未對應正式作答紀錄，保留待處理。");
                    const created=await createSchedule(client,actor,book.id,parseScheduleDate(schedule.scheduledFor));
                    importedIds.push(created.id);
                }
                bookIds.push(book.id);importedSchedules+=importedIds.length;
                await client.query('RELEASE SAVEPOINT learning_book_migration_item');
            } catch(error) {
                await client.query('ROLLBACK TO SAVEPOINT learning_book_migration_item');
                await client.query('RELEASE SAVEPOINT learning_book_migration_item');
                if(!(error instanceof LearningBookError)) throw error;
                unresolvedItems.push({index,legacyId:record(entry)?entry.legacyId:null,code:error.code,message:error.message});
            }
        }
        await audit(client,actor,"local_storage_migrated",null,null,{migrationId,importedBooks:bookIds.length,importedSchedules,unresolvedCount:unresolvedItems.length});
        return {migrationId,importedBooks:bookIds.length,importedSchedules,bookIds,unresolvedItems};
    });
}
