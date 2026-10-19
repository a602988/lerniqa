#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createReadStream } from 'node:fs'
import { mkdir, open, readFile, rename, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import {
    buildPagePlan,
    buildSettingsChecksum,
    digestUuid,
    readTeachingSourceConfig,
    sha256,
    stableJson,
} from './lib/teaching-source-parser.mjs'

const ROOT = path.resolve(import.meta.dirname, '..')
const DEFAULT_CONFIG = path.join(
    ROOT,
    'data/teaching-sources/hanlin-115-junior-high-1-chinese-volume-1-lesson-4.json',
)

/**
 * 解析 CLI 參數，拒絕未定義的隱性 fallback。
 *
 * @param {string[]} argumentsValue 程序參數。
 * @returns {{command: string, configPath: string, pdfPath?: string, outputPath?: string}} 已解析參數。
 */
function parseArguments(argumentsValue)
{
    const values = [...argumentsValue]
    const command = values.shift()
    if (!['inspect', 'apply'].includes(command)) {
        throw new Error('USAGE: import-teaching-source.mjs <inspect|apply> [--config path] [--pdf path] [--output path]')
    }
    const options = { command, configPath: DEFAULT_CONFIG }
    while (values.length > 0) {
        const key = values.shift()
        const value = values.shift()
        if (!value || !['--config', '--pdf', '--output'].includes(key)) {
            throw new Error(`TEACHING_SOURCE_ARGUMENT_INVALID:${key ?? ''}`)
        }
        if (key === '--config') options.configPath = path.resolve(value)
        if (key === '--pdf') options.pdfPath = path.resolve(value)
        if (key === '--output') options.outputPath = path.resolve(value)
    }
    return options
}

/**
 * 以串流方式計算檔案 SHA-256。
 *
 * @param {string} filePath 檔案路徑。
 * @returns {Promise<string>} 小寫十六進位 SHA-256。
 */
async function checksumFile(filePath)
{
    const digest = createHash('sha256')
    for await (const chunk of createReadStream(filePath)) {
        digest.update(chunk)
    }
    return digest.digest('hex')
}

/**
 * 執行必要的本機工具並保留可讀輸出。
 *
 * @param {string} command 指令名稱或路徑。
 * @param {string[]} argumentsValue 指令參數。
 * @param {{capture?: boolean}} options 執行選項。
 * @returns {Promise<string>} capture 模式的 stdout。
 */
async function runCommand(command, argumentsValue, options = {})
{
    return new Promise((resolve, reject) => {
        const child = spawn(command, argumentsValue, {
            cwd: ROOT,
            stdio: options.capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
        })
        let output = ''
        child.stdout?.on('data', chunk => {
            output += chunk.toString()
        })
        child.on('error', reject)
        child.on('exit', code => {
            if (code === 0) {
                resolve(output)
                return
            }
            reject(new Error(`COMMAND_FAILED:${command}:${code}`))
        })
    })
}

/**
 * 以原子替換保存 JSON，避免中斷留下半份 manifest。
 *
 * @param {string} destination 目標路徑。
 * @param {unknown} value 可序列化資料。
 * @returns {Promise<void>} 無。
 */
async function writeJsonAtomic(destination, value)
{
    const temporaryPath = `${destination}.part`
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
    await rename(temporaryPath, destination)
}

/**
 * 驗證實體 PDF 與受版本管理設定完全一致。
 *
 * @param {string} pdfPath PDF 路徑。
 * @param {Record<string, any>} config 來源設定。
 * @returns {Promise<{sha256: string, byteSize: number, totalPages: number}>} 已驗證 metadata。
 */
async function inspectSource(pdfPath, config)
{
    const fileStat = await stat(pdfPath)
    if (!fileStat.isFile() || fileStat.size !== config.sourceByteSize) {
        throw new Error('TEACHING_SOURCE_SIZE_MISMATCH')
    }
    const file = await open(pdfPath, 'r')
    const headerBuffer = Buffer.alloc(5)
    try {
        await file.read(headerBuffer, 0, headerBuffer.length, 0)
    }
    finally {
        await file.close()
    }
    const header = headerBuffer.toString('ascii')
    if (header !== '%PDF-') {
        throw new Error('TEACHING_SOURCE_MIME_MISMATCH')
    }
    const sourceChecksum = await checksumFile(pdfPath)
    if (sourceChecksum !== config.sourceSha256) {
        throw new Error('TEACHING_SOURCE_CHECKSUM_MISMATCH')
    }
    const pdfInfo = await runCommand('pdfinfo', [pdfPath], { capture: true })
    const totalPages = Number.parseInt(pdfInfo.match(/^Pages:\s+(\d+)$/m)?.[1] ?? '', 10)
    if (totalPages !== config.sourceTotalPages) {
        throw new Error('TEACHING_SOURCE_PAGE_COUNT_MISMATCH')
    }
    return { sha256: sourceChecksum, byteSize: fileStat.size, totalPages }
}

/**
 * 執行可續跑 OCR，並把頁面影像轉成固定 lossless WebP。
 *
 * @param {string} pdfPath PDF 路徑。
 * @param {Record<string, any>} config 來源設定。
 * @param {string} outputPath 本次來源的工作目錄。
 * @param {string} settingsChecksum 解析設定 checksum。
 * @param {Record<string, any> | null} existingManifest 前次完整 manifest。
 * @returns {Promise<Record<string, any>>} OCR 報告。
 */
async function buildOcrPages(pdfPath, config, outputPath, settingsChecksum, existingManifest)
{
    const pagePlan = buildPagePlan(config)
    const pages = pagePlan.map(page => page.pdfPageNumber).join(',')
    const runPath = path.join(outputPath, 'runs', settingsChecksum)
    await mkdir(runPath, { recursive: true })
    const pythonPath = path.join(ROOT, 'local-data/handwriting-python/bin/python')
    const scriptPath = path.join(ROOT, 'scripts/smoke-teaching-source-ocr.py')
    await runCommand(pythonPath, [
        scriptPath,
        '--pdf',
        pdfPath,
        '--pages',
        pages,
        '--printed-offset',
        String(config.pages.printedOffset),
        '--output',
        runPath,
    ])
    const reportPath = path.join(runPath, 'ocr-smoke.json')
    const report = JSON.parse(await readFile(reportPath, 'utf8'))
    if (
        report.status !== 'completed'
        || report.parserVersion !== config.parser.version
        || report.pages.length !== pagePlan.length
    ) {
        throw new Error('TEACHING_SOURCE_OCR_INCOMPLETE')
    }

    const pageAssetPath = path.join(
        ROOT,
        'local-data/assets/source-pages',
        config.sourceDocumentId,
    )
    await mkdir(pageAssetPath, { recursive: true })
    for (const pageReport of report.pages) {
        const sourcePath = path.join(runPath, pageReport.renderedFile)
        const destination = path.join(
            pageAssetPath,
            `pdf-${String(pageReport.pdfPageNumber).padStart(3, '0')}.webp`,
        )
        const storageKey = path.posix.join(
            'source-pages',
            config.sourceDocumentId,
            path.basename(destination),
        )
        const previousPage = existingManifest?.pages?.find(
            page => page.pdfPageNumber === pageReport.pdfPageNumber,
        )
        let asset = previousPage?.asset
        if (
            !asset
            || asset.storageKey !== storageKey
            || asset.mimeType !== 'image/webp'
            || (await stat(destination).catch(() => null))?.size !== asset.byteSize
            || await checksumFile(destination).catch(() => null) !== asset.sha256
        ) {
            await runCommand('cwebp', ['-quiet', '-lossless', '-z', '6', sourcePath, '-o', destination])
            asset = {
                storageKey,
                mimeType: 'image/webp',
                byteSize: (await stat(destination)).size,
                sha256: await checksumFile(destination),
            }
        }
        pageReport.asset = asset
    }
    return report
}

/**
 * 建立不含絕對路徑、可供 apply 前人工核對的 manifest。
 *
 * @param {Record<string, any>} config 來源設定。
 * @param {{sha256: string, byteSize: number, totalPages: number}} source 來源 metadata。
 * @param {Record<string, any>} report OCR 報告。
 * @param {string} settingsChecksum 解析設定 checksum。
 * @param {Record<string, any> | null} existingManifest 前次完整 manifest。
 * @returns {Record<string, any>} 正式 inspect manifest。
 */
function buildManifest(config, source, report, settingsChecksum, existingManifest)
{
    const processingRunId = digestUuid(sha256(`${config.sourceDocumentId}:${settingsChecksum}`))
    const pagePlan = new Map(buildPagePlan(config).map(page => [page.pdfPageNumber, page]))
    return {
        schemaVersion: 1,
        status: 'inspection_complete',
        generatedAt: existingManifest?.processing?.settingsChecksum === settingsChecksum
            ? existingManifest.generatedAt
            : new Date().toISOString(),
        sourceDocumentId: config.sourceDocumentId,
        source: {
            fileName: config.sourceFileName,
            ...source,
        },
        catalog: config.catalog,
        rights: config.rights,
        processing: {
            id: processingRunId,
            settingsChecksum,
            ...config.parser,
            reviewStatus: 'pending',
        },
        pages: report.pages.map(page => ({
            id: digestUuid(sha256(`${config.sourceDocumentId}:page:${page.pdfPageNumber}`)),
            ...pagePlan.get(page.pdfPageNumber),
            width: page.width,
            height: page.height,
            durationMilliseconds: page.durationMilliseconds,
            detectionCount: page.detectionCount,
            averageConfidence: page.averageConfidence,
            lowConfidenceCount: page.lowConfidenceCount,
            asset: page.asset,
            blocks: page.detections.map(detection => ({
                id: digestUuid(sha256(`${processingRunId}:${page.pdfPageNumber}:${detection.position}`)),
                position: detection.position - 1,
                blockType: 'other',
                bounds: detection.bounds,
                rawText: detection.text,
                confidence: detection.confidence,
                reviewStatus: 'pending',
            })),
        })),
    }
}

/**
 * 執行只讀來源與本機工作檔的 inspect 流程。
 *
 * @param {{configPath: string, pdfPath?: string, outputPath?: string}} options CLI 選項。
 * @returns {Promise<void>} 無。
 */
async function inspect(options)
{
    const config = await readTeachingSourceConfig(options.configPath)
    const pdfPath = options.pdfPath ?? path.join(
        ROOT,
        'local-data/source-ingestion/inbox',
        config.sourceFileName,
    )
    const outputPath = options.outputPath ?? path.join(
        ROOT,
        'local-data/source-ingestion',
        config.sourceSha256,
    )
    await mkdir(outputPath, { recursive: true })
    const source = await inspectSource(pdfPath, config)
    const settingsChecksum = buildSettingsChecksum(config)
    const manifestPath = path.join(outputPath, 'manifest.json')
    const existingManifest = await readFile(manifestPath, 'utf8')
        .then(content => JSON.parse(content))
        .catch(() => null)
    const report = await buildOcrPages(
        pdfPath,
        config,
        outputPath,
        settingsChecksum,
        existingManifest,
    )
    const manifest = buildManifest(
        config,
        source,
        report,
        settingsChecksum,
        existingManifest,
    )
    await writeJsonAtomic(manifestPath, manifest)
    const manifestChecksum = sha256(stableJson(manifest))
    process.stdout.write(`${JSON.stringify({
        manifest: path.relative(ROOT, manifestPath),
        manifestChecksum,
        pages: manifest.pages.length,
        blocks: manifest.pages.reduce((total, page) => total + page.blocks.length, 0),
        studentPageAccess: manifest.rights.studentPageAccess,
    })}\n`)
}

/**
 * 啟動 CLI。
 *
 * @returns {Promise<void>} 無。
 */
async function main()
{
    const options = parseArguments(process.argv.slice(2))
    if (options.command === 'apply') {
        throw new Error('TEACHING_SOURCE_APPLY_REQUIRES_REVIEWED_INSPECT_AND_BACKUP')
    }
    await inspect(options)
}

main().catch(error => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
})
