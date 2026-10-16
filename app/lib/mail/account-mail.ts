import type {
  MailProviderAdapter,
  MailSendResult,
  OutboundMailMessage,
} from "./synology-mailplus.ts";
import { MailServiceError } from "./synology-mailplus.ts";

export type AccountMailInput = Readonly<{
  to: string;
  displayName?: string;
  actionUrl: string;
  expiresInMinutes: number;
}>;

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function validateExpiry(minutes: number): void {
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1_440) {
    throw new MailServiceError(
      "MAIL_INVALID_MESSAGE",
      "驗證連結有效時間格式不正確。",
      400,
    );
  }
}

function validateActionUrl(value: string): string {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new MailServiceError(
      "MAIL_INVALID_MESSAGE",
      "帳號操作連結格式不正確。",
      400,
    );
  }

  const isLocalDevelopment =
    url.protocol === "http:" &&
    ["localhost", "127.0.0.1", "::1"].includes(url.hostname);

  if (url.protocol !== "https:" && !isLocalDevelopment) {
    throw new MailServiceError(
      "MAIL_INVALID_MESSAGE",
      "帳號操作連結必須使用 HTTPS。",
      400,
    );
  }

  if (url.username || url.password) {
    throw new MailServiceError(
      "MAIL_INVALID_MESSAGE",
      "帳號操作連結不可含有 URL 登入資訊。",
      400,
    );
  }

  return url.toString();
}

function greeting(displayName: string | undefined): Readonly<{
  text: string;
  html: string;
}> {
  const cleanName = displayName?.replace(/[\r\n\0]+/g, " ").trim();

  if (!cleanName) {
    return { text: "你好：", html: "你好：" };
  }

  const clipped = cleanName.slice(0, 80);
  return {
    text: `${clipped}，你好：`,
    html: `${escapeHtml(clipped)}，你好：`,
  };
}

function recipientName(displayName: string | undefined): string | undefined {
  const normalized = displayName?.replace(/[\r\n\0]+/g, " ").trim();
  return normalized ? normalized.slice(0, 80) : undefined;
}

function buildAccountMessage(
  input: AccountMailInput,
  content: Readonly<{
    subject: string;
    intro: string;
    actionLabel: string;
    ignoreText: string;
  }>,
): OutboundMailMessage {
  validateExpiry(input.expiresInMinutes);
  const actionUrl = validateActionUrl(input.actionUrl);
  const safeRecipientName = recipientName(input.displayName);
  const salutation = greeting(safeRecipientName);
  const expiry = `此連結將在 ${input.expiresInMinutes} 分鐘後失效。`;

  return {
    to: [
      {
        ...(safeRecipientName ? { name: safeRecipientName } : {}),
        address: input.to,
      },
    ],
    subject: content.subject,
    text: [
      salutation.text,
      "",
      content.intro,
      actionUrl,
      "",
      expiry,
      content.ignoreText,
    ].join("\n"),
    html: [
      "<!doctype html>",
      '<html lang="zh-Hant">',
      '<body style="font-family:system-ui,-apple-system,sans-serif;line-height:1.6;color:#17202a">',
      `<p>${salutation.html}</p>`,
      `<p>${escapeHtml(content.intro)}</p>`,
      `<p><a href="${escapeHtml(actionUrl)}" style="display:inline-block;padding:10px 18px;border-radius:8px;background:#3157d5;color:#fff;text-decoration:none">${escapeHtml(content.actionLabel)}</a></p>`,
      `<p>${escapeHtml(expiry)}</p>`,
      `<p>${escapeHtml(content.ignoreText)}</p>`,
      "</body>",
      "</html>",
    ].join(""),
  };
}

export function buildEmailVerificationMessage(
  input: AccountMailInput,
): OutboundMailMessage {
  return buildAccountMessage(input, {
    subject: "驗證你的 Lerniqa 信箱",
    intro: "請使用下方連結完成信箱驗證。",
    actionLabel: "驗證信箱",
    ignoreText: "若你沒有註冊 Lerniqa，可以忽略這封信。",
  });
}

export function buildPasswordResetMessage(
  input: AccountMailInput,
): OutboundMailMessage {
  return buildAccountMessage(input, {
    subject: "重設你的 Lerniqa 密碼",
    intro: "請使用下方連結設定新的密碼。",
    actionLabel: "重設密碼",
    ignoreText: "若你沒有要求重設密碼，請忽略這封信；原密碼不會變更。",
  });
}

export async function sendEmailVerification(
  adapter: MailProviderAdapter,
  input: AccountMailInput,
): Promise<MailSendResult> {
  return sendAccountMessage(adapter, buildEmailVerificationMessage(input));
}

export async function sendPasswordReset(
  adapter: MailProviderAdapter,
  input: AccountMailInput,
): Promise<MailSendResult> {
  return sendAccountMessage(adapter, buildPasswordResetMessage(input));
}

async function sendAccountMessage(
  adapter: MailProviderAdapter,
  message: OutboundMailMessage,
): Promise<MailSendResult> {
  const result = await adapter.send(message);
  const recipient = message.to[0]?.address.trim().toLowerCase();
  const accepted = result.accepted.map((address) =>
    address.trim().toLowerCase(),
  );
  const rejected = result.rejected.map((address) =>
    address.trim().toLowerCase(),
  );

  if (
    !recipient ||
    !accepted.includes(recipient) ||
    rejected.includes(recipient)
  ) {
    throw new MailServiceError(
      "MAIL_UPSTREAM_ERROR",
      "郵件服務未接受這封帳號通知。",
      502,
    );
  }

  return result;
}
