import { inspectLearningBookInvite } from "@/app/lib/learning-book-store";
import { actor,execute,json } from "../_shared";
export const runtime="nodejs";
export function GET(request:Request) {return execute(async()=>json(await inspectLearningBookInvite(await actor(request),new URL(request.url).searchParams.get('token'))));}
