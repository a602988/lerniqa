import assert from "node:assert/strict";
import test from "node:test";
import {
    MAX_QUESTION_SOURCE_FILES,
    prepareQuestionSourceUploads,
    QuestionSourceUploadError,
} from "../app/lib/question-source-upload.ts";

const PNG_BYTES = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

test("shared source upload validation accepts ordered files and roles", async () => {
    const form = new FormData();
    form.append("file", new File([PNG_BYTES], "question.png", { type: "image/png" }));
    form.append("role", "question");
    form.append("file", new File([PNG_BYTES], "answer.png", { type: "image/png" }));
    form.append("role", "answer");

    const sources = await prepareQuestionSourceUploads(form);

    assert.deepEqual(sources.map(({ fileName, role }) => ({ fileName, role })), [
        { fileName: "question.png", role: "question" },
        { fileName: "answer.png", role: "answer" },
    ]);
    assert.equal(sources.every(({ source }) => source.mimeType === "image/png"), true);
});

test("shared source upload validation rejects unsupported content and excessive counts", async () => {
    const unsupported = new FormData();
    unsupported.append("file", new File(["plain text"], "question.png", { type: "image/png" }));
    await assert.rejects(
        prepareQuestionSourceUploads(unsupported),
        (error: unknown) => error instanceof QuestionSourceUploadError && error.code === "UNSUPPORTED_SOURCE",
    );

    const excessive = new FormData();
    for (let index = 0; index <= MAX_QUESTION_SOURCE_FILES; index += 1) {
        excessive.append("file", new File([PNG_BYTES], `${index}.png`, { type: "image/png" }));
    }
    await assert.rejects(
        prepareQuestionSourceUploads(excessive),
        (error: unknown) => error instanceof QuestionSourceUploadError && error.code === "INVALID_SOURCE_UPLOAD",
    );
});
