///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
// Shared nconf defaults for the two test config variants (`config.ts` for Mongo-backed test suites,
// `config.sql.ts` for SQL-backed ones) - kept as a single factory so a config key added for one variant
// (e.g. a new job's schedule/batch_size) can't silently drift out of sync with the other.

/**
 * Builds the full nconf defaults object for a test run, parameterized only by which `datastores` are
 * configured - everything else is identical between the Mongo and SQL test variants.
 *
 * @param datastores The `datastores` block to use - the two variants differ only in whether `acl`/the primary
 * entity datastore are MongoDB- or SQL-backed, and whether a `mongo` datastore is present at all.
 */
export function buildTestConfigDefaults(datastores: Record<string, any>) {
    return {
        service_name: "mail_test_service",
        version: "1.0",
        // Set explicitly (rather than relying on Server's default of 3000) so the test suite never silently
        // collides with an unrelated process already listening on the default port in a developer's environment.
        port: 3848,
        cookie_secret: "f0fLSKFJLKWJFe09f32joff098u2fOFIWJ32890fnfnlak",
        cors: {
            origins: ["http://localhost:3000"],
        },
        datastores,
        // Specifies the group names that are considered to be trusted with administrative privileges.
        trusted_roles: ["admin"],
        // Settings pertaining to the signing and verification of authentication tokens
        auth: {
            strategy: "auth.JWTStrategy",
            allowQueryParam: true,
            secret: "MyPasswordIsSecure",
            options: {
                expiresIn: "7 days",
                audience: "mydomain.com",
                issuer: "api.mydomain.com",
            },
        },
        rbac: {
            enabled: true,
        },
        session: {
            secret: "SessionsHaveSecrets",
        },
        cluster_url: "http://localhost",
        metrics: {
            authRequired: false,
        },
        // Read by `RateLimiter` (see `@rapidrest/service-core`), which backs the `@RateLimit()` decorator on
        // `BaseBookingRoute`'s mutating endpoints and its own booking and slot checks. The framework's own defaults (5
        // attempts / 5 minutes) are tuned for credential endpoints and are far too tight for appointment booking - a
        // single visitor correcting a typo would trip them. Raised here for the same reason a real deployment exposing
        // those routes has to raise them, and deliberately not disabled outright so the limits stay exercised.
        rateLimit: {
            enabled: true,
            maxAttempts: 1000,
            windowSeconds: 300,
            ip: {
                enabled: true,
                maxAttempts: 5000,
                windowSeconds: 300,
            },
        },
        mail: {
            booking: {
                public_url: "https://bookings.rapidmx-test.example.com",
            },
            // Read by `@rapidmx/videoconf-plugin`'s own `createSingleInviteeVideoMeeting()` (see
            // `BaseBookingRoute.maybeCreateVideoMeetingJoinUrl()`) when that optional plugin is installed and
            // active - matching its own test suite's identical value for `mail:videoconf:public_url`.
            videoconf: {
                public_url: "https://videoconf.rapidmx-test.example.com/meet",
            },
        },
    };
}

/**
 * The `sql` datastore's TypeORM config shared by both variants (the SQL-backed ACL variant also uses this
 * shape, just under the `acl` key with a distinct `database` file).
 *
 * `invalidWhereValuesBehavior: { null: "sql-null" }` matches the configuration `@rapidmx/restapi` requires of a SQL
 * deployment, where a literal `{ field: null }` query means `IS NULL` rather than an error.
 */
export function sqlDatastoreConfig(database: string) {
    return {
        type: "better-sqlite3",
        host: "localhost",
        database,
        synchronize: true,
        invalidWhereValuesBehavior: { null: "sql-null" },
    };
}
