"use client";

import {
    Drawer,
    DrawerBody,
    DrawerCloseButton,
    DrawerContent,
    DrawerDescription,
    DrawerHeader,
    DrawerTitle,
} from "@keel-design/ui";
import {
    createContext,
    type MouseEvent,
    type ReactNode,
    useCallback,
    useContext,
    useEffect,
    useRef,
} from "react";

import { leavesCurrentDrawerRoute } from "./route-drawer-navigation";
import { useAppRouter } from "../../navigation-feedback";

import styles from "./views.module.css";

type RouteDrawerNavigationGuard = () => boolean;
type RegisterRouteDrawerNavigationGuard = (
    guard: RouteDrawerNavigationGuard,
) => () => void;

const RouteDrawerNavigationGuardContext =
    createContext<RegisterRouteDrawerNavigationGuard | null>(null);

/** Registers a synchronous discard guard with the closest route-backed Drawer. */
export function useRouteDrawerNavigationGuard(
    guard: RouteDrawerNavigationGuard,
): void {
    const register = useContext(RouteDrawerNavigationGuardContext);
    useEffect(() => register?.(guard), [guard, register]);
}

export interface RouteDrawerProps {
    open: boolean;
    closeHref: string;
    title: ReactNode;
    description: ReactNode;
    children: ReactNode;
    size?: "sm" | "md" | "lg" | "xl";
}

/** Drawer whose open state is represented by the page URL. */
export function RouteDrawer({
    open,
    closeHref,
    title,
    description,
    children,
    size = "lg",
}: RouteDrawerProps) {
    const router = useAppRouter();
    const navigationGuard = useRef<RouteDrawerNavigationGuard | null>(null);
    const registerNavigationGuard = useCallback<RegisterRouteDrawerNavigationGuard>(
        (guard) => {
            navigationGuard.current = guard;
            return () => {
                if (navigationGuard.current === guard) navigationGuard.current = null;
            };
        },
        [],
    );
    const allowNavigation = useCallback(
        () => navigationGuard.current?.() ?? true,
        [],
    );

    function guardDrawerLink(event: MouseEvent<HTMLDivElement>): void {
        if (
            event.defaultPrevented
            || event.button !== 0
            || event.metaKey
            || event.ctrlKey
            || event.shiftKey
            || event.altKey
            || !(event.target instanceof Element)
        ) return;

        const anchor = event.target.closest<HTMLAnchorElement>("a[href]");
        if (
            !anchor
            || anchor.hasAttribute("download")
            || (anchor.target && anchor.target !== "_self")
            || !leavesCurrentDrawerRoute(window.location.href, anchor.href)
            || allowNavigation()
        ) return;

        event.preventDefault();
        event.stopPropagation();
    }

    return (
        <RouteDrawerNavigationGuardContext.Provider value={registerNavigationGuard}>
            <Drawer
                open={open}
                onOpenChange={(nextOpen) => {
                    if (!nextOpen && allowNavigation()) {
                        router.replace(closeHref, { scroll: false });
                    }
                }}
                position="end"
                size={size}
            >
                <DrawerContent onClickCapture={guardDrawerLink}>
                    <DrawerHeader className={styles.drawerHeader}>
                        <DrawerTitle className={styles.drawerHeading}>{title}</DrawerTitle>
                        <DrawerDescription className={styles.drawerDescription}>
                            {description}
                        </DrawerDescription>
                        <DrawerCloseButton aria-label="關閉詳細資料" />
                    </DrawerHeader>
                    <DrawerBody className={styles.drawerBody}>{children}</DrawerBody>
                </DrawerContent>
            </Drawer>
        </RouteDrawerNavigationGuardContext.Provider>
    );
}
