"use client";

import { Camera, ClipboardPaste, Cloud, Upload } from "lucide-react";
import { useEffect, useId, useState } from "react";
import type { ChangeEvent, ClipboardEvent as ReactClipboardEvent } from "react";
import { createClipboardFile, fileMatchesAccept, selectFilesForAccept } from "@/app/lib/file-source-selection";
import styles from "./question-import.module.css";

type DriveConfig = {
    enabled: boolean;
    clientId: string;
    apiKey: string;
    appId: string;
};

type FileSourcePickerProps = {
    accept: string;
    camera?: boolean;
    cameraLabel?: string;
    disabled?: boolean;
    driveMimeTypes: string[];
    multiple?: boolean;
    onError?: (message: string) => void;
    onFiles: (files: File[]) => Promise<void> | void;
    systemLabel: string;
};

const SCRIPT_PROMISES = new Map<string, Promise<void>>();
let cachedDriveAccessToken = "";
let driveConfigPromise: Promise<DriveConfig> | null = null;

function loadScript(id: string, source: string): Promise<void> {
    const existing = SCRIPT_PROMISES.get(id);
    if (existing) return existing;
    const promise = new Promise<void>((resolve, reject) => {
        const loaded = document.getElementById(id);
        if (loaded) {
            resolve();
            return;
        }
        const script = document.createElement("script");
        script.id = id;
        script.src = source;
        script.async = true;
        script.defer = true;
        script.addEventListener("load", () => resolve(), { once: true });
        script.addEventListener("error", () => reject(new Error("Google 雲端硬碟元件載入失敗。")), { once: true });
        document.head.append(script);
    });
    SCRIPT_PROMISES.set(id, promise);
    return promise;
}

async function readDriveConfig(): Promise<DriveConfig> {
    const response = await fetch("/api/v1/question-imports/google-drive/config", { cache: "no-store" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error?.message ?? "無法讀取 Google 雲端硬碟設定。");
    return body.data;
}

function getDriveConfig(): Promise<DriveConfig> {
    driveConfigPromise ??= readDriveConfig().catch((error) => {
        driveConfigPromise = null;
        throw error;
    });
    return driveConfigPromise;
}

function requestDriveToken(clientId: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const oauth = window.google?.accounts.oauth2;
        if (!oauth) {
            reject(new Error("Google 授權元件尚未載入。"));
            return;
        }
        const client = oauth.initTokenClient({
            client_id: clientId,
            scope: "https://www.googleapis.com/auth/drive.file",
            callback(response) {
                if (response.error || !response.access_token) {
                    reject(new Error("Google 雲端硬碟授權未完成。"));
                    return;
                }
                cachedDriveAccessToken = response.access_token;
                resolve(response.access_token);
            },
            error_callback() {
                reject(new Error("Google 雲端硬碟授權視窗無法開啟。"));
            },
        });
        client.requestAccessToken({ prompt: cachedDriveAccessToken ? "" : "consent" });
    });
}

function loadPickerApi(): Promise<void> {
    return new Promise((resolve, reject) => {
        if (!window.gapi) {
            reject(new Error("Google Picker 尚未載入。"));
            return;
        }
        window.gapi.load("picker", resolve);
    });
}

function pickDriveFiles(config: DriveConfig, accessToken: string, mimeTypes: string[], multiple: boolean): Promise<GooglePickerDocument[]> {
    return new Promise((resolve, reject) => {
        const picker = window.google?.picker;
        if (!picker) {
            reject(new Error("Google Picker 尚未載入。"));
            return;
        }
        const view = new picker.DocsView()
            .setIncludeFolders(false)
            .setSelectFolderEnabled(false)
            .setMode(picker.DocsViewMode.LIST)
            .setMimeTypes(mimeTypes.join(","));
        let builder = new picker.PickerBuilder()
            .addView(view)
            .setAppId(config.appId)
            .setDeveloperKey(config.apiKey)
            .setOAuthToken(accessToken)
            .setOrigin(window.location.origin)
            .setCallback((response) => {
                if (response.action === picker.Action.PICKED) resolve(response.docs ?? []);
                if (response.action === picker.Action.CANCEL) resolve([]);
            });
        if (multiple) builder = builder.enableFeature(picker.Feature.MULTISELECT_ENABLED);
        builder.build().setVisible(true);
    });
}

async function downloadDriveFile(document: GooglePickerDocument, accessToken: string): Promise<File> {
    const response = await fetch("/api/v1/question-imports/google-drive/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileId: document.id, accessToken }),
    });
    if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error?.message ?? `無法下載「${document.name}」。`);
    }
    const encodedName = response.headers.get("X-Lerniqa-File-Name");
    const name = encodedName ? decodeURIComponent(encodedName) : document.name;
    return new File([await response.blob()], name, { type: response.headers.get("Content-Type") ?? document.mimeType });
}

export function FileSourcePicker({
    accept,
    camera = false,
    cameraLabel = "拍照",
    disabled = false,
    driveMimeTypes,
    multiple = false,
    onError,
    onFiles,
    systemLabel,
}: FileSourcePickerProps) {
    const systemInputId = useId();
    const cameraInputId = useId();
    const [clipboardBusy, setClipboardBusy] = useState(false);
    const [pasteInstruction, setPasteInstruction] = useState(false);
    const [driveBusy, setDriveBusy] = useState(false);
    const [driveEnabled, setDriveEnabled] = useState(false);

    useEffect(() => {
        let active = true;
        void getDriveConfig()
            .then((config) => {
                if (active) setDriveEnabled(config.enabled);
            })
            .catch(() => {
                if (active) setDriveEnabled(false);
            });
        return () => {
            active = false;
        };
    }, []);

    async function submitFiles(files: File[]) {
        const selection = selectFilesForAccept(files, accept, multiple);
        if (selection.kind === "empty") return;
        if (selection.kind === "too_many") {
            onError?.("此處一次只能選擇一個檔案。");
            return;
        }
        if (selection.kind === "unsupported") {
            onError?.("選取的檔案格式不支援，請改用此處允許的格式。");
            return;
        }
        setPasteInstruction(false);
        try {
            await onFiles(selection.files);
        }
        catch (error) {
            onError?.(error instanceof Error ? error.message : "檔案處理失敗。");
        }
    }

    async function selectFiles(event: ChangeEvent<HTMLInputElement>) {
        const files = [...(event.target.files ?? [])];
        event.target.value = "";
        await submitFiles(files);
    }

    async function pasteFiles(event: ReactClipboardEvent<HTMLDivElement>) {
        if (disabled) return;
        const files = [...event.clipboardData.files];
        if (!files.length) return;
        event.preventDefault();
        await submitFiles(files);
    }

    async function readClipboard() {
        setClipboardBusy(true);
        setPasteInstruction(false);
        try {
            if (!navigator.clipboard?.read) throw new Error("CLIPBOARD_READ_UNAVAILABLE");
            const items = await navigator.clipboard.read();
            const files: File[] = [];
            for (const item of items) {
                const mimeType = item.types.find((type) => fileMatchesAccept({ name: "", type }, accept));
                if (!mimeType) continue;
                const file = createClipboardFile(await item.getType(mimeType), files.length);
                if (file) files.push(file);
            }
            if (!files.length) {
                onError?.("剪貼簿中沒有此處支援的圖片或檔案。");
                return;
            }
            await submitFiles(files);
        }
        catch {
            setPasteInstruction(true);
        }
        finally {
            setClipboardBusy(false);
        }
    }

    async function selectDrive() {
        setDriveBusy(true);
        try {
            const config = await getDriveConfig();
            if (!config.enabled) return;
            await Promise.all([
                loadScript("google-api-script", "https://apis.google.com/js/api.js"),
                loadScript("google-identity-script", "https://accounts.google.com/gsi/client"),
            ]);
            const accessToken = cachedDriveAccessToken || await requestDriveToken(config.clientId);
            await loadPickerApi();
            const documents = await pickDriveFiles(config, accessToken, driveMimeTypes, multiple);
            if (!documents.length) return;
            if (documents.length > 20) throw new Error("每次最多可從 Google 雲端硬碟選擇 20 個檔案。");
            const files = await Promise.all(documents.map((document) => downloadDriveFile(document, accessToken)));
            await submitFiles(files);
        }
        catch (error) {
            if (error instanceof Error && /授權|下載/u.test(error.message)) cachedDriveAccessToken = "";
            onError?.(error instanceof Error ? error.message : "Google 雲端硬碟檔案選取失敗。");
        }
        finally {
            setDriveBusy(false);
        }
    }

    return <div className={styles.fileSourcePicker} role="group" aria-label="檔案來源" onPaste={(event) => void pasteFiles(event)}>
        <label className={styles.sourceButton} htmlFor={systemInputId} aria-disabled={disabled}>
            <Upload />{systemLabel}
            <input
                id={systemInputId}
                type="file"
                accept={accept}
                disabled={disabled}
                multiple={multiple}
                onChange={(event) => void selectFiles(event)}
            />
        </label>
        {camera && <label className={styles.sourceButton} htmlFor={cameraInputId} aria-disabled={disabled}>
            <Camera />{cameraLabel}
            <input
                id={cameraInputId}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                capture="environment"
                disabled={disabled}
                onChange={(event) => void selectFiles(event)}
            />
        </label>}
        <button className={styles.sourceButton} type="button" disabled={disabled || clipboardBusy} onClick={() => void readClipboard()}>
            <ClipboardPaste />{clipboardBusy ? "正在讀取…" : "貼上"}
        </button>
        {driveEnabled && <button className={styles.sourceButton} type="button" disabled={disabled || driveBusy} onClick={() => void selectDrive()}>
            <Cloud />{driveBusy ? "正在連線…" : "Google Drive（網頁）"}
        </button>}
        {pasteInstruction && <span className={styles.pasteInstruction} role="status">
            瀏覽器無法直接讀取剪貼簿；請按 Ctrl+V 或 ⌘V，或從裝置選擇檔案。
        </span>}
    </div>;
}
