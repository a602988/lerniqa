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
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

import styles from "./views.module.css";

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
    const router = useRouter();

    return (
        <Drawer
            open={open}
            onOpenChange={(nextOpen) => {
                if (!nextOpen) router.replace(closeHref, { scroll: false });
            }}
            position="end"
            size={size}
        >
            <DrawerContent>
                <DrawerHeader>
                    <DrawerTitle>{title}</DrawerTitle>
                    <DrawerDescription>{description}</DrawerDescription>
                    <DrawerCloseButton aria-label="關閉詳細資料" />
                </DrawerHeader>
                <DrawerBody className={styles.drawerBody}>{children}</DrawerBody>
            </DrawerContent>
        </Drawer>
    );
}
