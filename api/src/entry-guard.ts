import { guardUnhandledRejections } from './utils/report-unhandled-rejection.js';

// Taken by importing this module rather than by a call in an entry point's
// body: a module body runs only once its whole import graph has been
// evaluated, and the graph is already long enough for the first rejection to
// arrive inside it. Building the CLI loads the extensions, which subscribe
// over the bus without awaiting it, and an unreachable Redis rejects that
// subscription once the client stops retrying — before any statement of the
// entry point has run. Every entry imports this first.
guardUnhandledRejections();
