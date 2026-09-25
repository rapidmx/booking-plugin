// A minimal twin of `test/server-sql/models/index.ts`, deliberately WITHOUT the `@rapidmx/meet-plugin/sql`
// re-export: `BookingRouteVideoconfImportFailure.test.ts` (the only consumer of this fixture) mocks that exact
// module specifier to simulate its dynamic import genuinely failing, and the real, unmocked `models/index.ts`
// statically (if indirectly, via the ClassLoader scanning this whole directory tree) imports it for real DB
// entity registration - which would evaluate the mock's throwing factory at server startup, before any test even
// runs, rather than only when `BaseBookingRoute.importVideoconfBackend()`'s own dynamic `import()` reaches it.
export { CalendarEventSQL, FolderSQL, MailboxSQL, MessageSQL } from "@rapidmx/restapi/sql";
export { BookingTypeSQL } from "../../../src/models/sql/BookingTypeSQL.js";
export { BookingSQL } from "../../../src/models/sql/BookingSQL.js";
export { BookingProfileSQL } from "../../../src/models/sql/BookingProfileSQL.js";
