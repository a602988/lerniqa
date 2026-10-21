import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const ROOT = new URL("../", import.meta.url);

async function read(path) {
    return readFile(new URL(path, ROOT), "utf8");
}

test("root layout provides one shared navigation feedback boundary", async () => {
    const layout = await read("app/layout.tsx");
    const feedback = await read("app/components/navigation-feedback.tsx");
    const styles = await read("app/globals.css");

    assert.match(layout, /NavigationFeedbackProvider/);
    assert.match(feedback, /aria-live="polite"/);
    assert.match(feedback, /data-navigation-pending/);
    assert.match(styles, /prefers-reduced-motion: reduce/);
});

test("page and workspace changes use the shared motion contract", async () => {
    const template = await read("app/template.tsx");
    const home = await read("app/page.tsx");
    const styles = await read("app/globals.css");

    assert.match(template, /app-page-transition/);
    assert.match(home, /workspace-section-transition/);
    assert.match(styles, /@keyframes app-page-enter/);
    assert.match(styles, /@keyframes workspace-section-enter/);
    assert.match(styles, /prefers-reduced-motion: reduce/);
});

test("programmatic navigation starts feedback through the shared router hook", async () => {
    const feedback = await read("app/components/navigation-feedback.tsx");
    const home = await read("app/page.tsx");
    const questionImport = await read("app/questions/new/question-import-workspace.tsx");

    assert.match(feedback, /export function useAppRouter/);
    assert.match(home, /useAppRouter/);
    assert.match(questionImport, /useAppRouter/);
});
