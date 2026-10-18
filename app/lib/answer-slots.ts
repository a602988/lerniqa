export const ANSWER_SLOT_SEPARATOR = "，";

export function splitAnswerSlots(value: string, count: number): string[] {
    const slots = value.split(ANSWER_SLOT_SEPARATOR);
    return Array.from({ length: count }, (_, index) => slots[index] ?? "");
}

export function setAnswerSlot(value: string, count: number, index: number, next: string): string {
    const slots = splitAnswerSlots(value, count);
    slots[index] = next.replaceAll(ANSWER_SLOT_SEPARATOR, "");
    return slots.join(ANSWER_SLOT_SEPARATOR);
}

export function hasCompleteAnswerSlots(value: string, count: number): boolean {
    if (count <= 1) return Boolean(value.trim());
    const slots = value.split(ANSWER_SLOT_SEPARATOR);
    return slots.length === count && slots.every((slot) => Boolean(slot.trim()));
}
