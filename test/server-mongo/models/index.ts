// Re-exports the `@rapidmx/restapi` model classes the booking routes read and write, so the test Server's ClassLoader
// (rooted at `test/server-mongo`) can discover their `@DataStore` metadata alongside the test routes that use them.
// Deliberately a named (not wildcard) re-export: `@rapidmx/restapi/mongo` bundles routes and jobs alongside its models,
// and a wildcard re-export would make the ClassLoader discover and start every one of them too.
export { CalendarEventMongo, FolderMongo, MailboxMongo, MessageMongo } from "@rapidmx/restapi/mongo";
// This plugin's own models.
export { BookingTypeMongo } from "../../../src/models/mongo/BookingTypeMongo.js";
export { BookingMongo } from "../../../src/models/mongo/BookingMongo.js";
export { BookingProfileMongo } from "../../../src/models/mongo/BookingProfileMongo.js";
// `@rapidmx/meet-plugin`'s own models, for real end-to-end coverage of the optional video meeting
// integration (`BaseBookingRoute.maybeCreateVideoMeetingJoinUrl()`) - see `bookingVideoconfIntegrationSuite.ts`.
// Named, not wildcard, for the same reason as the restapi re-export above.
export { VideoMeetingMongo, VideoMeetingInviteeMongo } from "@rapidmx/meet-plugin/mongo";
