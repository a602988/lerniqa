import {
  createTransport as createNodemailerTransport,
  type SendMailOptions,
  type SMTPSentMessageInfo,
  type SMTPTransportOptions,
} from "nodemailer";

import type {
  SmtpTransport,
  SmtpTransportFactory,
  SmtpTransportOptions,
} from "./synology-mailplus.ts";

type NodemailerTransportLike = Readonly<{
  verify(): Promise<unknown>;
  sendMail(
    message: SendMailOptions,
  ): Promise<
    Pick<SMTPSentMessageInfo, "messageId" | "accepted" | "rejected">
  >;
}>;

export type NodemailerCreateTransport = (
  options: SMTPTransportOptions,
) => NodemailerTransportLike;

const createDefaultTransport: NodemailerCreateTransport = (options) =>
  createNodemailerTransport(options);

function createTransportOptions(
  options: SmtpTransportOptions,
): SMTPTransportOptions {
  return {
    host: options.host,
    port: options.port,
    secure: options.secure,
    ...(options.requireTLS === undefined
      ? {}
      : { requireTLS: options.requireTLS }),
    auth: {
      user: options.auth.user,
      pass: options.auth.pass,
    },
    connectionTimeout: options.connectionTimeout,
    greetingTimeout: options.greetingTimeout,
    socketTimeout: options.socketTimeout,
    disableFileAccess: true,
    disableUrlAccess: true,
  };
}

function adaptTransport(
  options: SmtpTransportOptions,
  createNodemailer: NodemailerCreateTransport,
): SmtpTransport {
  const transport = createNodemailer(createTransportOptions(options));

  return {
    verify: () => transport.verify(),
    sendMail: async (message) => {
      const result = await transport.sendMail({
        from: { ...message.from },
        to: message.to.map((recipient) => ({ ...recipient })),
        subject: message.subject,
        ...(message.text ? { text: message.text } : {}),
        ...(message.html ? { html: message.html } : {}),
      });

      return {
        messageId: result.messageId,
        accepted: result.accepted,
        rejected: result.rejected,
      };
    },
  };
}

/**
 * Adapt Nodemailer to the narrow MailPlus transport contract. The injectable
 * factory lets tests verify the complete wiring without opening a socket.
 */
export function createNodemailerSmtpTransportFactory(
  createNodemailer: NodemailerCreateTransport = createDefaultTransport,
): SmtpTransportFactory {
  return (options): SmtpTransport =>
    adaptTransport(options, createNodemailer);
}

export const nodemailerSmtpTransportFactory =
  createNodemailerSmtpTransportFactory();
