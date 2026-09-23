///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { UserUtils, type JWTUser } from "@rapidrest/core";

/**
 * A small, self-contained copy of `@rapidmx/restapi`'s internal `util/MailAccessUtils.ts` (`stripTrustedRoles()`/
 * `isTrustedRole()`) - the version of `@rapidmx/restapi` this package is actually pinned to (see `package.json`'s
 * `resolutions`/`yarn.lock`, `^0.12.0`) predates that module entirely, and even a later one that has it doesn't
 * export it from the package's public surface (a plugin can only import what `src/index.ts` re-exports). A plugin
 * that wants the same "no role widens access" posture for a mailbox-scoped entity has to reimplement it rather
 * than reuse it - `@rapidmx/meet-plugin`'s own `src/util/RouteAccessUtils.ts` does the identical thing, for the
 * identical reason.
 *
 * **Why this exists.** `@rapidrest/service-core`'s `ACLUtils.hasPermission()` answers `true` for any caller
 * holding a trusted role ("trusted users always have permission") - the right behavior for administering the
 * platform, the wrong one for a person's private mail data, booking links and bookings included. Every one of this
 * package's own hand-rolled mailbox-permission checks (`BaseBookingProfileRoute.requireMailboxPermission()`,
 * `BaseBookingRoute.requireMailboxPermission()`, `BaseBookingTypeRoute.requireBookableFolder()`) therefore never
 * hands `aclUtils.hasPermission()` the caller as given; it always strips trusted roles first via
 * `stripTrustedRoles()` below, so a mailbox is reachable only by its owner or an explicit delegate - the same rule
 * `@rapidmx/restapi` itself now applies to every mailbox-scoped route via its own (differently-named, not
 * reusable here) `MailAccessUtils.ts`.
 */

/** Whether `role` is one of `trustedRoles` - as itself or org-prefixed (`<orgUid>.<role>`), the form
 * `UserUtils.hasRole()` also accepts. */
function isTrustedRole(role: string, trustedRoles: readonly string[]): boolean {
    return trustedRoles.some((trusted) => role === trusted || role.endsWith(`.${trusted}`));
}

/**
 * `user` without its trusted roles (and without its elevation), for handing to code that would otherwise treat
 * the caller as a superuser: `ACLUtils.hasPermission()`, `RepoUtils` with `{ user }` and no `ignoreACL`. Everything
 * else about the identity - uid, other roles, scopes - is unchanged, so an owner or delegate record still
 * matches. Returns `user` itself when it has nothing to strip.
 */
export function stripTrustedRoles(user: JWTUser | undefined, trustedRoles: readonly string[]): JWTUser | undefined {
    if (!user || !Array.isArray(user.roles) || !user.roles.some((role) => isTrustedRole(role, trustedRoles))) {
        return user;
    }
    return { ...user, roles: user.roles.filter((role) => !isTrustedRole(role, trustedRoles)), elevated: -1 };
}
