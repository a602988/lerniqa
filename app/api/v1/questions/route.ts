import { NextResponse } from "next/server";
import { readDatabase } from "@/app/lib/mock-store";
import { getQuestionSourceCategory } from "@/app/lib/question-filters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 依固定欄位與來源文件動態欄位查詢 JSON 題庫。 */
export async function GET(request: Request) {
    try {
        const url = new URL(request.url);
        const filters = {
            grade: url.searchParams.get("grade"),
            subject: url.searchParams.get("subject"),
            version: url.searchParams.get("version"),
            chapter: url.searchParams.get("chapter"),
            unit: url.searchParams.get("unit"),
            topic: url.searchParams.get("topic"),
            difficulty: url.searchParams.get("difficulty"),
            source: url.searchParams.get("source"),
            code: url.searchParams.get("code"),
        };
        const metadataFilters = [...url.searchParams.keys()]
            .filter((key) => key.startsWith("meta."))
            .map((key) => [key.slice(5), url.searchParams.getAll(key).flatMap((value) => value.split(",")).filter(Boolean)] as const)
            .filter(([key, values]) => /^[a-z][a-z0-9_]{0,79}$/.test(key) && values.length);
        const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 20));
        const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
        const database = await readDatabase();
        const filtered = database.questions.filter((question) => (!filters.grade || question.grade === filters.grade)
            && (!filters.subject || question.subject === filters.subject)
            && (!filters.version || question.bookVersion === filters.version)
            && (!filters.chapter || question.chapter === filters.chapter)
            && (!filters.unit || question.unit === filters.unit)
            && (!filters.topic || question.topic === filters.topic)
            && (!filters.difficulty || question.difficulty === filters.difficulty)
            && (!filters.source || getQuestionSourceCategory(question) === filters.source)
            && (!filters.code || question.code === filters.code)
            && metadataFilters.every(([key, values]) => question.metadata?.some((field) => field.key === key
                && field.values.some((value) => values.includes(value)))));
        const facets = [...database.questions.reduce((catalog, question) => {
            question.metadata?.forEach((field) => {
                const current = catalog.get(field.key) ?? { key: field.key, label: field.label, values: new Set<string>() };
                field.values.forEach((value) => current.values.add(value));
                catalog.set(field.key, current);
            });
            return catalog;
        }, new Map<string, { key: string; label: string; values: Set<string> }>()).values()]
            .map((facet) => ({ ...facet, values: [...facet.values].sort((left, right) => left.localeCompare(right, "zh-Hant")) }));
        const start = (page - 1) * limit;
        return NextResponse.json({
            data: filtered.slice(start, start + limit),
            meta: { mock: true, persistence: "runtime-json", page, limit, total: filtered.length, facets },
        });
    }
    catch {
        return NextResponse.json({ error: { code: "QUESTION_READ_FAILED", message: "目前無法讀取模擬題庫。" } }, { status: 500 });
    }
}
