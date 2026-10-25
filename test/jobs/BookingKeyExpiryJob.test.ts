///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
// `BookingKeyExpiryJob`'s paths the route suites (`test/routes/bookingProtectionSuite.ts`) don't reach.
import "reflect-metadata";
import { describe, expect, it, vi } from "vitest";
import { BookingKeyExpiryJobMongo } from "../../src/jobs/mongo/BookingKeyExpiryJobMongo.js";

describe("BookingKeyExpiryJob (isolated)", () => {
    it("can't be initialized without an ObjectFactory, runs every five minutes, and has no-op lifecycle hooks", async () => {
        const job: any = new BookingKeyExpiryJobMongo();
        await expect(job.initialize()).rejects.toThrow("objectFactory is not set.");
        expect(job.schedule).toBe("0 */5 * * * *");
        expect(job.start()).toBeUndefined();
        expect(job.stop()).toBeUndefined();
    });

    it("skips a booking without an expiry, and logs one it couldn't discard yet", async () => {
        const job: any = new BookingKeyExpiryJobMongo();
        job.logger = { warn: vi.fn() };
        job.bookingRepo = {
            find: vi.fn().mockResolvedValue([{ uid: "b0" }, { uid: "b1", keyExpiresAt: new Date(Date.now() - 1000) }]),
            update: vi.fn().mockRejectedValue(new Error("version")),
        };
        await job.run();
        expect(job.bookingRepo.update).toHaveBeenCalledTimes(1);
        expect(job.logger.warn).toHaveBeenCalledWith(expect.stringContaining("couldn't discard the key of booking b1 yet: version"));
    });

    it("takes the soonest expiry first and stops at the first booking that hasn't expired", async () => {
        const job: any = new BookingKeyExpiryJobMongo();
        const past = new Date(Date.now() - 1000);
        job.bookingRepo = {
            find: vi.fn().mockResolvedValue([{ uid: "b1", keyExpiresAt: past }, { uid: "b2", keyExpiresAt: new Date(Date.now() + 60_000) }, { uid: "b3", keyExpiresAt: past }]),
            update: vi.fn().mockResolvedValue({}),
        };
        await job.run();
        expect(job.bookingRepo.find).toHaveBeenCalledWith(expect.objectContaining({ sort: { keyExpiresAt: "ASC", uid: "ASC" }, limit: 200 }), expect.objectContaining({ limit: 200 }));
        expect(job.bookingRepo.update.mock.calls.map(([patch]: any[]) => patch.uid)).toEqual(["b1"]);
    });
});
