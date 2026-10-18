import { createLearningBookInvite,revokeLearningBookShare } from "@/app/lib/learning-book-store";
import { uuid } from "@/app/lib/learning-book-contract";
import { actor,body,execute,json,requireSameOrigin } from "../../_shared";
export const runtime="nodejs";
type Context={params:Promise<{id:string}>};
export function POST(request:Request,context:Context) {return execute(async()=>{requireSameOrigin(request);const input=await body(request);return json(await createLearningBookInvite(await actor(request,input.learnerId),uuid((await context.params).id),input),201);});}
export function DELETE(request:Request,context:Context) {return execute(async()=>{requireSameOrigin(request);const input=await body(request);return json(await revokeLearningBookShare(await actor(request,input.learnerId),uuid((await context.params).id),input));});}
