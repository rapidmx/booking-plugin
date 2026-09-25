///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
// Test doubles for the pluggable interfaces this plugin's routes inject, registered with an `ObjectFactory` under the
// same names `@Inject("...")` resolves. Every integration test that boots the `test/server-mongo`/`test/server-sql`
// fixture apps registers these before `server.start()`, because `Server` instantiates every route it discovers.
import { Readable } from "stream";
import type {
    BlobPutOptions,
    BlobRange,
    BlobStore,
    CandidateResultPage,
    MailTransport,
    OutboundMessage,
    SearchProvider,
    SearchResultPage,
    TransportResult,
} from "@rapidmx/restapi";
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
 * A `BlobStore` that keeps every blob in memory, with the media type it was stored under. `failNextDelete` makes the next
 * `delete()` throw, so a test can prove a failed cleanup never fails the request that triggered it.
 */
export class InMemoryBlobStore implements BlobStore {
    public readonly blobs: Map<string, { data: Buffer; contentType?: string }> = new Map();
    public failNextDelete: boolean = false;

    public async put(key: string, data: Buffer | NodeJS.ReadableStream, options?: BlobPutOptions): Promise<void> {
        const buffer: Buffer = Buffer.isBuffer(data) ? data : Buffer.concat(await Readable.from(data as any).toArray());
        this.blobs.set(key, { data: buffer, contentType: options?.contentType });
    }

    public async get(key: string): Promise<Buffer> {
        const blob = this.blobs.get(key);
        if (!blob) {
            throw new Error(`No blob at ${key}`);
        }
        return blob.data;
    }

    public async getStream(key: string, range?: BlobRange): Promise<NodeJS.ReadableStream> {
        const data: Buffer = await this.get(key);
        return Readable.from(range ? data.subarray(range.start, range.end === undefined ? undefined : range.end + 1) : data);
    }

    public async delete(key: string): Promise<void> {
        if (this.failNextDelete) {
            this.failNextDelete = false;
            throw new Error("delete failed");
        }
        this.blobs.delete(key);
    }

    public async exists(key: string): Promise<boolean> {
        return this.blobs.has(key);
    }

    public async size(key: string): Promise<number> {
        return (await this.get(key)).length;
    }
}

/**
 * Registers the test doubles against `objectFactory`. Call this before `server.start()` in any integration test that
 * boots the fixture apps.
 */
/**
 * A `SearchProvider` that indexes nothing and finds nothing. `BaseScopedChildRoute` injects one (to drop a purged entity from the
 * search index), but this plugin's entities are never indexed, so the routes only need one to exist.
 */
export class NoopSearchProvider implements SearchProvider {
    public readonly name: string = "noop";

    public async index(): Promise<void> {
        // Nothing is indexed.
    }

    public async bulkIndex(docs: { entityUid: string }[]): Promise<string[]> {
        return docs.map((doc) => doc.entityUid);
    }

    public async remove(): Promise<void> {
        // Nothing was indexed, so there is nothing to remove.
    }

    public async search(): Promise<SearchResultPage> {
        return { results: [] };
    }

    public async candidates(): Promise<CandidateResultPage> {
        return { candidates: [] };
    }
}

export function registerTestDoubles(objectFactory: ObjectFactory): void {
    objectFactory.register(RecordingMailTransport, "MailTransport");
    objectFactory.register(InMemoryBlobStore, "BlobStore");
    objectFactory.register(NoopSearchProvider, "SearchProvider");
}
