interface LerniqaMarkProps {
    /** 額外尺寸或版面樣式。 */
    className?: string;
}

interface LerniqaLogoProps {
    /** 額外尺寸或版面樣式。 */
    className?: string;
}

/**
 * 顯示完整的 Lerniqa 品牌字樣。
 *
 * @param props 圖片外框的版面樣式。
 * @returns 使用品牌原圖的完整 Logo。
 */
export function LerniqaLogo({ className }: LerniqaLogoProps) {
    return (
        <span className={`lerniqa-wordmark ${className ?? ""}`.trim()}>
            <img alt="Lerniqa" src="/lerniqa-logo.jpg" />
        </span>
    );
}

/**
 * 顯示 Lerniqa 原創的練習循環品牌標誌。
 *
 * 旁邊已有完整品牌名稱，因此圖形本身不重複朗讀。
 *
 * @param props SVG 圖形的版面樣式。
 * @returns 與 favicon 共用幾何的品牌圖形。
 */
export function LerniqaMark({ className }: LerniqaMarkProps) {
    return (
        <svg
            viewBox="0 0 32 32"
            fill="none"
            aria-hidden="true"
            className={className}
        >
            <rect x="2.75" y="5.5" width="26.5" height="21.75" rx="6.25" fill="#F8F7FF" stroke="#745EE8" strokeWidth="1.5" />
            <path d="M10 5.5V3.5H22V5.5" stroke="#745EE8" strokeWidth="1.5" strokeLinecap="round" />
            <path
                d="M9.25 15.75h13.5"
                stroke="#745EE8"
                strokeWidth="1.5"
                strokeLinecap="round"
            />
            <circle cx="11.25" cy="15.75" r="1.75" fill="#E0719F" />
            <circle cx="20.75" cy="15.75" r="1.75" fill="#745EE8" />
        </svg>
    );
}
