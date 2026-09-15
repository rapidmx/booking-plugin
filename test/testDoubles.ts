///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
// Test doubles for the pluggable interfaces this plugin's routes inject, registered with an `ObjectFactory` under the
// same names `@Inject("...")` resolves. Every integration test that boots the `test/server-mongo`/`test/server-sql`
// fixture apps registers these before `server.start()`, because `Server` instantiates every route it discovers.
import type { MailTransport, OutboundMessage, TransportResult } from "@rapidmx/restapi";
import type { ObjectFactory } from "@rapidrest/service-core";

/**
 * A `MailTransport` that records every message it was asked to send, without relaying anywhere. Rejects (accepts none
 * of) any envelope recipient whose address is exactly `reject@example.com`, so a test can exercise a transport
 * rejection through a real HTTP request.
 */
export class RecordingMailTransport implements MailTransport {
    public readonly name: string = "recording";
    public sent: OutboundMessage[] = [];

    public async send(message: OutboundMessage): Promise<TransportResult> {
        if (message.envelopeTo.includes("reject@example.com")) {
            return { accepted: [], rejected: message.envelopeTo };
        }
        this.sent.push(message);
        return { accepted: message.envelopeTo, rejected: [] };
    }
}

/**
 * Registers the test doubles against `objectFactory`. Call this before `server.start()` in any integration test that
 * boots the fixture apps.
 */
export function registerTestDoubles(objectFactory: ObjectFactory): void {
    objectFactory.register(RecordingMailTransport, "MailTransport");
}
