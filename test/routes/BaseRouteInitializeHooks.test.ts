///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
// Unit tests for the single `@Init` hook of each route, which builds each model repository once through the
// ObjectFactory instead of lazily inside the handlers.
import { RepoUtils } from "@rapidrest/service-core";
import { BaseBookingProfileRoute } from "../../src/routes/BaseBookingProfileRoute.js";
import { BaseBookingRoute } from "../../src/routes/BaseBookingRoute.js";
import { BaseBookingTypeRoute } from "../../src/routes/BaseBookingTypeRoute.js";

/** A uniquely named stand-in model class. */
function model(name: string): any {
    return { [name]: class {} }[name];
}

class TestProfileRoute extends (BaseBookingProfileRoute as any) {
    protected bookingProfileClass: any = model("ProfileModel");
    protected mailboxClass: any = model("MailboxModel");
}
class TestBookingRoute extends (BaseBookingRoute as any) {
    protected bookingTypeClass: any = model("BookingTypeModel");
    protected bookingClass: any = model("BookingModel");
    protected bookingProfileClass: any = model("ProfileModel");
    protected calendarEventClass: any = model("CalendarEventModel");
    protected folderClass: any = model("FolderModel");
    protected mailboxClass: any = model("MailboxModel");
    protected messageClass: any = model("MessageModel");
}
class TestBookingTypeRoute extends (BaseBookingTypeRoute as any) {
    protected folderClass: any = model("FolderModel");
    protected bookingClass: any = model("BookingModel");
}

type Case = { name: string; hook: string; make: () => any; repos: [string, string][] };

const cases: Case[] = [
    { name: "BaseBookingProfileRoute", hook: "initialize", make: () => new TestProfileRoute(), repos: [["profileRepo", "bookingProfileClass"], ["mailboxRepo", "mailboxClass"]] },
    {
        name: "BaseBookingRoute",
        hook: "initialize",
        make: () => new TestBookingRoute(),
        repos: [
            ["bookingTypeRepo", "bookingTypeClass"],
            ["bookingRepo", "bookingClass"],
            ["bookingProfileRepo", "bookingProfileClass"],
            ["calendarEventRepo", "calendarEventClass"],
            ["folderRepo", "folderClass"],
            ["messageRepo", "messageClass"],
            ["mailboxRepo", "mailboxClass"],
        ],
    },
    { name: "BaseBookingTypeRoute", hook: "initBookingTypeRepos", make: () => new TestBookingTypeRoute(), repos: [["folderRepo", "folderClass"], ["bookingRepo", "bookingClass"]] },
];

function withFactory(route: any): any {
    const factory: any = { newInstance: vi.fn(async (type: any, opts: any) => ({ type, opts })) };
    Object.defineProperty(route, "_objectFactory", { value: factory, writable: true, configurable: true });
    return factory;
}

describe.each(cases)("$name $hook()", ({ hook, make, repos }) => {
    it("throws when the objectFactory is not set", async () => {
        const route: any = make();
        await expect(route[hook]()).rejects.toThrow("objectFactory is not set.");
    });

    it("builds each repo once through the factory", async () => {
        const route: any = make();
        const factory = withFactory(route);
        await route[hook]();
        expect(factory.newInstance).toHaveBeenCalledTimes(repos.length);
        for (const [field, classField] of repos) {
            const cls = route[classField];
            expect(factory.newInstance).toHaveBeenCalledWith(RepoUtils, { name: cls.name, args: [cls] });
            expect(route[field]).toEqual({ type: RepoUtils, opts: { name: cls.name, args: [cls] } });
        }
    });

    it("does not rebuild a repo that is already set", async () => {
        const route: any = make();
        const factory = withFactory(route);
        const preset: any[] = repos.map(([field]) => (route[field] = { preset: field }));
        await route[hook]();
        expect(factory.newInstance).not.toHaveBeenCalled();
        repos.forEach(([field], i) => expect(route[field]).toBe(preset[i]));
    });

    it("skips a repo whose class is unset", async () => {
        const route: any = make();
        const factory = withFactory(route);
        for (const [, classField] of repos) {
            route[classField] = undefined;
        }
        await route[hook]();
        expect(factory.newInstance).not.toHaveBeenCalled();
        for (const [field] of repos) {
            expect(route[field]).toBeUndefined();
        }
    });
});
