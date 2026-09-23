// A minimal twin of `test/server-mongo/models/index.ts`, deliberately WITHOUT the `@rapidmx/meet-plugin/mongo`
// re-export: `BookingRouteVideoconfImportFailure.test.ts` (the only consumer of this fixture) mocks that exact
// module specifier to simulate its dynamic import genuinely failing, and the real, unmocked `models/index.ts`
// statically (if indirectly, via the ClassLoader scanning this whole directory tree) imports it for real DB
// collection registration - which would evaluate the mock's throwing factory at server startup, before any test
// even runs, rather than only when `BaseBookingRoute.importVideoconfBackend()`'s own dynamic `import()` reaches it.
export { CalendarEventMongo, FolderMongo, MailboxMongo } from "@rapidmx/restapi/mongo";
export { BookingTypeMongo } from "../../../src/models/mongo/BookingTypeMongo.js";
export { BookingMongo } from "../../../src/models/mongo/BookingMongo.js";
export { BookingProfileMongo } from "../../../src/models/mongo/BookingProfileMongo.js";
