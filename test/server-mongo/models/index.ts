// Re-exports the `@rapidmx/restapi` model classes the booking routes read and write, so the test Server's ClassLoader
// (rooted at `test/server-mongo`) can discover their `@DataStore` metadata alongside the test routes that use them.
// Deliberately a named (not wildcard) re-export: `@rapidmx/restapi/mongo` bundles routes and jobs alongside its models,
// and a wildcard re-export would make the ClassLoader discover and start every one of them too.
export { CalendarEventMongo, FolderMongo, MailboxMongo } from "@rapidmx/restapi/mongo";
// This plugin's own models.
export { BookingTypeMongo } from "../../../src/models/mongo/BookingTypeMongo.js";
export { BookingMongo } from "../../../src/models/mongo/BookingMongo.js";
