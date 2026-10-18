import { learningBookNotifications } from "@/app/lib/learning-book-store";
import { uuid,LearningBookError } from "@/app/lib/learning-book-contract";
import { actor,body,execute,json,requireSameOrigin } from "../_shared";
export const runtime="nodejs";
export function GET(request:Request) {return execute(async()=>json(await learningBookNotifications(await actor(request,new URL(request.url).searchParams.get('learnerId')??undefined))));}
export function PATCH(request:Request) {return execute(async()=>{requireSameOrigin(request);const input=await body(request);if(!Array.isArray(input.ids)||input.ids.length>100)throw new LearningBookError('INVALID_NOTIFICATIONS','通知格式不正確。');return json(await learningBookNotifications(await actor(request,input.learnerId),input.ids.map(id=>uuid(id))));});}
