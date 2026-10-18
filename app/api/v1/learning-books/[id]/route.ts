import { getLearningBook,updateLearningBook } from "@/app/lib/learning-book-store";
import { uuid } from "@/app/lib/learning-book-contract";
import { actor,body,execute,json,requireSameOrigin } from "../_shared";
export const runtime="nodejs";
type Context={params:Promise<{id:string}>};
export function GET(request:Request,context:Context) {return execute(async()=>json(await getLearningBook(await actor(request,new URL(request.url).searchParams.get('learnerId')??undefined),uuid((await context.params).id))));}
export function PATCH(request:Request,context:Context) {return execute(async()=>{requireSameOrigin(request);const input=await body(request);return json(await updateLearningBook(await actor(request,input.learnerId),uuid((await context.params).id),input));});}
