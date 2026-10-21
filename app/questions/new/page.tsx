import { redirect } from "next/navigation";

/**
 * 將舊的新增題目入口導向預設的檔案上傳頁。
 *
 * @returns 不回傳畫面內容。
 */
export default function NewQuestionPage() {
    redirect("/questions/new/upload");
}
