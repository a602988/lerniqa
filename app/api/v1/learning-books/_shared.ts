import { NextResponse } from "next/server";
import { getAuthenticatedAccount, AuthServiceError } from "@/app/lib/auth-service";
import { LocalPostgresUnavailableError } from "@/app/lib/local-postgres";
import { LearningBookError, record, uuid, type LearningBookActor } from "@/app/lib/learning-book-contract";

export function json(data: unknown, status=200) { return NextResponse.json({data,meta:{persistence:"local-postgresql"}},{status,headers:{"Cache-Control":"private, no-store"}}); }
export async function body(request:Request):Promise<Record<string,unknown>> {
    let value:unknown;
    try { value=await request.json(); } catch { throw new LearningBookError("INVALID_BODY","資料格式不正確。"); }
    if(!record(value)) throw new LearningBookError("INVALID_BODY","資料格式不正確。");
    return value;
}
export async function actor(request:Request,learnerId?:unknown):Promise<LearningBookActor> {
    const account=await getAuthenticatedAccount(request);
    return {userId:account.userId,learnerId:learnerId===undefined?account.learner.id:uuid(learnerId,"學習者識別碼"),role:account.activeRole};
}
export async function execute(fn:()=>Promise<Response>) {
    try{return await fn();} catch(error) {
        if(error instanceof LearningBookError||error instanceof AuthServiceError) return NextResponse.json({error:{code:error.code,message:error.message}},{status:error.status,headers:{"Cache-Control":"private, no-store"}});
        if(error instanceof LocalPostgresUnavailableError) return NextResponse.json({error:{code:error.code,message:"資料庫目前無法使用，請稍後再試。"}},{status:503});
        console.error("Learning book request failed",error);
        return NextResponse.json({error:{code:"LEARNING_BOOK_FAILED",message:"學習本服務目前無法完成要求。"}},{status:500,headers:{"Cache-Control":"no-store"}});
    }
}
export function requireSameOrigin(request:Request) {
    const origin=request.headers.get("origin");
    if(origin&&origin!==new URL(request.url).origin) throw new LearningBookError("INVALID_ORIGIN","請從原網站進行操作。",403);
    if(request.headers.get("sec-fetch-site")==="cross-site") throw new LearningBookError("INVALID_ORIGIN","請從原網站進行操作。",403);
}
