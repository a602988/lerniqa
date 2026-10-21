interface GoogleIdentityButtonOptions {
    locale: "zh_TW";
    shape: "pill" | "rectangular";
    size: "small" | "large";
    text: "continue_with" | "signin_with" | "signup_with";
    theme: "outline";
    width: number;
}

interface GoogleOAuthTokenResponse {
    access_token?: string;
    error?: string;
}

interface GooglePickerDocument {
    id: string;
    name: string;
    mimeType: string;
}

interface GooglePickerResponse {
    action: string;
    docs?: GooglePickerDocument[];
}

interface GooglePickerBuilder {
    addView(view: GooglePickerDocsView): GooglePickerBuilder;
    build(): { setVisible(visible: boolean): void };
    enableFeature(feature: string): GooglePickerBuilder;
    setAppId(appId: string): GooglePickerBuilder;
    setCallback(callback: (response: GooglePickerResponse) => void): GooglePickerBuilder;
    setDeveloperKey(apiKey: string): GooglePickerBuilder;
    setOAuthToken(token: string): GooglePickerBuilder;
    setOrigin(origin: string): GooglePickerBuilder;
}

interface GooglePickerDocsView {
    setIncludeFolders(include: boolean): GooglePickerDocsView;
    setMimeTypes(mimeTypes: string): GooglePickerDocsView;
    setMode(mode: string): GooglePickerDocsView;
    setSelectFolderEnabled(enabled: boolean): GooglePickerDocsView;
}

interface Window {
    google?: {
        accounts: {
            id: {
                initialize(options: {
                    client_id: string;
                    callback(response: { credential: string }): void;
                }): void;
                renderButton(parent: HTMLElement, options: GoogleIdentityButtonOptions): void;
            };
            oauth2?: {
                initTokenClient(options: {
                    client_id: string;
                    scope: string;
                    callback(response: GoogleOAuthTokenResponse): void;
                    error_callback?(error: unknown): void;
                }): {
                    requestAccessToken(options: { prompt: "" | "consent" }): void;
                };
            };
        };
        picker?: {
            Action: { CANCEL: string; PICKED: string };
            DocsView: new () => GooglePickerDocsView;
            DocsViewMode: { LIST: string };
            Feature: { MULTISELECT_ENABLED: string };
            PickerBuilder: new () => GooglePickerBuilder;
        };
    };
    gapi?: {
        load(name: "picker", callback: () => void): void;
    };
}
