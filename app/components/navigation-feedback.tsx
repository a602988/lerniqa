"use client";

import {
    createContext,
    Suspense,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
    useTransition,
    type ReactNode,
} from "react";
import {
    usePathname,
    useRouter,
    useSearchParams,
} from "next/navigation";

type AppRouter = ReturnType<typeof useRouter>;
type NavigationOptions = Parameters<AppRouter["push"]>[1];
type NavigationFeedbackContextValue = {
    complete: () => void;
    run: (operation: () => void) => void;
    start: () => void;
};

const NavigationFeedbackContext = createContext<NavigationFeedbackContextValue | null>(null);

/**
 * 判斷站內連結是否會切換目前頁面。
 *
 * @param anchor 使用者點選的連結。
 * @param event 點擊事件。
 * @returns 需要顯示導覽回饋時回傳 true。
 */
function isPageNavigation(anchor: HTMLAnchorElement, event: MouseEvent): boolean {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
    if (anchor.target && anchor.target !== "_self") return false;
    if (anchor.hasAttribute("download")) return false;

    const destination = new URL(anchor.href, window.location.href);
    if (destination.origin !== window.location.origin) return false;

    const current = new URL(window.location.href);
    return destination.pathname !== current.pathname || destination.search !== current.search;
}

/**
 * 在 URL 確認更新後結束目前的導覽回饋。
 *
 * @param props 導覽完成 callback。
 * @returns 不產生畫面內容。
 */
function NavigationCompletionObserver({ complete }: { complete: () => void }) {
    const pathname = usePathname();
    const searchParams = useSearchParams();

    useEffect(() => {
        complete();
    }, [complete, pathname, searchParams]);

    return null;
}

/**
 * 提供全站共用的導覽進度與輔助技術狀態。
 *
 * @param props 應用程式內容。
 * @returns 導覽回饋 context 與頁首進度條。
 */
export function NavigationFeedbackProvider({ children }: { children: ReactNode }) {
    const [requested, setRequested] = useState(false);
    const [transitionPending, startTransition] = useTransition();
    const transitionStartedRef = useRef(false);
    const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pending = requested || transitionPending;

    const complete = useCallback(() => {
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
        setRequested(false);
    }, []);

    const start = useCallback(() => {
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        setRequested(true);
        timeoutRef.current = setTimeout(complete, 8000);
    }, [complete]);

    const run = useCallback((operation: () => void) => {
        start();
        transitionStartedRef.current = true;
        startTransition(() => {
            try {
                operation();
            }
            catch (error) {
                complete();
                throw error;
            }
        });
    }, [complete, start]);

    useEffect(() => {
        if (transitionPending || !transitionStartedRef.current) return;
        transitionStartedRef.current = false;
        complete();
    }, [complete, transitionPending]);

    useEffect(() => {
        /** 讓 Next Link 與一般站內連結使用相同的等待回饋。 */
        function handleClick(event: MouseEvent) {
            const target = event.target;
            if (!(target instanceof Element)) return;
            const anchor = target.closest("a[href]");
            if (anchor instanceof HTMLAnchorElement && isPageNavigation(anchor, event)) start();
        }

        document.addEventListener("click", handleClick, true);
        return () => document.removeEventListener("click", handleClick, true);
    }, [start]);

    useEffect(() => () => {
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
    }, []);

    const value = useMemo(() => ({ complete, run, start }), [complete, run, start]);

    return (
        <NavigationFeedbackContext.Provider value={value}>
            {children}
            <Suspense fallback={null}>
                <NavigationCompletionObserver complete={complete} />
            </Suspense>
            <div
                className="navigation-feedback"
                data-navigation-pending={pending ? "true" : "false"}
                aria-hidden="true"
            >
                <span />
            </div>
            <span className="sr-only" role="status" aria-live="polite">
                {pending ? "正在開啟頁面" : ""}
            </span>
        </NavigationFeedbackContext.Provider>
    );
}

/**
 * 回傳會自動啟動全站導覽回饋的 Next.js router。
 *
 * @returns 與 Next.js router 相同的導覽操作。
 */
export function useAppRouter(): AppRouter {
    const router = useRouter();
    const feedback = useContext(NavigationFeedbackContext);

    if (!feedback) throw new Error("useAppRouter 必須在 NavigationFeedbackProvider 內使用。");

    return useMemo(() => ({
        back: () => feedback.run(router.back),
        forward: () => feedback.run(router.forward),
        prefetch: router.prefetch,
        push: (href: string, options?: NavigationOptions) => feedback.run(() => router.push(href, options)),
        refresh: () => feedback.run(router.refresh),
        replace: (href: string, options?: NavigationOptions) => feedback.run(() => router.replace(href, options)),
    }), [feedback, router]);
}

