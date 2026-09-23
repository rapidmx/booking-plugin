// Re-exports the `@rapidmx/restapi` model classes the booking routes read and write, so the test Server's ClassLoader
// (rooted at `test/server-sql`) can discover their `@DataStore` metadata alongside the test routes that use them.
// Deliberately a named (not wildcard) re-export: `@rapidmx/restapi/sql` bundles routes and jobs alongside its models,
// and a wildcard re-export would make the ClassLoader discover and start every one of them too.
export { CalendarEventSQL, FolderSQL, MailboxSQL } from "@rapidmx/restapi/sql";
// This plugin's own models.
export { BookingTypeSQL } from "../../../src/models/sql/BookingTypeSQL.js";
export { BookingSQL } from "../../../src/models/sql/BookingSQL.js";
export { BookingProfileSQL } from "../../../src/models/sql/BookingProfileSQL.js";
// `@rapidmx/meet-plugin`'s own models, for real end-to-end coverage of the optional video meeting
// integration (`BaseBookingRoute.maybeCreateVideoMeetingJoinUrl()`) - see `bookingVideoconfIntegrationSuite.ts`.
// Named, not wildcard, for the same reason as the restapi re-export above.
export { VideoMeetingSQL, VideoMeetingInviteeSQL } from "@rapidmx/meet-plugin/sql";
