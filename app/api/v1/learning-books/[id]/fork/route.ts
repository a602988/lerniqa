import { forkLearningBook } from "@/app/lib/learning-book-store";
import { uuid } from "@/app/lib/learning-book-contract";
import { actor,body,execute,json,requireSameOrigin } from "../../_shared";
export const runtime="nodejs";
export function POST(request:Request,context:{params:Promise<{id:string}>}) {return execute(async()=>{requireSameOrigin(request);const input=await body(request);return json(await forkLearningBook(await actor(request,input.learnerId),uuid((await context.params).id),input),201);});}
