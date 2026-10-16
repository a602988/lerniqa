import "server-only";

import {
  createSynologyMailPlusAdapter,
  loadSynologyMailPlusConfig,
  type MailProviderAdapter,
  type SmtpTransportFactory,
} from "./synology-mailplus.ts";

/**
 * Server-only composition point for account mail.
 *
 * The concrete SMTP factory is deliberately injected. Installing and wiring
 * the approved transport library is the only remaining provider-specific step.
 */
export function createConfiguredMailAdapter(
  createTransport: SmtpTransportFactory,
): MailProviderAdapter {
  return createSynologyMailPlusAdapter(
    loadSynologyMailPlusConfig(process.env),
    createTransport,
  );
}
