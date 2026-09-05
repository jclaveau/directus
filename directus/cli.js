#!/usr/bin/env node
import module from 'node:module';

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

// Boot is ~87% module loading — 4369 modules and 23 MB of source parsed before the
// server answers anything — so caching V8's bytecode is worth more here than the
// usual. It has to run before the import below, which is why that one is dynamic.
//
// The first worker after a deploy populates the cache and the rest read it, which
// is exactly how PM2 scales: one worker at a time, each waiting for the last to
// report ready. Node keys entries by file content and its own version, so a stale
// one cannot be served. `NODE_COMPILE_CACHE` moves the directory and
// `NODE_DISABLE_COMPILE_CACHE=1` turns it off — no fork-specific knob needed.
// Optional call: it landed in node 22.1 and package.json asks for node 22.
module.enableCompileCache?.();

import('@directus/api/cli/run.js');
