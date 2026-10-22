---
name: project_directus_autoscaling_models
description: Vertical / horizontal / hybrid autoscaling — why this fork's autoscaler is the hybrid (processes-in-one-cgroup) kind, and why its logic cannot be ported to Railway replicas or Kubernetes HPA
metadata:
  author: Jean Claveau
  type: project
---

Settled 2026-09-10 while reviewing whether `api/src/autoscale` could be made
supervisor-independent. Do not re-explore.

## The three models

| model | what it adds | who owns it here |
| --- | --- | --- |
| **vertical** | more CPU/RAM for the same process or container | Railway plan / cgroup limits |
| **horizontal** | more replicas, pods, containers | Railway replica count |
| **hybrid** | more **OS processes inside ONE container's fixed budget** | this fork's autoscaler |

The fork's autoscaler is the **hybrid** one, and only that one.

## Why hybrid exists at all

A Node worker is single-threaded, so one worker consumes at most one core. On an
N-core cgroup a single worker caps at `100/N` % of the container. Scaling
*processes* is what converts idle cgroup cores into concurrency — nothing else
in the stack does.

- **Signal:** per-worker CPU percent where 100% = one core, read from
  `/proc/<pid>/stat` over a window the autoscaler owns, never pm2's `cpu`
  ([[project_directus_pm2_cpu_delta_window]]). `max` or `average` across mature
  workers.
- **Capacity model: a fixed pie, subdivided.** Past the core count another
  worker adds contention, not capacity; `maxWorkers` is bounded by the cgroup
  CPU quota.

## Why the logic does NOT port to Kube HPA or Railway replicas

HPA is the inverse model: utilization is measured against the pod's **own
request**, and adding a pod allocates a **new** pie from the cluster. "Per-worker
CPU at 70%" has no analogue there. Everything downstream breaks with it:

- **Measurements absent.** `pendingWorkers` comes from pm2 holding a worker at
  `launching` until `wait_ready` — a message; Kube has a *polled* readiness
  probe. `restartsByWorker` is per-worker keyed by pm id; container restarts are
  a different event. No `/proc` access to another pod.
- **Constants off by an order of magnitude.** `warmupSeconds: 8` and
  `minSecondsToScaleUp: 10` are sized against a measured ~3.26 s
  fork→listening; pod scheduling is tens of seconds and can fail to schedule at
  all. A 30x1 s window is noise at that timescale.
- **Actuation differs.** `scaleTo(name, n)` is absolute, idempotent, immediate,
  local. Patching `replicas` is a request the scheduler may not satisfy, and
  release means graceful drain behind a load balancer, not SIGINT +
  `killTimeout`.
- **The `legacy` strategy's brake is `freemem()` of the host** — meaningless
  across a cluster.
- **Running both oscillates.** The process autoscaler raises the pod's CPU
  utilization *by using idle cores* — which is exactly HPA's scale-up signal.
  HPA adds pods, each boots at `minWorkers`, utilization drops, HPA scales down.
  Two loops fighting over one number.

**On Kubernetes the honest answer is to set `instances` to the core count and
let HPA own replicas — not to run this loop.**

## What would port, and the invariant

Only the scaffolding: windowed smoothing, split up/down cooldowns for
hysteresis, warm-up exclusion from the statistic, last-good-config hold across a
Redis outage, the fleet-wide shared config with its audit stamp, the panel. The
*decision* is bound to the capacity model.

**Invariant a second supervisor implementation must satisfy:** it manages OS
processes sharing **one host/cgroup budget**, and the question is how many to
run inside it. That admits node `cluster` without pm2 (same model, same signal,
same constants — cost is rebuilding the `wait_ready` handshake, since
`pendingWorkers` depends on it) and a fake supervisor for tests. It does **not**
admit Railway replicas or Kube; those would be a *different* autoscaler sharing
only the config-and-panel plumbing.

## Type-level state of play

- `AutoscaleConfig` (13 fields) is **already supervisor-agnostic** — not one pm2
  field; `appName` is just a pool name.
- `AutoscaleSupervisor` is a pure pm2 declaration (`execMode`, `waitReady`,
  `listenTimeout`, `killTimeout`, `minUptime`, `maxRestarts`, `restartDelay`,
  `autorestart`, `maxMemoryRestart`) and is on the wire, in the published OAS and
  in the MCP tools. **Leave it pm2-shaped** until something concrete needs
  otherwise — narrowing it speculatively costs a published-contract change for a
  supervisor nobody has asked for.

Related: [[project_directus_pr456_autoscaler_design]],
[[project_directus_pr467_autoscale_config_surface]],
[[project_directus_pm2_autoscale_ramp_measured]],
[[project_directus_planner_deploy_shape]],
[[project_directus_worker_ram_shape]].
