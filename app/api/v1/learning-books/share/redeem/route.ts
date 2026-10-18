import { redeemLearningBookInvite } from "@/app/lib/learning-book-store";
import { actor,body,execute,json,requireSameOrigin } from "../../_shared";
export const runtime="nodejs";
export function POST(request:Request) {return execute(async()=>{requireSameOrigin(request);const input=await body(request);return json(await redeemLearningBookInvite(await actor(request,input.learnerId),input),201);});}
