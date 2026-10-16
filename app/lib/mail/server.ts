import "server-only";

import {
  createSynologyMailPlusAdapter,
  loadSynologyMailPlusConfig,
  type MailProviderAdapter,
  type SmtpTransportFactory,
} from "./synology-mailplus.ts";
import { nodemailerSmtpTransportFactory } from "./nodemailer-transport.ts";

/**
 * Server-only composition point for account mail.
 *
 * Production uses Nodemailer. Tests may inject a transport factory so they can
 * exercise configuration and message delivery without opening a network socket.
 */
export function createConfiguredMailAdapter(
  createTransport: SmtpTransportFactory = nodemailerSmtpTransportFactory,
): MailProviderAdapter {
  return createSynologyMailPlusAdapter(
    loadSynologyMailPlusConfig(process.env),
    createTransport,
  );
}
