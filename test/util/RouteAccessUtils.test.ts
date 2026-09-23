///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { stripTrustedRoles } from "../../src/util/RouteAccessUtils.js";

describe("stripTrustedRoles", () => {
    it("returns undefined unchanged", () => {
        expect(stripTrustedRoles(undefined, ["admin"])).toBeUndefined();
    });

    it("returns the same user reference when none of its roles are trusted", () => {
        const user: any = { uid: "u1", roles: ["support"], scopes: [], elevated: -1 };
        expect(stripTrustedRoles(user, ["admin"])).toBe(user);
    });

    it("returns the same reference when roles is not an array", () => {
        const user: any = { uid: "u1", roles: undefined, scopes: [], elevated: -1 };
        expect(stripTrustedRoles(user, ["admin"])).toBe(user);
    });

    it("strips a trusted role and forces elevated to -1, keeping every other role and field", () => {
        const user: any = { uid: "u1", roles: ["admin", "support"], scopes: ["s1"], elevated: 12345 };
        expect(stripTrustedRoles(user, ["admin"])).toEqual({ uid: "u1", roles: ["support"], scopes: ["s1"], elevated: -1 });
    });

    it("recognizes an org-prefixed trusted role (<orgUid>.<role>)", () => {
        const user: any = { uid: "u1", roles: ["org123.admin"], scopes: [], elevated: 5 };
        expect(stripTrustedRoles(user, ["admin"])).toEqual({ uid: "u1", roles: [], scopes: [], elevated: -1 });
    });

    it("strips every configured trusted role, not just the first match", () => {
        const user: any = { uid: "u1", roles: ["admin", "support-lead"], scopes: [], elevated: 1 };
        expect(stripTrustedRoles(user, ["admin", "support-lead"])).toEqual({ uid: "u1", roles: [], scopes: [], elevated: -1 });
    });
});
