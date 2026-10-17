"use client";

import {
    Button,
    Dialog,
    DialogBody,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@keel-design/ui";

export interface PolicyDialogProps {
    title: string;
    description: string;
    triggerLabel?: string;
}

/** Read-only explanation for an operation blocked by the current safety contract. */
export function PolicyDialog({
    title,
    description,
    triggerLabel = "查看限制",
}: PolicyDialogProps) {
    return (
        <Dialog>
            <DialogTrigger asChild>
                <Button type="button" appearance="outline" tone="muted" size="sm">
                    {triggerLabel}
                </Button>
            </DialogTrigger>
            <DialogContent size="sm" closeLabel="關閉安全限制說明">
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                    <DialogDescription>
                        這項操作目前未開放，介面不會送出任何資料異動。
                    </DialogDescription>
                </DialogHeader>
                <DialogBody>{description}</DialogBody>
                <DialogFooter>
                    <DialogClose asChild>
                        <Button type="button" appearance="outline" tone="muted">
                            關閉
                        </Button>
                    </DialogClose>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
