#!/usr/bin/env node

// The upstream version check used to run here, awaited, before the API was even
// imported: an HTTPS GET to registry.npmjs.org/directus on every worker start —
// deploy, autoscale spawn, nightly restart — for 240-400 ms warm, or its full 8 s
// timeout when egress is blocked, silently (the error is swallowed). It compared
// this fork's version against upstream's `latest`, which is on the 12.x line we
// deliberately do not track, so it only ever advertised an upgrade we will not take.
//
// `@directus/update-check` stays in the workspace: the check belongs on an admin
// page, asked for on demand, not on the boot path of every process.
// https://github.com/jclaveau/directus/issues/433
import('@directus/api/cli/run.js');
