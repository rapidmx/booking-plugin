///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
// The plugin contract: a server host registers every export of `./mongo`/`./sql` and mounts, connects or starts it, so
// each entry point must export only ready routes and models, and package.json must carry a valid manifest whose UI apps
// point at directories this package actually ships.
import "reflect-metadata";
import fs from "fs";
import { BackgroundService, PersistenceDecorators } from "@rapidrest/service-core";
import { isMailboxScopedData, parsePluginManifest } from "@rapidmx/restapi";
import * as RootEntry from "../src/index.js";
import * as MongoEntry from "../src/mongo.js";
import * as SqlEntry from "../src/sql.js";

function describeExport(clazz: any): string {
    if (Reflect.getMetadata("rrst:routePaths", clazz.prototype)) {
        return `route ${Reflect.getMetadata("rrst:routePaths", clazz.prototype).join(",")}`;
    }
    if (Reflect.getMetadata("rrst:datasource", clazz)) {
        return `model ${Reflect.getMetadata("rrst:datasource", clazz)}${isMailboxScopedData(clazz) ? " mailbox-scoped" : ""}`;
    }
    if (clazz.prototype instanceof BackgroundService) {
        return "job";
    }
    return "other";
}

const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));

describe("plugin entry points", () => {
    it.each([
        ["mongo", MongoEntry, "Mongo", "mongo"],
        ["sql", SqlEntry, "SQL", "sql"],
    ])("./%s exports only the mounted routes and the mailbox-scoped models", (_name, entry, suffix, datastore) => {
        expect(Object.fromEntries(Object.entries(entry).map(([name, clazz]) => [name, describeExport(clazz)]))).toEqual({
            [`BookingTypeRoute${suffix}`]: "route /api/mail/booking-types",
            [`BookingRoute${suffix}`]: "route /api/mail/bookings",
            [`BookingType${suffix}`]: `model ${datastore} mailbox-scoped`,
            [`Booking${suffix}`]: `model ${datastore} mailbox-scoped`,
        });
    });

    it("keeps the collection names, index names and ACL uids of the models core used to define", () => {
        const bookingTypeIndexes: string[] = ["bookingtype_slug", "bookingtype_mailbox"];
        const bookingIndexes: string[] = ["booking_manage_token", "booking_type", "booking_mailbox"];
        for (const [clazz, entityName, acl, indexes] of [
            [MongoEntry.BookingTypeMongo, "booking_type_mongo", "BookingType", bookingTypeIndexes],
            [MongoEntry.BookingMongo, "booking_mongo", "Booking", bookingIndexes],
            [SqlEntry.BookingTypeSQL, "booking_type_sql", "BookingType", bookingTypeIndexes],
            [SqlEntry.BookingSQL, "booking_sql", "Booking", bookingIndexes],
        ] as const) {
            expect(Reflect.getMetadata("rrst:entityName", clazz)).toBe(entityName);
            expect(Reflect.getMetadata("rrst:classACL", clazz).uid).toBe(acl);
            expect(PersistenceDecorators.getIndexMetadata(clazz).map((index: any) => index.name)).toEqual(expect.arrayContaining(indexes));
        }
    });

    it("exports the backend-agnostic surface from the package root", () => {
        expect(Object.keys(RootEntry).sort()).toEqual(
            [
                "BaseBookingRoute",
                "BaseBookingTypeRoute",
                "BookingStatus",
                "MAX_AVAILABILITY_WINDOWS",
                "MAX_BOOKING_WINDOW_DAYS",
                "MAX_DATE_OVERRIDES",
                "MAX_SLOTS_PER_RESPONSE",
                "MIN_SLOT_MINUTES",
                "generateCandidateSlots",
                "normalizeSlug",
                "subtractBusy",
                "validateAvailability",
            ].sort(),
        );
    });
});

describe("plugin manifest", () => {
    it("declares a valid plugin manifest", () => {
        const manifest = parsePluginManifest(pkg);
        expect(typeof manifest).toBe("object");
        expect(manifest).toEqual(expect.objectContaining({ displayName: "Booking pages", mailboxScopedData: true }));
    });

    it("declares the public booking URL setting, empty by default", () => {
        const manifest: any = parsePluginManifest(pkg);
        expect(manifest.settings).toEqual([expect.objectContaining({ key: "mail:booking:public_url", type: "string", default: "" })]);
    });

    it("declares the booking pages and the Booking Links settings screen", () => {
        const manifest: any = parsePluginManifest(pkg);
        expect(manifest.ui.apps).toEqual([
            { id: "book", host: "public", mount: "/book", dir: "apps/book" },
            { id: "booking-types", host: "www", mount: "/settings/booking-types", dir: "apps/settings-booking-types" },
        ]);
        expect(manifest.ui.settingsSections).toEqual([
            { id: "booking-types", label: "Booking Links", href: "/settings/booking-types", icon: "HiOutlineCalendarDays" },
        ]);
    });

    it("ships every UI app's sources, with a layout, in the package", () => {
        expect(pkg.files).toEqual(expect.arrayContaining(["apps", "dist"]));
        for (const app of pkg.rapidmx.plugin.ui.apps) {
            expect(fs.existsSync(new URL(`../${app.dir}/_layout.tsx`, import.meta.url))).toBe(true);
            expect(fs.existsSync(new URL(`../${app.dir}/index.tsx`, import.meta.url))).toBe(true);
        }
    });
});
