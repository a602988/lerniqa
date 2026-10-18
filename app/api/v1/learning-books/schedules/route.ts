import { listLearningBookSchedules,createLearningBookSchedule,updateLearningBookSchedule } from "@/app/lib/learning-book-store";
import { actor,body,execute,json,requireSameOrigin } from "../_shared";
export const runtime="nodejs";
export function GET(request:Request) {return execute(async()=>json(await listLearningBookSchedules(await actor(request,new URL(request.url).searchParams.get('learnerId')??undefined))));}
export function POST(request:Request) {return execute(async()=>{requireSameOrigin(request);const input=await body(request);return json(await createLearningBookSchedule(await actor(request,input.learnerId),input),201);});}
export function PATCH(request:Request) {return execute(async()=>{requireSameOrigin(request);const input=await body(request);return json(await updateLearningBookSchedule(await actor(request,input.learnerId),input));});}
