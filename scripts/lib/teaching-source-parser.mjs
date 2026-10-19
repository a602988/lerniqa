import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SHA256_PATTERN = /^[0-9a-f]{64}$/

/**
 * 以固定鍵序列化資料，供 checksum 與 checkpoint 身分使用。
 *
 * @param {unknown} value 要序列化的資料。
 * @returns {string} 鍵序固定的 JSON 字串。
 */
export function stableJson(value)
{
    if (Array.isArray(value)) {
        return `[${value.map(stableJson).join(',')}]`
    }

    if (value && typeof value === 'object') {
        const entries = Object.entries(value)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
        return `{${entries.join(',')}}`
    }

    return JSON.stringify(value)
}

/**
 * 計算字串的 SHA-256。
 *
 * @param {string} value 輸入字串。
 * @returns {string} 小寫十六進位 SHA-256。
 */
export function sha256(value)
{
    return createHash('sha256').update(value).digest('hex')
}

/**
 * 從既有 digest 產生穩定 UUID，避免重跑建立另一批資料。
 *
 * @param {string} digest 至少 32 個十六進位字元的 digest。
 * @returns {string} 固定的 UUID v5 格式字串。
 */
export function digestUuid(digest)
{
    if (!/^[0-9a-f]{32,}$/i.test(digest)) {
        throw new Error('DIGEST_UUID_INPUT_INVALID')
    }
    const value = digest.slice(0, 32).toLowerCase().split('')
    value[12] = '5'
    value[16] = ['8', '9', 'a', 'b'][Number.parseInt(value[16], 16) % 4]
    const compact = value.join('')
    return [
        compact.slice(0, 8),
        compact.slice(8, 12),
        compact.slice(12, 16),
        compact.slice(16, 20),
        compact.slice(20),
    ].join('-')
}

/**
 * 驗證來源設定能完整指出唯一教材範圍與解析方法。
 *
 * @param {unknown} value 從 JSON 載入的設定。
 * @returns {Record<string, any>} 驗證後的設定。
 */
export function validateTeachingSourceConfig(value)
{
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('TEACHING_SOURCE_CONFIG_INVALID')
    }
    const config = /** @type {Record<string, any>} */ (value)
    const requiredUuidValues = [
        config.sourceDocumentId,
        config.catalog?.gradeId,
        config.catalog?.subjectId,
        config.catalog?.semesterId,
        config.catalog?.publisherId,
        config.catalog?.bookVersionId,
        config.catalog?.volumeUnitId,
        config.catalog?.curriculumUnitId,
    ]
    if (config.schemaVersion !== 1 || requiredUuidValues.some(value => !UUID_PATTERN.test(value))) {
        throw new Error('TEACHING_SOURCE_CONFIG_IDENTITY_INVALID')
    }
    if (
        typeof config.sourceFileName !== 'string'
        || config.sourceFileName.trim() !== config.sourceFileName
        || config.sourceFileName.includes('/')
        || config.sourceFileName.includes('\\')
        || !config.sourceFileName.toLowerCase().endsWith('.pdf')
        || !SHA256_PATTERN.test(config.sourceSha256)
        || !Number.isSafeInteger(config.sourceByteSize)
        || config.sourceByteSize <= 0
        || !Number.isSafeInteger(config.sourceTotalPages)
        || config.sourceTotalPages <= 0
    ) {
        throw new Error('TEACHING_SOURCE_CONFIG_FILE_INVALID')
    }
    if (
        !Number.isInteger(config.catalog?.academicYear)
        || config.catalog.academicYear < 1
        || config.catalog.academicYear > 999
        || !config.catalog.sourceSubjectName
        || !config.catalog.canonicalSubjectName
    ) {
        throw new Error('TEACHING_SOURCE_CONFIG_CATALOG_INVALID')
    }
    if (
        !Number.isInteger(config.pages?.pdfStart)
        || !Number.isInteger(config.pages?.pdfEnd)
        || !Number.isInteger(config.pages?.printedOffset)
        || config.pages.pdfStart < 1
        || config.pages.pdfEnd < config.pages.pdfStart
        || config.pages.pdfEnd > config.sourceTotalPages
        || config.pages.pdfStart + config.pages.printedOffset < 1
    ) {
        throw new Error('TEACHING_SOURCE_CONFIG_PAGES_INVALID')
    }
    if (
        config.parser?.version !== 'teaching-source-ocr/v1'
        || config.parser?.renderDpi !== 150
        || config.parser?.ocrEngine !== 'PaddleOCR'
        || config.parser?.pageFormat !== 'webp-lossless'
        || typeof config.parser?.ocrVersion !== 'string'
        || typeof config.parser?.detectionModel !== 'string'
        || typeof config.parser?.recognitionModel !== 'string'
    ) {
        throw new Error('TEACHING_SOURCE_CONFIG_PARSER_INVALID')
    }
    if (config.rights?.studentPageAccess !== false) {
        throw new Error('TEACHING_SOURCE_STUDENT_ACCESS_NOT_APPROVED')
    }
    return config
}

/**
 * 讀取並驗證教材來源設定。
 *
 * @param {string} path JSON 設定檔路徑。
 * @returns {Promise<Record<string, any>>} 驗證後的設定。
 */
export async function readTeachingSourceConfig(path)
{
    const content = await readFile(path, 'utf8')
    return validateTeachingSourceConfig(JSON.parse(content))
}

/**
 * 依設定建立連續且可驗證的 PDF／印刷頁碼對照。
 *
 * @param {Record<string, any>} config 已驗證設定。
 * @returns {Array<{pdfPageNumber: number, printedPageNumber: number, curriculumUnitId: string}>} 頁面計畫。
 */
export function buildPagePlan(config)
{
    const pages = []
    for (let page = config.pages.pdfStart; page <= config.pages.pdfEnd; page += 1) {
        pages.push({
            pdfPageNumber: page,
            printedPageNumber: page + config.pages.printedOffset,
            curriculumUnitId: config.catalog.curriculumUnitId,
        })
    }
    return pages
}

/**
 * 建立只受來源與解析設定影響的 checkpoint checksum。
 *
 * @param {Record<string, any>} config 已驗證設定。
 * @returns {string} 設定 SHA-256。
 */
export function buildSettingsChecksum(config)
{
    const settings = {
        sourceSha256: config.sourceSha256,
        pages: config.pages,
        parser: config.parser,
        catalog: config.catalog,
    }
    return sha256(stableJson(settings))
}
