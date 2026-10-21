"use client";

import {
    MultiSelect,
    NativeSelect,
    type MultiSelectProps,
    type NativeSelectProps,
} from "@keel-design/ui";

type SingleSelectProps = NativeSelectProps & {
    selection?: "single";
};

type MultipleSelectProps = MultiSelectProps & {
    selection: "multiple";
};

export type AppSelectProps = SingleSelectProps | MultipleSelectProps;

/**
 * 提供全站一致的單選與複選入口。
 * @param props 單選使用原生事件契約，複選使用值陣列契約。
 * @returns Keel 設計系統對應的選取元件。
 */
export function AppSelect(props: AppSelectProps) {
    if (props.selection === "multiple") {
        const { selection, ...multipleProps } = props;
        return <MultiSelect {...multipleProps} />;
    }

    const { selection, ...singleProps } = props;
    return <NativeSelect {...singleProps} />;
}
