import assert from "node:assert/strict";
import test from "node:test";

import {
  MAIL_ENV_NAMES,
  MailServiceError,
  createSynologyMailPlusAdapter,
  loadSynologyMailPlusConfig,
} from "../app/lib/mail/synology-mailplus.ts";
import {
  buildEmailVerificationMessage,
  buildPasswordResetMessage,
  sendEmailVerification,
} from "../app/lib/mail/account-mail.ts";
import {
  createNodemailerSmtpTransportFactory,
} from "../app/lib/mail/nodemailer-transport.ts";

const COMPLETE_ENV = Object.freeze({
  [MAIL_ENV_NAMES.host]: "mail.internal.example",
  [MAIL_ENV_NAMES.port]: "465",
  [MAIL_ENV_NAMES.tls]: "true",
  [MAIL_ENV_NAMES.username]: "mailer",
  [MAIL_ENV_NAMES.password]: "synthetic-secret",
  [MAIL_ENV_NAMES.fromName]: "Lerniqa 學習平台",
  [MAIL_ENV_NAMES.fromAddress]: "no-reply@example.com",
});

test("loads a strict MailPlus SMTP profile without exposing credentials", () => {
  const config = loadSynologyMailPlusConfig(COMPLETE_ENV);

  assert.deepEqual(config, {
    provider: "synology_mailplus",
    host: "mail.internal.example",
    port: 465,
    tls: true,
    username: "mailer",
    password: "synthetic-secret",
    from: {
      name: "Lerniqa 學習平台",
      address: "no-reply@example.com",
    },
  });

  assert.throws(
    () =>
      loadSynologyMailPlusConfig({
        ...COMPLETE_ENV,
        [MAIL_ENV_NAMES.password]: undefined,
      }),
    (error) => {
      assert.ok(error instanceof MailServiceError);
      assert.equal(error.code, "MAIL_NOT_CONFIGURED");
      assert.equal(error.status, 503);
      assert.equal(error.message.includes("synthetic-secret"), false);
      return true;
    },
  );
});

test("maps MailPlus port 465 to implicit TLS and forces the configured sender", async () => {
  const config = loadSynologyMailPlusConfig(COMPLETE_ENV);
  let seenOptions;
  let seenMessage;
  const adapter = createSynologyMailPlusAdapter(config, (options) => {
    seenOptions = options;
    return {
      async verify() {},
      async sendMail(message) {
        seenMessage = message;
        return {
          messageId: "<synthetic@example.com>",
          accepted: ["learner@example.net"],
          rejected: [],
        };
      },
    };
  });

  const result = await adapter.send({
    to: [{ name: "測試學習者", address: "Learner@Example.NET" }],
    subject: "測試信件",
    text: "這是合成測試內容。",
  });

  assert.deepEqual(seenOptions, {
    host: "mail.internal.example",
    port: 465,
    secure: true,
    auth: { user: "mailer", pass: "synthetic-secret" },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });
  assert.deepEqual(seenMessage.from, {
    name: "Lerniqa 學習平台",
    address: "no-reply@example.com",
  });
  assert.deepEqual(seenMessage.to, [
    { name: "測試學習者", address: "learner@example.net" },
  ]);
  assert.deepEqual(result, {
    messageId: "<synthetic@example.com>",
    accepted: ["learner@example.net"],
    rejected: [],
  });
});

test("uses STARTTLS semantics on a non-465 TLS port", async () => {
  const config = loadSynologyMailPlusConfig({
    ...COMPLETE_ENV,
    [MAIL_ENV_NAMES.port]: "587",
  });
  let seenOptions;
  const adapter = createSynologyMailPlusAdapter(config, (options) => {
    seenOptions = options;
    return {
      async verify() {},
      async sendMail() {
        return {};
      },
    };
  });

  await adapter.verify();

  assert.equal(seenOptions.secure, false);
  assert.equal(seenOptions.requireTLS, true);
});

test("the Nodemailer bridge forwards SMTP options and messages without network access", async () => {
  let seenOptions;
  let seenMessage;
  let verifyCalls = 0;
  const factory = createNodemailerSmtpTransportFactory((options) => {
    seenOptions = options;
    return {
      async verify() {
        verifyCalls += 1;
      },
      async sendMail(message) {
        seenMessage = message;
        return {
          messageId: "mock-nodemailer-id",
          accepted: ["learner@example.net"],
          rejected: [],
        };
      },
    };
  });
  const options = {
    host: "mail.internal.example",
    port: 587,
    secure: false,
    requireTLS: true,
    auth: { user: "mailer", pass: "synthetic-secret" },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  };
  const transport = factory(options);

  await transport.verify();
  const result = await transport.sendMail({
    from: { name: "Lerniqa", address: "no-reply@example.com" },
    to: [{ name: "測試學習者", address: "learner@example.net" }],
    subject: "合成通知",
    text: "不會送出網路的測試內容。",
  });

  assert.equal(verifyCalls, 1);
  assert.deepEqual(seenOptions, {
    ...options,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  assert.notEqual(seenOptions, options);
  assert.deepEqual(seenMessage, {
    from: { name: "Lerniqa", address: "no-reply@example.com" },
    to: [{ name: "測試學習者", address: "learner@example.net" }],
    subject: "合成通知",
    text: "不會送出網路的測試內容。",
  });
  assert.deepEqual(result, {
    messageId: "mock-nodemailer-id",
    accepted: ["learner@example.net"],
    rejected: [],
  });
});

test("does not leak an upstream SMTP error", async () => {
  const config = loadSynologyMailPlusConfig(COMPLETE_ENV);
  const adapter = createSynologyMailPlusAdapter(config, () => ({
    async verify() {
      throw new Error("AUTH synthetic-secret rejected by private-host");
    },
    async sendMail() {
      throw new Error("AUTH synthetic-secret rejected by private-host");
    },
  }));

  await assert.rejects(adapter.verify(), (error) => {
    assert.ok(error instanceof MailServiceError);
    assert.equal(error.code, "MAIL_UPSTREAM_ERROR");
    assert.equal(error.status, 502);
    assert.equal(error.message.includes("synthetic-secret"), false);
    assert.equal(error.message.includes("private-host"), false);
    return true;
  });
});

test("rejects header injection before calling the transport", async () => {
  const config = loadSynologyMailPlusConfig(COMPLETE_ENV);
  let calls = 0;
  const adapter = createSynologyMailPlusAdapter(config, () => ({
    async verify() {},
    async sendMail() {
      calls += 1;
      return {};
    },
  }));

  await assert.rejects(
    adapter.send({
      to: [{ address: "target@example.com" }],
      subject: "安全通知\r\nBcc: attacker@example.com",
      text: "內容",
    }),
    (error) => {
      assert.ok(error instanceof MailServiceError);
      assert.equal(error.code, "MAIL_INVALID_MESSAGE");
      return true;
    },
  );
  assert.equal(calls, 0);
});

test("builds escaped verification and password-reset templates", () => {
  const verification = buildEmailVerificationMessage({
    to: "learner@example.net",
    displayName: '<測試 & "學習者">',
    actionUrl: "https://accounts.example.test/verify?token=a&flow=email",
    expiresInMinutes: 30,
  });
  const reset = buildPasswordResetMessage({
    to: "learner@example.net",
    actionUrl: "http://localhost:3500/reset-password?token=synthetic",
    expiresInMinutes: 15,
  });

  assert.equal(verification.subject, "驗證你的 Lerniqa 信箱");
  assert.match(verification.text, /30 分鐘/);
  assert.match(verification.html, /&lt;測試 &amp; &quot;學習者&quot;&gt;/);
  assert.match(verification.html, /token=a&amp;flow=email/);
  assert.equal(verification.html.includes('<測試 & "學習者">'), false);
  assert.equal(reset.subject, "重設你的 Lerniqa 密碼");
  assert.match(reset.text, /原密碼不會變更/);

  assert.throws(
    () =>
      buildEmailVerificationMessage({
        to: "learner@example.net",
        actionUrl: "http://100.86.149.1:3500/verify?token=synthetic",
        expiresInMinutes: 30,
      }),
    (error) => {
      assert.ok(error instanceof MailServiceError);
      assert.equal(error.code, "MAIL_INVALID_MESSAGE");
      return true;
    },
  );
});

test("account mail orchestration accepts an injected provider and never uses the network", async () => {
  let sentMessage;
  const result = await sendEmailVerification(
    {
      provider: "synology_mailplus",
      async verify() {},
      async send(message) {
        sentMessage = message;
        return {
          messageId: "mock-message-id",
          accepted: ["learner@example.net"],
          rejected: [],
        };
      },
    },
    {
      to: "learner@example.net",
      displayName: "測試使用者",
      actionUrl: "https://accounts.example.test/verify?token=synthetic",
      expiresInMinutes: 30,
    },
  );

  assert.equal(sentMessage.to[0].address, "learner@example.net");
  assert.equal(result.messageId, "mock-message-id");
});

test("account mail orchestration fails when SMTP rejects the recipient", async () => {
  await assert.rejects(
    sendEmailVerification(
      {
        provider: "synology_mailplus",
        async verify() {},
        async send() {
          return {
            messageId: "mock-message-id",
            accepted: [],
            rejected: ["learner@example.net"],
          };
        },
      },
      {
        to: "learner@example.net",
        actionUrl: "https://accounts.example.test/verify?token=synthetic",
        expiresInMinutes: 30,
      },
    ),
    (error) => {
      assert.ok(error instanceof MailServiceError);
      assert.equal(error.code, "MAIL_UPSTREAM_ERROR");
      return true;
    },
  );
});
