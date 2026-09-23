///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
///////////////////////////////////////////////////////////////////////////////
import { describe, expect, it } from "vitest";
import { locationSummary } from "../../../apps/book/_locationSummary.js";
import { BookingLocationType } from "../../../apps/shared/bookingApi.js";

describe("locationSummary() Tests", () => {
    it("Summarizes a phone booking with the booker's own number.", () => {
        expect(
            locationSummary({
                locationType: BookingLocationType.PHONE,
                bookerPhone: "555-123-4567",
            } as any),
        ).toBe("Phone: we'll call you at 555-123-4567.");
    });

    it("Summarizes a video booking that already has a meeting link.", () => {
        expect(
            locationSummary({
                locationType: BookingLocationType.VIDEO,
                locationVideoUrl: "https://meet.example.com/ada",
            } as any),
        ).toBe("Video call: https://meet.example.com/ada");
    });

    it("Summarizes a video booking with no meeting link yet.", () => {
        expect(locationSummary({ locationType: BookingLocationType.VIDEO } as any)).toBe(
            "Video call: the meeting link will be shared with you before the meeting.",
        );
    });

    it("Summarizes an 'other' booking with the booker's free-text instructions.", () => {
        expect(
            locationSummary({
                locationType: BookingLocationType.OTHER,
                bookerLocationInstructions: "Meet at the north entrance.",
            } as any),
        ).toBe("Other: Meet at the north entrance.");
    });

    it("Prefers the booking's own snapshotted label over the location type's default one.", () => {
        expect(
            locationSummary({
                locationType: BookingLocationType.PHONE,
                locationLabel: "Mobile",
                bookerPhone: "555-123-4567",
            } as any),
        ).toBe("Mobile: we'll call you at 555-123-4567.");
    });
});
