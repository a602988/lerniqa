import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
    buildPagePlan,
    buildSettingsChecksum,
    digestUuid,
    validateTeachingSourceConfig,
} from '../scripts/lib/teaching-source-parser.mjs'
import config from '../data/teaching-sources/hanlin-115-junior-high-1-chinese-volume-1-lesson-4.json' with { type: 'json' }

test('教材來源設定保留原始科目名稱並對應正式科目', () => {
    const validated = validateTeachingSourceConfig(structuredClone(config))
    assert.equal(validated.catalog.sourceSubjectName, '國文')
    assert.equal(validated.catalog.canonicalSubjectName, '國語')
    assert.equal(validated.rights.studentPageAccess, false)
})

test('第四課頁面計畫固定產生 22 個 PDF 與印刷頁碼對照', () => {
    const validated = validateTeachingSourceConfig(structuredClone(config))
    const pages = buildPagePlan(validated)
    assert.equal(pages.length, 22)
    assert.deepEqual(pages[0], {
        pdfPageNumber: 95,
        printedPageNumber: 93,
        curriculumUnitId: config.catalog.curriculumUnitId,
    })
    assert.equal(pages.at(-1).pdfPageNumber, 116)
    assert.equal(pages.at(-1).printedPageNumber, 114)
})

test('來源設定 checksum 與衍生 UUID 可重跑且對設定變更敏感', () => {
    const original = validateTeachingSourceConfig(structuredClone(config))
    const changed = structuredClone(original)
    changed.parser.renderDpi = 151
    const originalChecksum = buildSettingsChecksum(original)
    assert.equal(buildSettingsChecksum(original), originalChecksum)
    assert.notEqual(buildSettingsChecksum(changed), originalChecksum)
    assert.equal(digestUuid(originalChecksum), digestUuid(originalChecksum))
})

test('學生頁面權利未核准時拒絕把設定改為可讀', () => {
    const changed = structuredClone(config)
    changed.rights.studentPageAccess = true
    assert.throws(
        () => validateTeachingSourceConfig(changed),
        /TEACHING_SOURCE_STUDENT_ACCESS_NOT_APPROVED/,
    )
})
