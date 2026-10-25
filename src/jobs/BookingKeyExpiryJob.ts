///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { ObjectDecorators } from "@rapidrest/core";
import { BackgroundService, ObjectFactory, RepoUtils } from "@rapidrest/service-core";
import type { Booking } from "../models/types.js";
const { Config, Init, Logger } = ObjectDecorators;

/** The most bookings one run discards. */
const BATCH = 200;

/**
 * Discards the booker's side of each protected booking whose `keyExpiresAt` has passed (meet-plugin `specs/meeting_privacy.md` §8): the
 * booker's sealed copy of what they wrote, the booking key's certificate and its wrap. The host's sealed copy is kept. Idempotent: a
 * booking is marked `keyDiscardedAt` and never selected again, and every replica may run it.
 */
export abstract class BookingKeyExpiryJob extends BackgroundService {
    protected abstract bookingClass: any;

    // Automatically injected by ObjectFactory on instantiation
    private _objectFactory?: ObjectFactory;

    protected bookingRepo?: RepoUtils<Booking>;

    /** The most bookings one run looks at. */
    protected batchSize: number = BATCH;

    @Config("mail:booking:key_expiry:schedule", "0 */5 * * * *")
    private scheduleExpr: string = "0 */5 * * * *";

    @Logger
    protected logger: any;

    public get schedule(): string | undefined {
        return this.scheduleExpr;
    }

    @Init
    protected async initialize(): Promise<void> {
        if (!this._objectFactory) {
            throw new Error("objectFactory is not set.");
        }
        this.bookingRepo ??= await this._objectFactory.newInstance(RepoUtils, { name: this.bookingClass.name, args: [this.bookingClass] });
    }

    public start(): void {
        // Processing happens entirely in `run()`.
    }

    public stop(): void {
        // Nothing to release.
    }

    public async run(): Promise<void> {
        const now: number = Date.now();
        // Selected by flag, soonest expiry first, and filtered by time here, as in meet-plugin's `MeetingKeyExpiryJob`: every booking after
        // the first unexpired one expires later still, so the run stops there, and bookings far ahead can never keep an expired one out.
        const held: Booking[] = await this.bookingRepo!.find(
            { keyProtected: true, keyDiscardedAt: null, sort: { keyExpiresAt: "ASC", uid: "ASC" }, limit: this.batchSize } as any,
            { ignoreACL: true, limit: this.batchSize, skipCache: true },
        );
        for (const booking of held) {
            if (!booking.keyExpiresAt) {
                continue;
            }
            if (new Date(booking.keyExpiresAt).valueOf() > now) {
                break;
            }
            try {
                await this.bookingRepo!.update(
                    {
                        uid: booking.uid,
                        version: (booking as any).version,
                        guestSealedFields: null,
                        meetingKeyCertificate: null,
                        keyWraps: null,
                        keyDiscardedAt: new Date(),
                    },
                    booking,
                    { ignoreACL: true },
                );
            } catch (err: any) {
                // Changed meanwhile, or the store is unavailable: the next run takes it again.
                this.logger?.warn(`BookingKeyExpiryJob: couldn't discard the key of booking ${booking.uid} yet: ${err?.message ?? err}`);
            }
        }
    }
}
