import { listLearningBooks,createLearningBook } from "@/app/lib/learning-book-store";
import { parseListQuery } from "@/app/lib/learning-book-contract";
import { actor,body,execute,json,requireSameOrigin } from "./_shared";
export const runtime="nodejs";
export function GET(request:Request) {return execute(async()=>{const params=new URL(request.url).searchParams;return json(await listLearningBooks(await actor(request,params.get('learnerId')??undefined),parseListQuery(params)));});}
export function POST(request:Request) {return execute(async()=>{requireSameOrigin(request);const input=await body(request);return json(await createLearningBook(await actor(request,input.learnerId),input),201);});}
