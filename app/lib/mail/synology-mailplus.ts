export const MAIL_PROVIDER = "synology_mailplus" as const;

export const MAIL_ENV_NAMES = Object.freeze({
  host: "LERNIQA_MAIL_SMTP_HOST",
  port: "LERNIQA_MAIL_SMTP_PORT",
  tls: "LERNIQA_MAIL_SMTP_SECURE",
  username: "LERNIQA_MAIL_SMTP_USER",
  password: "LERNIQA_MAIL_SMTP_PASSWORD",
  fromName: "LERNIQA_MAIL_FROM_NAME",
  fromAddress: "LERNIQA_MAIL_FROM_ADDRESS",
} as const);

export type MailEnvironment = Readonly<Record<string, string | undefined>>;

export type MailAddress = Readonly<{
  name?: string;
  address: string;
}>;

export type OutboundMailMessage = Readonly<{
  to: readonly MailAddress[];
  subject: string;
  text?: string;
  html?: string;
}>;

export type SmtpTransportOptions = Readonly<{
  host: string;
  port: number;
  secure: boolean;
  requireTLS?: boolean;
  auth: Readonly<{
    user: string;
    pass: string;
  }>;
  connectionTimeout: number;
  greetingTimeout: number;
  socketTimeout: number;
}>;

export type SmtpMessage = Readonly<{
  from: MailAddress;
  to: readonly MailAddress[];
  subject: string;
  text?: string;
  html?: string;
}>;

export type SmtpSendResult = Readonly<{
  messageId?: string;
  accepted?: readonly unknown[];
  rejected?: readonly unknown[];
}>;

export type SmtpTransport = Readonly<{
  verify(): Promise<unknown>;
  sendMail(message: SmtpMessage): Promise<SmtpSendResult>;
}>;

export type SmtpTransportFactory = (
  options: SmtpTransportOptions,
) => SmtpTransport;

export type SynologyMailPlusConfig = Readonly<{
  provider: typeof MAIL_PROVIDER;
  host: string;
  port: number;
  tls: boolean;
  username: string;
  password: string;
  from: MailAddress;
}>;

export type MailSendResult = Readonly<{
  messageId: string | null;
  accepted: readonly string[];
  rejected: readonly string[];
}>;

export type MailProviderAdapter = Readonly<{
  provider: typeof MAIL_PROVIDER;
  verify(): Promise<void>;
  send(message: OutboundMailMessage): Promise<MailSendResult>;
}>;

export type MailServiceErrorCode =
  | "MAIL_NOT_CONFIGURED"
  | "MAIL_INVALID_MESSAGE"
  | "MAIL_UPSTREAM_ERROR";

export class MailServiceError extends Error {
  readonly code: MailServiceErrorCode;
  readonly status: number;

  constructor(code: MailServiceErrorCode, message: string, status: number) {
    super(message);
    this.name = "MailServiceError";
    this.code = code;
    this.status = status;
  }
}

function configurationError(name: string): MailServiceError {
  return new MailServiceError(
    "MAIL_NOT_CONFIGURED",
    `郵件服務尚未完成設定（${name}）。`,
    503,
  );
}

function readRequiredValue(
  environment: MailEnvironment,
  name: string,
  options: Readonly<{ trim?: boolean; maxLength?: number }> = {},
): string {
  const raw = environment[name];
  const value = options.trim === false ? raw : raw?.trim();

  if (!value || value.length > (options.maxLength ?? 4096)) {
    throw configurationError(name);
  }

  return value;
}

function assertNoHeaderControlCharacters(value: string, name: string): void {
  if (/\r|\n|\0/.test(value)) {
    throw configurationError(name);
  }
}

function parsePort(environment: MailEnvironment): number {
  const raw = environment[MAIL_ENV_NAMES.port]?.trim() || "465";

  if (!/^\d+$/.test(raw)) {
    throw configurationError(MAIL_ENV_NAMES.port);
  }

  const port = Number(raw);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw configurationError(MAIL_ENV_NAMES.port);
  }

  return port;
}

function parseTls(environment: MailEnvironment): boolean {
  const raw = environment[MAIL_ENV_NAMES.tls]?.trim().toLowerCase() || "true";

  if (raw === "true") return true;
  if (raw === "false") return false;

  throw configurationError(MAIL_ENV_NAMES.tls);
}

const EMAIL_ADDRESS_PATTERN = /^[^\s@<>\r\n]+@[^\s@<>\r\n]+\.[^\s@<>\r\n]+$/u;

function normalizeEmailAddress(
  value: string,
  errorCode: MailServiceErrorCode,
): string {
  const address = value.trim().toLowerCase();

  if (address.length > 320 || !EMAIL_ADDRESS_PATTERN.test(address)) {
    throw new MailServiceError(
      errorCode,
      errorCode === "MAIL_NOT_CONFIGURED"
        ? `郵件服務尚未完成設定（${MAIL_ENV_NAMES.fromAddress}）。`
        : "收件信箱格式不正確。",
      errorCode === "MAIL_NOT_CONFIGURED" ? 503 : 400,
    );
  }

  return address;
}

export function loadSynologyMailPlusConfig(
  environment: MailEnvironment,
): SynologyMailPlusConfig {
  const host = readRequiredValue(environment, MAIL_ENV_NAMES.host, {
    maxLength: 255,
  });
  const username = readRequiredValue(environment, MAIL_ENV_NAMES.username, {
    maxLength: 255,
  });
  const password = readRequiredValue(environment, MAIL_ENV_NAMES.password, {
    trim: false,
  });
  const fromName =
    environment[MAIL_ENV_NAMES.fromName]?.trim() || "Lerniqa";
  const fromAddress = normalizeEmailAddress(
    readRequiredValue(environment, MAIL_ENV_NAMES.fromAddress, {
      maxLength: 320,
    }),
    "MAIL_NOT_CONFIGURED",
  );

  assertNoHeaderControlCharacters(host, MAIL_ENV_NAMES.host);
  assertNoHeaderControlCharacters(username, MAIL_ENV_NAMES.username);
  assertNoHeaderControlCharacters(fromName, MAIL_ENV_NAMES.fromName);

  if (/\s/u.test(host) || fromName.length > 255) {
    throw configurationError(
      /\s/u.test(host) ? MAIL_ENV_NAMES.host : MAIL_ENV_NAMES.fromName,
    );
  }

  return {
    provider: MAIL_PROVIDER,
    host,
    port: parsePort(environment),
    tls: parseTls(environment),
    username,
    password,
    from: {
      name: fromName,
      address: fromAddress,
    },
  };
}

function transportOptions(
  config: SynologyMailPlusConfig,
): SmtpTransportOptions {
  const implicitTls = config.tls && config.port === 465;

  return {
    host: config.host,
    port: config.port,
    secure: implicitTls,
    ...(config.tls && !implicitTls ? { requireTLS: true } : {}),
    auth: {
      user: config.username,
      pass: config.password,
    },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  };
}

function normalizeDisplayName(name: string | undefined): string | undefined {
  const normalized = name?.replace(/[\r\n\0]+/g, " ").trim();
  return normalized ? normalized.slice(0, 255) : undefined;
}

function validateMessage(message: OutboundMailMessage): SmtpMessage {
  const subject = message.subject.trim();
  if (!subject || subject.length > 200 || /[\r\n\0]/.test(subject)) {
    throw new MailServiceError(
      "MAIL_INVALID_MESSAGE",
      "郵件主旨格式不正確。",
      400,
    );
  }

  if (message.to.length === 0 || message.to.length > 20) {
    throw new MailServiceError(
      "MAIL_INVALID_MESSAGE",
      "郵件必須有 1 到 20 位收件者。",
      400,
    );
  }

  const to = message.to.map((recipient) => {
    const name = normalizeDisplayName(recipient.name);

    return {
      ...(name ? { name } : {}),
      address: normalizeEmailAddress(recipient.address, "MAIL_INVALID_MESSAGE"),
    };
  });
  const text = message.text?.trim();
  const html = message.html?.trim();

  if (!text && !html) {
    throw new MailServiceError(
      "MAIL_INVALID_MESSAGE",
      "郵件內容不可為空白。",
      400,
    );
  }

  if ((text?.length ?? 0) > 100_000 || (html?.length ?? 0) > 200_000) {
    throw new MailServiceError(
      "MAIL_INVALID_MESSAGE",
      "郵件內容超過允許長度。",
      400,
    );
  }

  return {
    from: { address: "placeholder@example.invalid" },
    to,
    subject,
    ...(text ? { text } : {}),
    ...(html ? { html } : {}),
  };
}

function stringList(values: readonly unknown[] | undefined): readonly string[] {
  return (values ?? []).map(String);
}

export function createSynologyMailPlusAdapter(
  config: SynologyMailPlusConfig,
  createTransport: SmtpTransportFactory,
): MailProviderAdapter {
  const options = transportOptions(config);

  function makeTransport(): SmtpTransport {
    try {
      return createTransport(options);
    } catch {
      throw new MailServiceError(
        "MAIL_UPSTREAM_ERROR",
        "郵件服務目前無法使用。",
        502,
      );
    }
  }

  return {
    provider: MAIL_PROVIDER,

    async verify() {
      try {
        await makeTransport().verify();
      } catch (error) {
        if (error instanceof MailServiceError) throw error;
        throw new MailServiceError(
          "MAIL_UPSTREAM_ERROR",
          "郵件服務目前無法使用。",
          502,
        );
      }
    },

    async send(message) {
      const validated = validateMessage(message);

      try {
        const result = await makeTransport().sendMail({
          ...validated,
          from: config.from,
        });

        return {
          messageId: result.messageId?.trim() || null,
          accepted: stringList(result.accepted),
          rejected: stringList(result.rejected),
        };
      } catch (error) {
        if (error instanceof MailServiceError) throw error;
        throw new MailServiceError(
          "MAIL_UPSTREAM_ERROR",
          "郵件服務目前無法使用。",
          502,
        );
      }
    },
  };
}
