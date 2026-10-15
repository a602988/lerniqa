interface RolePinKeypadProps {
    /** 已輸入的六位數角色密碼。 */
    value: string;
    /** 密碼內容變更時通知外層狀態。 */
    onChange: (value: string) => void;
}

const ROLE_PIN_DIGITS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

/**
 * 顯示角色切換使用的數字密碼鍵盤。
 *
 * @param props 目前密碼與更新事件。
 * @returns 六位數密碼顯示與數字按鍵。
 */
export function RolePinKeypad({ value, onChange }: RolePinKeypadProps) {
    /**
     * 加入一位數字，最多保留六位。
     *
     * @param digit 使用者按下的數字。
     * @returns 無回傳值。
     */
    function appendDigit(digit: string) {
        if (value.length >= 6) return;
        onChange(`${value}${digit}`);
    }

    return <div className="role-pin-entry">
        <div className="role-pin-display" role="status" aria-label={`已輸入 ${value.length} 位角色密碼`}>
            {Array.from({ length: 6 }, (_, index) => <span data-filled={index < value.length} key={index} />)}
        </div>
        <div className="role-pin-keypad" role="group" aria-label="角色密碼數字鍵盤">
            {ROLE_PIN_DIGITS.map((digit) => <button type="button" key={digit} onClick={() => appendDigit(digit)}>{digit}</button>)}
            <button type="button" className="role-pin-keypad-action" disabled={!value} onClick={() => onChange("")}>清除</button>
            <button type="button" onClick={() => appendDigit("0")}>0</button>
            <button type="button" className="role-pin-keypad-action" aria-label="刪除上一位數字" disabled={!value} onClick={() => onChange(value.slice(0, -1))}>⌫</button>
        </div>
    </div>;
}
