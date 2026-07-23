import { describe, it, expect } from 'vitest'
import { compress, describeCompression } from '../support/harness.js'

// Characterization + behavioral suite for the docker handler, which owns two
// condensers dispatched by command name:
//   - condenseDocker  (cmd 'docker'):  build/buildx, ps, images, and a default
//     branch that only strips layer-transfer noise.
//   - condenseKubectl (cmd 'kubectl'): get pods (running/pending/failed rollup
//     + issue list) and get svc/ingress (compact table); default passthrough.
// Each case pairs a realistic raw output with assertions reflecting the
// condenser's PURPOSE, then the harness snapshots the exact bytes.

// ── docker build: classic builder pulling a base image, then caching layers ──
const DOCKER_BUILD = `Sending build context to Docker daemon  15.87MB
Step 1/8 : FROM node:18-alpine
18-alpine: Pulling from library/node
f1b5933fe4b5: Pulling fs layer
9b9b7f3d56a0: Waiting
f1b5933fe4b5: Verifying Checksum
f1b5933fe4b5: Download complete
9b9b7f3d56a0: Extracting [==================================================>]  3.145MB/3.145MB
9b9b7f3d56a0: Pull complete
Digest: sha256:9c8f7e6d5c4b3a29180f7e6d5c4b3a29180f7e6d5c4b3a29180f7e6d5c4b3a29
Status: Downloaded newer image for node:18-alpine
 ---> a1b2c3d4e5f6
Step 2/8 : WORKDIR /app
 ---> Using cache
 ---> b2c3d4e5f6a7
Step 3/8 : COPY package.json package-lock.json ./
 ---> Using cache
 ---> c3d4e5f6a7b8
Step 4/8 : RUN npm ci --production
 ---> Running in 9f8e7d6c5b4a
npm WARN deprecated har-validator@5.1.5: this library is no longer supported
added 214 packages in 8.3s
 ---> d4e5f6a7b8c9
Step 5/8 : COPY . .
 ---> e5f6a7b8c9d0
Step 6/8 : RUN npm run build
 ---> Running in 1a2b3c4d5e6f
> myapp@1.0.0 build
> tsc -p tsconfig.json
 ---> f6a7b8c9d0e1
Step 7/8 : EXPOSE 3000
 ---> Running in 2b3c4d5e6f70
 ---> 0a1b2c3d4e5f
Step 8/8 : CMD ["node", "dist/server.js"]
 ---> Running in 3c4d5e6f7081
 ---> 1b2c3d4e5f60
Successfully built 1b2c3d4e5f60
Successfully tagged myapp:latest
`

// ── docker build: BuildKit, the default builder since Docker 23 ──────────────
// One "#<step> ..." line per event: the step prefix on every line, an elapsed
// clock in front of every line a RUN step printed ("#7 13.02 "), a "DONE <dur>"
// sign-off per step, and the byte-shuffling echoes in between. The classic
// "Step k/n" + "--->" transcript below only appears under DOCKER_BUILDKIT=0.
//
// MEASURED, docker 29.4.1: the CLI writes this transcript to **stderr** and
// leaves stdout empty (`docker build --progress=plain . >out 2>err` -> out is
// 0 bytes, err is the whole log), so the proxy - which compresses stdout only -
// does not see it today. See the note on the matrix entry in
// test/matrix/infra.matrix.ts. The condenser is exercised here on the bytes
// themselves; nothing in this file claims the wrapper banks the saving.
const DOCKER_BUILD_BUILDKIT = `#0 building with "default" instance using docker driver

#1 [internal] load build definition from Dockerfile
#1 transferring dockerfile: 1.42kB done
#1 DONE 0.0s

#2 [internal] load metadata for docker.io/library/node:22-alpine
#2 DONE 0.7s

#3 [internal] load .dockerignore
#3 transferring context: 214B done
#3 DONE 0.0s

#4 [deps 1/4] FROM docker.io/library/node:22-alpine@sha256:8c2c4b7f1a5d0e93f4c6d9b2a7e1f0c3d5b8a9e2f4c7d1b6a3e0f9c2d5b8a1e4
#4 resolve docker.io/library/node:22-alpine@sha256:8c2c4b7f1a5d0e93f4c6d9b2a7e1f0c3d5b8a9e2f4c7d1b6a3e0f9c2d5b8a1e4 done
#4 sha256:b05093807bb0294152bb9cf86d64da722732dddaf7f8882fa1f120477dbc4db3 0B / 2.23MB 0.3s
#4 sha256:b05093807bb0294152bb9cf86d64da722732dddaf7f8882fa1f120477dbc4db3 2.23MB / 2.23MB 1.0s done
#4 [deps 1/4] FROM docker.io/library/node:22-alpine@sha256:8c2c4b7f1a5d0e93f4c6d9b2a7e1f0c3d5b8a9e2f4c7d1b6a3e0f9c2d5b8a1e4
#4 extracting sha256:b05093807bb0294152bb9cf86d64da722732dddaf7f8882fa1f120477dbc4db3 0.6s done
#4 DONE 1.9s

#5 [internal] load build context
#5 transferring context: 4.19MB 0.2s done
#5 DONE 0.3s

#6 [deps 2/4] WORKDIR /app
#6 CACHED

#7 [deps 4/4] RUN pnpm install --frozen-lockfile
#7 2.104 Lockfile is up to date, resolution step is skipped
#7 6.882 Packages: +812
#7 13.02 dependencies:
#7 13.02 + fastify 4.28.1
#7 13.71 Done in 13.4s
#7 DONE 14.1s

#8 exporting to image
#8 exporting layers
#8 exporting layers 2.1s done
#8 writing image sha256:9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b2a1f0e9d8c7b6a5f4e3d2c1b0a9f8e done
#8 naming to ghcr.io/acme/api-gateway:1.24.3 done
#8 DONE 2.2s
`

// ── docker build: BuildKit, a step that failed ───────────────────────────────
// The diagnosis is printed twice: once inline on the step, once again in the
// "------" trailer BuildKit appends. The trailer carries no "#N" prefix at all,
// so it is text the step grammar does not recognise - and must survive whole.
const DOCKER_BUILD_BUILDKIT_FAIL = `#9 [build 3/3] RUN pnpm run build
#9 0.612
#9 0.612 > api-gateway@1.24.3 build /app
#9 1.998 src/server.ts(42,7): error TS2322: Type 'string' is not assignable to type 'number'.
#9 2.104 ERROR: process "/bin/sh -c pnpm run build" did not complete successfully: exit code: 2
#9 ERROR: process "/bin/sh -c pnpm run build" did not complete successfully: exit code: 2
------
 > [build 3/3] RUN pnpm run build:
1.998 src/server.ts(42,7): error TS2322: Type 'string' is not assignable to type 'number'.
------
Dockerfile:18
ERROR: failed to solve: process "/bin/sh -c pnpm run build" did not complete successfully: exit code: 2
`

// ── docker build: BuildKit with two stages running in parallel ───────────────
// BuildKit interleaves the output of concurrent steps line by line, which is
// why the "#N" prefix cannot simply be deleted from the stream.
const DOCKER_BUILD_BUILDKIT_PARALLEL = `#12 [deps 3/3] RUN pnpm install
#12 1.204 Progress: resolved 812, reused 806
#13 [tools 2/2] RUN cargo build --release
#13 2.881 Compiling serde v1.0.203
#12 3.400 Packages: +812
#13 4.002 Compiling tokio v1.38.0
#12 DONE 5.1s
#13 DONE 9.7s
`

// ── docker ps: wide default table with 5 running containers ──
const DOCKER_PS = `CONTAINER ID   IMAGE                           COMMAND                  CREATED          STATUS                   PORTS                                        NAMES
a1b2c3d4e5f6   nginx:1.25-alpine               "/docker-entrypoint.…"   2 hours ago      Up 2 hours               0.0.0.0:80->80/tcp, :::80->80/tcp            web-frontend
b2c3d4e5f6a7   postgres:16                     "docker-entrypoint.s…"   3 hours ago      Up 3 hours (healthy)     5432/tcp                                     app-db
c3d4e5f6a7b8   redis:7-alpine                  "docker-entrypoint.s…"   3 hours ago      Up 3 hours               6379/tcp                                     app-cache
d4e5f6a7b8c9   myregistry.io/team/api:v2.3.1   "node dist/server.js"    45 minutes ago   Up 45 minutes            0.0.0.0:3000->3000/tcp                       api-service
e5f6a7b8c9d0   rabbitmq:3.12-management        "docker-entrypoint.s…"   1 day ago        Up 1 day                 4369/tcp, 5671-5672/tcp, 15691-15692/tcp     message-broker
`

// ── docker ps with nothing running: header only ──
const DOCKER_PS_EMPTY = `CONTAINER ID   IMAGE     COMMAND   CREATED   STATUS    PORTS     NAMES
`

// ── docker images: wide default table ──
const DOCKER_IMAGES = `REPOSITORY                     TAG           IMAGE ID       CREATED          SIZE
nginx                          1.25-alpine   a1b2c3d4e5f6   2 weeks ago      42.6MB
postgres                       16            b2c3d4e5f6a7   3 weeks ago      432MB
myregistry.io/team/api         v2.3.1        c3d4e5f6a7b8   45 minutes ago   198MB
redis                          7-alpine      d4e5f6a7b8c9   1 month ago      41.4MB
<none>                         <none>        e5f6a7b8c9d0   2 months ago     1.12GB
node                           18-alpine     f6a7b8c9d0e1   2 months ago     176MB
`

// ── docker images with no images: header only ──
const DOCKER_IMAGES_EMPTY = `REPOSITORY   TAG       IMAGE ID   CREATED   SIZE
`

// ── docker pull: hits the default branch, exercising only LAYER_NOISE stripping ──
//
// EVERY LAYER LINE CARRIES ITS ID. This fixture used to print the statuses bare
// ("Pull complete" at column 0), which docker has never done - it prints
// "17a39c0ba978: Pull complete". The filter was anchored at `^`, so the fixture
// matched the regex and real output did not, and `docker pull` compressed by 0%
// while this case stayed green. Shape confirmed against docker 29.4.1 by
// running `docker pull alpine:3.19` and reading the bytes back:
//
//   3.19: Pulling from library/alpine
//   17a39c0ba978: Pulling fs layer
//   ef1614f30685: Download complete
//   17a39c0ba978: Pull complete
//   Digest: sha256:6baf4358…
//   Status: Downloaded newer image for alpine:3.19
//   docker.io/library/alpine:3.19
const DOCKER_PULL = `Using default tag: latest
latest: Pulling from library/redis
a2abf6c4d29d: Pulling fs layer
c7a4e4382001: Waiting
4044b9ba67c9: Verifying Checksum
4044b9ba67c9: Download complete
c7a4e4382001: Extracting [==================================================>]  3.339MB/3.339MB
c7a4e4382001: Pull complete
a2abf6c4d29d: Already exists
Digest: sha256:0d3c3c3f3c8d1e6b5a4938271605f4e3d2c1b0a9887766554433221100ffeedd
Status: Downloaded newer image for redis:latest
docker.io/library/redis:latest
`

// ── docker logs: no table, no layer noise -> should pass through untouched ──
const DOCKER_LOGS = `2026-07-20T10:15:03.221Z INFO  server starting, node v18.19.0
2026-07-20T10:15:03.455Z INFO  connected to postgres at app-db:5432
2026-07-20T10:15:03.512Z INFO  redis cache ready at app-cache:6379
2026-07-20T10:15:03.998Z INFO  http server listening on 0.0.0.0:3000
2026-07-20T10:15:14.203Z WARN  slow query detected (1243ms): SELECT * FROM orders
2026-07-20T10:15:22.887Z INFO  GET /api/health 200 3ms
`

// ── docker logs / run / exec: the stream is the APPLICATION's stdout ─────────
// Every line below begins with a word the layer-transfer filter recognises
// (Waiting / Preparing / Extracting / Download complete / Pushed / Already
// exists / Verifying Checksum) - and every one of them was printed by the
// program in the container, not by docker. "Waiting for postgres..." is the
// canonical compose entrypoint wait loop and "Extracting templates from
// packages" is apt; deleting them by line shape is how the agent loses the one
// line that says why the container is stuck.
const DOCKER_LOGS_LAYER_WORDS = `{"t":"2026-07-22T09:00:00.000+00:00","s":"I","c":"NETWORK","msg":"Listening on 0.0.0.0"}
Waiting for postgres at app-db:5432
Preparing collection index build
app ready
Extracting templates from packages: 100%
Download complete for dataset v3
Pushed metrics batch 1
done
`

const DOCKER_RUN_LAYER_WORDS = `Preparing migration plan
Waiting for database...
Already exists check skipped
Verifying Checksum of bundle
Migration complete
`

const DOCKER_EXEC_LAYER_WORDS = `Preparing environment
Waiting 5s
OK
`

// ── docker compose build: a REAL capture, and it is on STDOUT ────────────────
// MEASURED, docker 29.4.1 / Docker Compose v5.1.3, on this machine:
//
//   docker compose build --no-cache >b.out.txt 2>b.err.txt
//     -> b.out.txt = 2228 bytes, the whole BuildKit transcript
//     -> b.err.txt = 63 bytes, just " Image composeproj-app Building / Built"
//
// This is the inverse of plain `docker build`, whose transcript goes to stderr
// (see the note on DOCKER_BUILD_BUILDKIT above). So `docker compose build` is
// the invocation where this wrapper CAN bank the BuildKit saving - it is the
// one that actually puts the transcript in front of the agent - and it is the
// one that reached no condenser at all: dockerSub() answered "compose" and
// compose fell into the unconditional-passthrough branch.
const DOCKER_COMPOSE_BUILD = `#1 [internal] load local bake definitions
#1 reading from stdin 861B 0.0s done
#1 DONE 0.0s

#2 [internal] load build definition from Dockerfile
#2 transferring dockerfile: 119B 0.0s done
#2 DONE 0.1s

#3 [internal] load metadata for docker.io/library/alpine:3.17
#3 DONE 0.0s

#4 [internal] load .dockerignore
#4 transferring context: 2B done
#4 DONE 0.0s

#5 [1/3] FROM docker.io/library/alpine:3.17@sha256:8fc3dacfb6d69da8d44e42390de777e48577085db99aa4e4af35f483eb08b989
#5 resolve docker.io/library/alpine:3.17@sha256:8fc3dacfb6d69da8d44e42390de777e48577085db99aa4e4af35f483eb08b989 0.0s done
#5 DONE 0.1s

#6 [2/3] RUN apk add --no-cache curl
#6 3.020 fetch https://dl-cdn.alpinelinux.org/alpine/v3.17/main/x86_64/APKINDEX.tar.gz
#6 6.703 fetch https://dl-cdn.alpinelinux.org/alpine/v3.17/community/x86_64/APKINDEX.tar.gz
#6 8.177 (1/5) Installing ca-certificates (20240226-r0)
#6 8.347 (2/5) Installing brotli-libs (1.0.9-r9)
#6 8.430 (3/5) Installing nghttp2-libs (1.51.0-r2)
#6 8.488 (4/5) Installing libcurl (8.9.0-r0)
#6 8.570 (5/5) Installing curl (8.9.0-r0)
#6 8.651 Executing busybox-1.35.0-r31.trigger
#6 8.683 Executing ca-certificates-20240226-r0.trigger
#6 9.834 OK: 10 MiB in 20 packages
#6 DONE 31.6s

#7 [3/3] RUN echo hello > /tmp/x
#7 DONE 4.9s

#8 exporting to image
#8 exporting layers
#8 exporting layers 1.9s done
#8 exporting manifest sha256:00e55f833f06de4d651fe220dc40308868148d7dbd500f6710636239d9b3c101 0.0s done
#8 exporting config sha256:431ca3eef7b057e12fd46bdb5afbf8e5eebd60e307d01c5d0af0c51d52490729 0.0s done
#8 exporting attestation manifest sha256:6532d478862989cf6822ccc83dbbe066a2550a6c2b538a255b1c2741de24568c
#8 exporting attestation manifest sha256:6532d478862989cf6822ccc83dbbe066a2550a6c2b538a255b1c2741de24568c 5.3s done
#8 exporting manifest list sha256:ee4adf7f257edcb1e45402416e91a126362540514dc3b6b9e527e8144f3de4f5
#8 exporting manifest list sha256:ee4adf7f257edcb1e45402416e91a126362540514dc3b6b9e527e8144f3de4f5 0.0s done
#8 naming to docker.io/library/composeproj-app:latest done
#8 unpacking to docker.io/library/composeproj-app:latest
#8 unpacking to docker.io/library/composeproj-app:latest 0.3s done
#8 DONE 7.8s

#9 resolving provenance for metadata file
#9 DONE 0.0s
`

// ── docker-compose build, legacy builder / compose v1 ────────────────────────
// The same "Step k/n" + "--->" transcript `docker build` prints under
// DOCKER_BUILDKIT=0, with the base-image pull chatter in front of it.
const DOCKER_COMPOSE_BUILD_LEGACY = `Building web
Step 1/4 : FROM node:18-alpine
18-alpine: Pulling from library/node
Pulling fs layer
Waiting
Verifying Checksum
Download complete
Extracting [==================================================>]  3.145MB/3.145MB
Pull complete
 ---> a1b2c3d4e5f6
Step 2/4 : WORKDIR /app
 ---> Using cache
 ---> b2c3d4e5f6a7
Step 3/4 : RUN npm ci --production
added 214 packages in 8.3s
 ---> d4e5f6a7b8c9
Step 4/4 : CMD ["node", "dist/server.js"]
 ---> 1b2c3d4e5f60
Successfully built 1b2c3d4e5f60
Successfully tagged myapp:latest
`

// ── docker compose pull ──────────────────────────────────────────────────────
// The daemon's own transfer report, exactly as `docker pull` prints it - there
// is no contained program on this stream to lose.
//
// MEASURED on Docker Compose v5.1.3: `docker compose pull` writes its progress
// to STDERR and leaves stdout empty, so today this reaches compress() only from
// a compose build that pulls a base image. It is filtered here for the same
// reason the BuildKit branch exists: so the bytes are CONDENSED rather than
// passed to a branch that recognises none of them on the day they arrive.
const DOCKER_COMPOSE_PULL = `Pulling redis
latest: Pulling from library/redis
Pulling fs layer
Waiting
Verifying Checksum
Download complete
Extracting [==================================================>]  3.339MB/3.339MB
Pull complete
Already exists
Digest: sha256:0d3c3c3f3c8d1e6b5a4938271605f4e3d2c1b0a9887766554433221100ffeedd
Status: Downloaded newer image for redis:latest
`

// ── docker compose up: the CONTAINED PROGRAMS' stdout ────────────────────────
// A REAL capture (Docker Compose v5.1.3, `docker compose up --no-log-prefix
// --abort-on-container-exit >up.out.txt 2>up.err.txt`): compose's own lifecycle
// chatter (" Container ... Starting/Started") went to STDERR, and what landed on
// stdout was the service's own output, verbatim. Three of those lines begin with
// a word the layer-transfer filter recognises. This is what the compose
// passthrough branch protects, and it must keep protecting it.
const DOCKER_COMPOSE_UP = `Attaching to api-1
Waiting for postgres at app-db:5432
Preparing collection index build
Extracting templates from packages: 100%
app ready
`

// ── kubectl get pods: a mix of running, pending, and failed pods ──
const KUBECTL_PODS = `NAME                           READY   STATUS              RESTARTS   AGE
api-7d9f8c6b5-2xk4p            1/1     Running             0          5h
api-7d9f8c6b5-9m3lq            1/1     Running             0          5h
web-5c8b7a6d4-jf8n2           1/1     Running             1          2d
worker-6b5a4c3d2-pl9wx        0/1     CrashLoopBackOff    8          22m
worker-6b5a4c3d2-qz7vn        0/1     Error               5          18m
migrate-7c6b5a4d3-hh2mn       0/1     ImagePullBackOff    0          3m
cache-warmer-8d7c6b5a4-ww1kl   0/1     Pending             0          90s
notifier-9e8d7c6b5-rr3jp      0/1     ContainerCreating   0          45s
`

// ── kubectl get pods: everything healthy (clean/zero-issues case) ──
const KUBECTL_PODS_HEALTHY = `NAME                     READY   STATUS    RESTARTS   AGE
api-7d9f8c6b5-2xk4p     1/1     Running   0          5h
api-7d9f8c6b5-9m3lq     1/1     Running   0          5h
web-5c8b7a6d4-jf8n2     1/1     Running   0          2d
web-5c8b7a6d4-kd9m3     1/1     Running   0          2d
worker-6b5a4c3d2-pl9wx   1/1     Running   0          6h
`

// ── kubectl get pods on an empty cluster ──
const KUBECTL_PODS_EMPTY = `No resources found in default namespace.
`

// ── kubectl get svc: wide service table ──
const KUBECTL_SVC = `NAME           TYPE           CLUSTER-IP       EXTERNAL-IP     PORT(S)                      AGE
kubernetes     ClusterIP      10.96.0.1        <none>          443/TCP                      45d
api-service    ClusterIP      10.96.132.44     <none>          3000/TCP                     12d
web-frontend   LoadBalancer   10.96.201.18     34.122.88.10    80:31380/TCP,443:31743/TCP   12d
app-db         ClusterIP      10.96.44.201     <none>          5432/TCP                     30d
app-cache      ClusterIP      None             <none>          6379/TCP                     30d
`

// ── kubectl get svc with no rows: header only ──
const KUBECTL_SVC_EMPTY = `NAME   TYPE   CLUSTER-IP   EXTERNAL-IP   PORT(S)   AGE
`

// ── kubectl get nodes: NAME/STATUS/ROLES/AGE/VERSION ──
const KUBECTL_NODES = `NAME         STATUS   ROLES           AGE   VERSION
gke-node-1   Ready    control-plane   45d   v1.28.3
gke-node-2   Ready    <none>          45d   v1.28.3
gke-node-3   Ready    <none>          30d   v1.28.3
`

// ── docker ps -q / images -q: bare id lists, the canonical `| xargs` input ──
const DOCKER_PS_QUIET = `a1b2c3d4e5f6
b2c3d4e5f6a7
c3d4e5f6a7b8
d4e5f6a7b8c9
e5f6a7b8c9d0
`

const DOCKER_IMAGES_QUIET = `a1b2c3d4e5f6
b2c3d4e5f6a7
c3d4e5f6a7b8
`

// ── docker ps --format: a caller-defined template, parsed by the caller ──
const DOCKER_PS_TEMPLATE = `web-frontend\tUp 2 hours
app-db\tUp 3 hours (healthy)
app-cache\tUp 3 hours
`

describeCompression('docker', [
  {
    name: 'build - strips build context, cache markers, bare layer hashes, and pull layer-transfer noise; keeps Step/output lines',
    cmd: 'docker',
    args: ['build'],
    input: DOCKER_BUILD,
    assert: (out) => {
      // layer-transfer noise (base image pull) is gone
      expect(out).not.toContain('Pull complete')
      expect(out).not.toContain('Download complete')
      expect(out).not.toContain('Verifying Checksum')
      expect(out).not.toContain('Pulling fs layer')
      expect(out).not.toContain('Extracting')
      // build-specific noise is gone
      expect(out).not.toContain('Sending build context')
      expect(out).not.toContain('Using cache')
      // bare "---> <hash>" intermediate-layer lines are dropped...
      expect(out).not.toMatch(/--->\s*[a-f0-9]{8,}\s*$/m)
      // ...but the meaningful steps and results survive
      expect(out).toContain('Step 1/8 : FROM node:18-alpine')
      expect(out).toContain('Step 8/8 : CMD ["node", "dist/server.js"]')
      expect(out).toContain('Successfully tagged myapp:latest')
    },
  },
  {
    // BuildKit has been the default builder since Docker 23, so this is the
    // shape nearly every real `docker build` produces. The condenser used to
    // recognise only the legacy "Step k/n" markers, so it removed blank lines
    // and nothing else - a wrapper that did not work on the dominant case.
    name: 'build (BuildKit) - one header per step; the repeated #N prefix, the per-line clock and the DONE sign-off come off',
    cmd: 'docker',
    args: ['build', '-t', 'ghcr.io/acme/api-gateway:1.24.3', '.'],
    input: DOCKER_BUILD_BUILDKIT,
    assert: (out, input) => {
      // Every step keeps the line that NAMES it, verbatim.
      for (const name of [
        '#0 building with "default" instance using docker driver',
        '#1 [internal] load build definition from Dockerfile',
        '#2 [internal] load metadata for docker.io/library/node:22-alpine',
        '#3 [internal] load .dockerignore',
        '#5 [internal] load build context',
        '#6 [deps 2/4] WORKDIR /app',
        '#7 [deps 4/4] RUN pnpm install --frozen-lockfile',
        '#8 exporting to image',
      ]) {
        expect(out).toContain(name)
      }
      // ...once, and only once: the prefix does not repeat down the step.
      expect(out.match(/^#7 /gm) ?? []).toHaveLength(1)
      // The output the step produced is kept, without the clock in front of it.
      expect(out).toContain('\nPackages: +812')
      expect(out).toContain('\n+ fastify 4.28.1')
      expect(out).not.toContain('13.02')
      expect(out).not.toContain('2.104')
      // ...but a line the RUN command printed is never invented or reworded.
      expect(out).toContain('Lockfile is up to date, resolution step is skipped')
      expect(out).toContain('Done in 13.4s')
      // Per-step timing and the byte-shuffling echoes carry nothing the name
      // line did not: "DONE 0.0s", "transferring ... done", "resolve <digest>".
      expect(out).not.toMatch(/^DONE /m)
      expect(out).not.toMatch(/DONE \d+\.\d+s/)
      expect(out).not.toContain('transferring')
      expect(out).not.toMatch(/^resolve /m)
      expect(out).not.toContain('exporting layers')
      // The per-chunk download meter, and the name line BuildKit reprints every
      // time a step resumes: the step is named once and stays named.
      expect(out).not.toMatch(/^sha256:/m)
      expect(out).not.toContain('2.23MB')
      expect(out.match(/^#4 /gm) ?? []).toHaveLength(1)
      expect(out).toContain(
        '#4 [deps 1/4] FROM docker.io/library/node:22-alpine@sha256:8c2c4b7f1a5d0e93f4c6d9b2a7e1f0c3d5b8a9e2f4c7d1b6a3e0f9c2d5b8a1e4',
      )
      // CACHED says the step did not run - that is the answer to a question an
      // agent asks - and the final tag is what the build was for.
      expect(out).toContain('CACHED')
      expect(out).toContain('naming to ghcr.io/acme/api-gateway:1.24.3 done')
      // A real reduction, not a blank-line trim.
      expect(out.length).toBeLessThan(input.length * 0.7)
    },
  },
  {
    name: 'build (BuildKit) - a failing step keeps its diagnosis, and the "------" trailer is not the step grammar so it survives whole',
    cmd: 'docker',
    args: ['build', '.'],
    input: DOCKER_BUILD_BUILDKIT_FAIL,
    assert: (out) => {
      expect(out).toContain('#9 [build 3/3] RUN pnpm run build')
      expect(out).toContain(
        "src/server.ts(42,7): error TS2322: Type 'string' is not assignable to type 'number'.",
      )
      expect(out).toContain(
        'ERROR: process "/bin/sh -c pnpm run build" did not complete successfully: exit code: 2',
      )
      // The trailer carries no "#N" prefix; text the parser does not recognise
      // is kept as it came rather than reshaped.
      for (const l of ['------', ' > [build 3/3] RUN pnpm run build:', 'Dockerfile:18']) {
        expect(out).toContain(l)
      }
      expect(out).toContain(
        'ERROR: failed to solve: process "/bin/sh -c pnpm run build" did not complete successfully: exit code: 2',
      )
    },
  },
  {
    name: 'build (BuildKit) - interleaved parallel steps stay attributable: the prefix returns whenever the step changes',
    cmd: 'docker',
    args: ['build', '.'],
    input: DOCKER_BUILD_BUILDKIT_PARALLEL,
    assert: (out) => {
      // Two stages building at once: every line that changes step carries its
      // own "#N" again, so no line is ever read under the wrong step.
      expect(out.split('\n')).toEqual([
        '#12 [deps 3/3] RUN pnpm install',
        'Progress: resolved 812, reused 806',
        '#13 [tools 2/2] RUN cargo build --release',
        'Compiling serde v1.0.203',
        '#12 Packages: +812',
        '#13 Compiling tokio v1.38.0',
      ])
    },
  },
  {
    name: 'ps - collapses the wide table to a "[docker] N containers:" summary (short id/name/image/status, no COMMAND, no header)',
    cmd: 'docker',
    args: ['ps'],
    input: DOCKER_PS,
    assert: (out) => {
      expect(out).toContain('[docker] 5 containers:')
      expect(out).toContain('web-frontend (nginx:1.25-alpine) Up 2 hours')
      // registry path is shortened to just the image:tag
      expect(out).toContain('api-service (api:v2.3.1) Up 45 minutes')
      // header row and noisy COMMAND column are dropped
      expect(out).not.toContain('CONTAINER ID')
      expect(out).not.toContain('docker-entrypoint')
      // one summary line per container
      expect(out.split('\n')).toHaveLength(6)
    },
  },
  {
    name: 'ps - no containers running collapses to a single zero line',
    cmd: 'docker',
    args: ['ps'],
    input: DOCKER_PS_EMPTY,
    assert: (out) => {
      expect(out).toBe('[docker] 0 containers running')
    },
  },
  {
    name: 'images - collapses to "[docker] N images:" with repo:tag [size] only (no IMAGE ID, no header)',
    cmd: 'docker',
    args: ['images'],
    input: DOCKER_IMAGES,
    assert: (out) => {
      expect(out).toContain('[docker] 6 images:')
      expect(out).toContain('nginx:1.25-alpine  [42.6MB]')
      expect(out).toContain('<none>:<none>  [1.12GB]')
      // the raw image IDs and the header are stripped
      expect(out).not.toContain('IMAGE ID')
      expect(out).not.toContain('REPOSITORY')
      expect(out).not.toContain('a1b2c3d4e5f6')
      expect(out.split('\n')).toHaveLength(7)
    },
  },
  {
    name: 'images - no images collapses to a single zero line',
    cmd: 'docker',
    args: ['images'],
    input: DOCKER_IMAGES_EMPTY,
    assert: (out) => {
      expect(out).toBe('[docker] 0 images')
    },
  },
  {
    name: 'pull - default branch strips per-layer transfer noise, keeps digest/status',
    cmd: 'docker',
    args: ['pull'],
    input: DOCKER_PULL,
    assert: (out) => {
      expect(out).not.toContain('Pull complete')
      expect(out).not.toContain('Download complete')
      expect(out).not.toContain('Verifying Checksum')
      expect(out).not.toContain('Pulling fs layer')
      expect(out).not.toContain('Already exists')
      expect(out).not.toContain('Extracting')
      expect(out).toContain('Status: Downloaded newer image for redis:latest')
      expect(out).toContain('Digest: sha256:')
    },
  },
  {
    name: 'logs - no table and no layer noise, passes through verbatim (modulo trim)',
    cmd: 'docker',
    args: ['logs'],
    input: DOCKER_LOGS,
    assert: (out) => {
      expect(out).toBe(DOCKER_LOGS.trim())
      // handler must not fabricate a table summary for arbitrary output
      expect(out).not.toContain('[docker]')
    },
  },
  {
    // `docker logs` stdout is the contained program's payload. The layer filter
    // used to run on EVERY subcommand before dispatch, so any application line
    // shaped like docker's own transfer chatter was deleted - no marker, no
    // notice. Same class src/handlers/http.ts records as fixed for wget: a
    // condenser may delete what it RECOGNISES, never what merely looks alike.
    name: 'logs - an application line that merely looks like layer chatter is payload and survives',
    cmd: 'docker',
    args: ['logs', 'mymongo'],
    input: DOCKER_LOGS_LAYER_WORDS,
    assert: (out, input) => {
      expect(out).toBe(input.trim())
      expect(out).toContain('Waiting for postgres at app-db:5432')
      expect(out).toContain('Extracting templates from packages: 100%')
      expect(out).toContain('Pushed metrics batch 1')
    },
  },
  {
    name: 'run - the container command\'s own stdout is never layer-filtered either',
    cmd: 'docker',
    args: ['run', '--rm', 'myapp'],
    input: DOCKER_RUN_LAYER_WORDS,
    assert: (out, input) => {
      expect(out).toBe(input.trim())
      expect(out).toContain('Waiting for database...')
      expect(out).toContain('Preparing migration plan')
    },
  },
  {
    name: 'exec - same stream, same rule',
    cmd: 'docker',
    args: ['exec', 'api', 'sh', '-c', './boot.sh'],
    input: DOCKER_EXEC_LAYER_WORDS,
    assert: (out, input) => {
      expect(out).toBe(input.trim())
    },
  },
  {
    // REGRESSION. Moving the layer filter out of the top of condenseDocker took
    // every `docker compose` form out of every condenser: dockerSub() answers
    // "compose" and compose lands in the unconditional-passthrough branch. The
    // BuildKit transcript above is passed through at 0.0% - and unlike plain
    // `docker build`, whose transcript goes to stderr, `docker compose build`
    // really does put these bytes on stdout (measured: 2228 bytes out, 63 in
    // stderr). It is the docker build invocation this wrapper can actually
    // bank, and it was the one reaching no condenser.
    name: 'compose build - the BuildKit transcript compose puts on STDOUT reaches the build condenser',
    cmd: 'docker',
    args: ['compose', 'build'],
    input: DOCKER_COMPOSE_BUILD,
    assert: (out, input) => {
      // Every step is still named, once, verbatim.
      for (const name of [
        '#1 [internal] load local bake definitions',
        '#5 [1/3] FROM docker.io/library/alpine:3.17@sha256:8fc3dacfb6d69da8d44e42390de777e48577085db99aa4e4af35f483eb08b989',
        '#6 [2/3] RUN apk add --no-cache curl',
        '#7 [3/3] RUN echo hello > /tmp/x',
        '#8 exporting to image',
        '#9 resolving provenance for metadata file',
      ]) {
        expect(out).toContain(name)
      }
      expect(out.match(/^#6 /gm) ?? []).toHaveLength(1)
      // What the RUN step printed survives, without the per-line clock.
      expect(out).toContain('OK: 10 MiB in 20 packages')
      expect(out).toContain('(1/5) Installing ca-certificates (20240226-r0)')
      expect(out).not.toContain('9.834')
      expect(out).not.toContain('3.020')
      // ...and the timing / byte-shuffling echoes come off.
      expect(out).not.toMatch(/DONE \d+\.\d+s/)
      expect(out).not.toContain('transferring')
      expect(out).not.toContain('exporting layers')
      expect(out).not.toMatch(/^resolve /m)
      // The tag the build was for is the answer, and it stays.
      expect(out).toContain('naming to docker.io/library/composeproj-app:latest done')
      // 0.0% before this fix; 55% on these measured bytes after it.
      expect(out.length).toBeLessThan(input.length * 0.6)
    },
  },
  {
    name: 'compose build (legacy builder) - the "Step k/n" transcript and its base-image pull chatter condense too',
    cmd: 'docker',
    args: ['compose', 'build', 'web'],
    input: DOCKER_COMPOSE_BUILD_LEGACY,
    assert: (out) => {
      // the base image's layer-transfer chatter - docker's own, not a program's
      expect(out).not.toContain('Pull complete')
      expect(out).not.toContain('Verifying Checksum')
      expect(out).not.toContain('Pulling fs layer')
      expect(out).not.toContain('Using cache')
      expect(out).not.toMatch(/--->\s*[a-f0-9]{8,}\s*$/m)
      // the steps and the result survive
      expect(out).toContain('Building web')
      expect(out).toContain('Step 1/4 : FROM node:18-alpine')
      expect(out).toContain('added 214 packages in 8.3s')
      expect(out).toContain('Successfully tagged myapp:latest')
    },
  },
  {
    name: 'compose pull - the daemon transfer report is stripped, exactly as `docker pull` is',
    cmd: 'docker',
    args: ['compose', 'pull'],
    input: DOCKER_COMPOSE_PULL,
    assert: (out) => {
      expect(out).not.toContain('Pull complete')
      expect(out).not.toContain('Download complete')
      expect(out).not.toContain('Verifying Checksum')
      expect(out).not.toContain('Pulling fs layer')
      expect(out).not.toContain('Already exists')
      expect(out).not.toContain('Extracting')
      expect(out).toContain('Pulling redis')
      expect(out).toContain('Status: Downloaded newer image for redis:latest')
      expect(out).toContain('Digest: sha256:')
    },
  },
  {
    // The other half of the fix. `compose` was made passthrough for a reason:
    // `up`, `logs`, `run` and `exec` put the CONTAINED PROGRAM's stdout on this
    // stream, and three of the lines below - measured off a real `docker compose
    // up` - begin with a word the layer filter recognises. Only the subcommands
    // whose stdout is docker's OWN transfer report may be filtered.
    name: 'compose up - the service\'s own stdout is still passthrough, layer-shaped lines and all',
    cmd: 'docker',
    args: ['compose', 'up'],
    input: DOCKER_COMPOSE_UP,
    assert: (out, input) => {
      expect(out).toBe(input.trim())
      expect(out).toContain('Waiting for postgres at app-db:5432')
      expect(out).toContain('Preparing collection index build')
      expect(out).toContain('Extracting templates from packages: 100%')
    },
  },
  {
    name: 'compose logs - same stream, same rule',
    cmd: 'docker',
    args: ['compose', 'logs', 'api'],
    input: DOCKER_LOGS_LAYER_WORDS,
    assert: (out, input) => {
      expect(out).toBe(input.trim())
      expect(out).toContain('Waiting for postgres at app-db:5432')
      expect(out).toContain('Pushed metrics batch 1')
    },
  },
  {
    // `docker compose ps` prints its own table (NAME/IMAGE/COMMAND/SERVICE/
    // CREATED/STATUS/PORTS), not `docker ps`'s. Routing compose's build/pull
    // shapes must not drag its other subcommands into a condenser built for a
    // different table.
    name: 'compose ps - a different table from `docker ps`, so it is not rolled up',
    cmd: 'docker',
    args: ['compose', 'ps'],
    input: `NAME                IMAGE            COMMAND                  SERVICE   CREATED         STATUS         PORTS
composeproj-api-1   alpine:3.17      "node dist/server.js"    api       2 minutes ago   Up 2 minutes   0.0.0.0:3000->3000/tcp
composeproj-db-1    postgres:16      "docker-entrypoint.s…"   db        2 minutes ago   Up 2 minutes   5432/tcp
`,
    assert: (out, input) => {
      expect(out).toBe(input.trim())
      expect(out).not.toContain('[docker]')
    },
  },
  {
    // condenseDocker dispatched on cmdArgs[0], so any global flag - which
    // ttGlobalFlags already tables for docker - shifted the subcommand out from
    // under it and every docker condenser silently stopped firing. Exactly the
    // bug condenseKubectl's own comment records fixing for `kubectl -n prod`.
    name: 'ps behind a global flag - the subcommand is resolved past --context, not read as args[0]',
    cmd: 'docker',
    args: ['--context', 'prod', 'ps'],
    input: DOCKER_PS,
    assert: (out) => {
      expect(out).toContain('[docker] 5 containers:')
      expect(out).toContain('web-frontend (nginx:1.25-alpine) Up 2 hours')
      expect(out).not.toContain('CONTAINER ID')
    },
  },
  {
    name: 'ps behind -H - a value-taking global flag consumes its value, so the host is not mistaken for the subcommand',
    cmd: 'docker',
    args: ['-H', 'tcp://build-01:2375', 'ps'],
    input: DOCKER_PS,
    assert: (out) => {
      expect(out).toContain('[docker] 5 containers:')
    },
  },
  {
    name: 'container ls - the management-command spelling of `docker ps` reaches the same rollup',
    cmd: 'docker',
    args: ['container', 'ls'],
    input: DOCKER_PS,
    assert: (out) => {
      expect(out).toContain('[docker] 5 containers:')
      expect(out).toContain('api-service (api:v2.3.1) Up 45 minutes')
    },
  },
  {
    name: 'image ls - the management-command spelling of `docker images` reaches the same rollup',
    cmd: 'docker',
    args: ['image', 'ls'],
    input: DOCKER_IMAGES,
    assert: (out) => {
      expect(out).toContain('[docker] 6 images:')
      expect(out).toContain('nginx:1.25-alpine  [42.6MB]')
    },
  },
  {
    name: 'build behind a global flag - `docker --log-level warn build .` still reaches the BuildKit condenser',
    cmd: 'docker',
    args: ['--log-level', 'warn', 'build', '.'],
    input: DOCKER_BUILD_BUILDKIT_PARALLEL,
    assert: (out) => {
      expect(out.split('\n')).toEqual([
        '#12 [deps 3/3] RUN pnpm install',
        'Progress: resolved 812, reused 806',
        '#13 [tools 2/2] RUN cargo build --release',
        'Compiling serde v1.0.203',
        '#12 Packages: +812',
        '#13 Compiling tokio v1.38.0',
      ])
    },
  },
  {
    name: 'kubectl get pods - rolls up to running/pending/failed counts with a bracketed issue list',
    cmd: 'kubectl',
    args: ['get', 'pods'],
    input: KUBECTL_PODS,
    assert: (out) => {
      expect(out).toContain('8 pods: 3 running, 2 pending, 3 failed')
      expect(out).toContain('[x] worker-6b5a4c3d2-pl9wx [CrashLoopBackOff]')
      expect(out).toContain('[x] worker-6b5a4c3d2-qz7vn [Error]')
      expect(out).toContain('[x] migrate-7c6b5a4d3-hh2mn [ImagePullBackOff]')
      // one issue line per failed pod, and only for failures
      expect((out.match(/\[x\]/g) ?? [])).toHaveLength(3)
      // per-pod detail columns are gone
      expect(out).not.toContain('READY')
      expect(out).not.toContain('CrashLoopBackOff\n')
    },
  },
  {
    name: 'kubectl get pods - all healthy yields a clean rollup with no issue list',
    cmd: 'kubectl',
    args: ['get', 'pods'],
    input: KUBECTL_PODS_HEALTHY,
    assert: (out) => {
      expect(out).toBe('5 pods: 5 running')
      expect(out).not.toContain('[x]')
      expect(out).not.toContain('pending')
      expect(out).not.toContain('failed')
    },
  },
  {
    name: 'kubectl get pods - empty cluster ("No resources found") rolls up to zero pods',
    cmd: 'kubectl',
    args: ['get', 'pods'],
    input: KUBECTL_PODS_EMPTY,
    assert: (out) => {
      expect(out).toBe('0 pods: 0 running')
    },
  },
  {
    name: 'kubectl get svc - compact "N svc:" table of name/type/[ports], dropping cluster/external IPs and age',
    cmd: 'kubectl',
    args: ['get', 'svc'],
    input: KUBECTL_SVC,
    assert: (out) => {
      expect(out.startsWith('5 svc:')).toBe(true)
      expect(out).toContain('web-frontend LoadBalancer [80:31380/TCP,443:31743/TCP]')
      expect(out).toContain('kubernetes ClusterIP [443/TCP]')
      // IP columns and header are dropped
      expect(out).not.toContain('CLUSTER-IP')
      expect(out).not.toContain('EXTERNAL-IP')
      expect(out).not.toContain('10.96.0.1')
      // header line + one line per service
      expect(out.split('\n')).toHaveLength(6)
    },
  },
  {
    // RESTORED: this case was lost during the parallel implementation run (its
    // fixture survived, its case did not). It is the passthrough guarantee for
    // every kind the condenser does not target, which is most of them.
    name: 'kubectl get nodes - untargeted kind passes through untouched (no rollup, no table)',
    cmd: 'kubectl',
    args: ['get', 'nodes'],
    input: KUBECTL_NODES,
    assert: (out) => {
      expect(out).toBe(KUBECTL_NODES.trim())
      expect(out).not.toContain('pods:')
      expect(out).not.toContain('[x]')
    },
  },
  {
    name: 'kubectl get svc - no rows returns the "No <kind> found" sentinel',
    cmd: 'kubectl',
    args: ['get', 'svc'],
    input: KUBECTL_SVC_EMPTY,
    assert: (out) => {
      expect(out).toBe('No svc found')
    },
  },
])

// ── docker's own machine formats ─────────────────────────────────────────────
// `isMachineOutput` in args.ts only knows the --json / -o json family. docker
// spells the same intent as `-q` (a bare id list, the canonical input for
// `docker rm $(docker ps -aq)`) and `--format '{{...}}'` (a caller-defined
// template). Both are consumed by something other than the agent's eyes, so the
// only safe transform is none.
describeCompression('docker machine formats', [
  {
    name: 'ps -q - a bare container id list survives verbatim for `| xargs`',
    cmd: 'docker',
    args: ['ps', '-q'],
    input: DOCKER_PS_QUIET,
    assert: (out) => {
      expect(out).toBe(DOCKER_PS_QUIET.trim())
      expect(out).not.toContain('[docker]')
    },
  },
  {
    name: 'ps -aq - the clustered short-flag form is recognised as an id list too',
    cmd: 'docker',
    args: ['ps', '-aq'],
    input: DOCKER_PS_QUIET,
    assert: (out) => {
      expect(out).toBe(DOCKER_PS_QUIET.trim())
    },
  },
  {
    name: 'images -q - a bare image id list survives verbatim',
    cmd: 'docker',
    args: ['images', '-q'],
    input: DOCKER_IMAGES_QUIET,
    assert: (out) => {
      expect(out).toBe(DOCKER_IMAGES_QUIET.trim())
      expect(out).not.toContain('[docker]')
    },
  },
  {
    name: 'ps --format - a caller-defined go template stays exactly as the caller shaped it',
    cmd: 'docker',
    args: ['ps', '--format', '{{.Names}}\t{{.Status}}'],
    input: DOCKER_PS_TEMPLATE,
    assert: (out) => {
      expect(out).toBe(DOCKER_PS_TEMPLATE.trim())
      // the tab-separated columns a caller would cut -f2 must stay intact
      expect(out.split('\n').every((l) => l.includes('\t'))).toBe(true)
    },
  },
])

// ── kubectl: the resource kind is not args[1] ────────────────────────────────
// `condenseKubectl` reads the kind as `cmdArgs[1]`, so any global flag before
// the verb shifts it: `kubectl -n prod get pods` resolved the kind to "prod".
const KUBECTL_PODS_NS = `NAME                      READY   STATUS      RESTARTS   AGE
api-7d9f8c6b5-2xk4p      1/1     Running     0          5h
api-7d9f8c6b5-9m3lq      1/1     Running     0          5h
worker-6b5a4c3d2-pl9wx   0/1     CrashLoopBackOff   8   22m
`

// ── kubectl get pods: statuses outside the running/pending/failed buckets ────
// `Completed` is the terminal STATUS of every finished Job/CronJob pod, so it
// is in essentially any real namespace; Evicted, ErrImagePull and
// CreateContainerConfigError are failure states an agent is triaging FOR. The
// rollup derived its total from its three counters, so every one of these rows
// was dropped from the body AND from the count.
const KUBECTL_PODS_UNBUCKETED = `NAME                            READY   STATUS                       RESTARTS   AGE
web-7f9c5d8b6-abcde             1/1     Running                      0          2d
migrations-run-28714919-aaaaa   0/1     Completed                    0          2d
backup-28714800-bbbbb           0/1     Completed                    0          1d
loader-6b4d9f7c5-qqqqq          0/1     ErrImagePull                 0          3m
stale-7c6b5a4d3-hh2mn           0/1     Evicted                      0          9m
config-9e8d7c6b5-rr3jp          0/1     CreateContainerConfigError   0          45s
`

// ── kubectl get pods -A: NAMESPACE is prepended, shifting every column ───────
const KUBECTL_PODS_ALL_NS = `NAMESPACE     NAME                       READY   STATUS             RESTARTS   AGE
kube-system   coredns-5d78c9869d-2xk4p   1/1     Running            0          10d
default       web-7f9c5d8b6-abcde        1/1     Running            0          2d
default       api-59d7c4b8f-zzzzz        0/1     CrashLoopBackOff   7          40m
`

// ── kubectl get pods: a pod draining during a rolling update ─────────────────
// `Terminating` is what kubectl prints for every pod inside its grace period:
// the old ReplicaSet's pods during any `kubectl rollout`, and every pod of a
// `kubectl delete`. It is the most ordinary transition there is.
const KUBECTL_PODS_TERMINATING = `NAME                     READY   STATUS        RESTARTS   AGE
web-7f9c5d8b6-abcde      1/1     Running       0          2d
web-7f9c5d8b6-fghij      1/1     Running       0          2d
web-6c4b3a2d1-klmno      1/1     Terminating   0          9d
`

// A drain happening AT THE SAME TIME as a real failure: the two must not be
// reported as the same thing.
const KUBECTL_PODS_TERMINATING_AND_FAILED = `NAME                     READY   STATUS             RESTARTS   AGE
web-7f9c5d8b6-abcde      1/1     Running            0          2d
web-6c4b3a2d1-klmno      1/1     Terminating        0          9d
api-59d7c4b8f-zzzzz      0/1     CrashLoopBackOff   7          40m
`

// ── kubectl get pods -o custom-columns: the caller chose the columns ─────────
// There is no STATUS column at all here, so there is nothing for the pod
// rollup to count - and the columns are whatever the caller asked for, usually
// to cut a field back out of them.
const KUBECTL_PODS_CUSTOM_COLUMNS = `NAME                     NODE
web-7f9c5d8b6-abcde      node-1
api-59d7c4b8f-zzzzz      node-2
worker-6b4d9f7c5-qqqqq   node-3
`

// ── kubectl describe pod: two containers, the sidecar crash-looping ──────────
// The container name lines and the Reason under State / Last State are the two
// things this description is read for: `kubectl logs -c <name>` needs the
// former, and kubelet emits no event for OOMKilled, so nothing else carries the
// latter.
const KUBECTL_DESCRIBE_MULTI = `Name:             web-7f9c5d8b6-abcde
Namespace:        production
Node:             gke-node-2/10.128.0.14
Status:           Running
IP:               10.4.2.19
Controlled By:  ReplicaSet/web-7f9c5d8b6
Containers:
  app:
    Container ID:   containerd://9f8e7d6c5b4a39281706f5e4d3c2b1a0
    Image:          ghcr.io/acme/app:2.1
    Image ID:       ghcr.io/acme/app@sha256:0d3c3c3f3c8d1e6b5a4938271605f4e3
    State:          Running
      Started:      Tue, 21 Jul 2026 09:01:20 +0000
    Ready:          True
    Restart Count:  0
    Limits:
      cpu:     500m
      memory:  512Mi
  sidecar:
    Container ID:   containerd://1a2b3c4d5e6f708192a3b4c5d6e7f809
    Image:          ghcr.io/acme/proxy:1.0
    Image ID:       ghcr.io/acme/proxy@sha256:1c0d9e8f7a6b5c4d3e2f1a0b9c8d7e6f
    State:          Waiting
      Reason:       CrashLoopBackOff
    Last State:     Terminated
      Reason:       OOMKilled
      Exit Code:    137
      Started:      Tue, 21 Jul 2026 09:00:02 +0000
      Finished:     Tue, 21 Jul 2026 09:00:31 +0000
    Ready:          False
    Restart Count:  9
Conditions:
  Type              Status
  Initialized       True
  Ready             False
  ContainersReady   False
  PodScheduled      True
Events:
  Type     Reason   Age                  From     Message
  ----     ------   ----                 ----     -------
  Warning  BackOff  2m (x91 over 44m)    kubelet  Back-off restarting failed container sidecar in pod web-7f9c5d8b6-abcde
`

// ── kubectl describe: 200-400 lines per object ───────────────────────────────
// The Annotations block embeds an entire last-applied-configuration JSON
// document inline; Events is the part anyone actually reads.
const KUBECTL_DESCRIBE = `Name:             api-7d9f8c6b5-2xk4p
Namespace:        production
Priority:         0
Service Account:  api
Node:             gke-node-2/10.128.0.14
Start Time:       Tue, 21 Jul 2026 09:01:12 +0000
Labels:           app.kubernetes.io/instance=api
                  app.kubernetes.io/name=api
                  pod-template-hash=7d9f8c6b5
Annotations:      kubectl.kubernetes.io/last-applied-configuration:
                    {"apiVersion":"apps/v1","kind":"Deployment","metadata":{"annotations":{},"labels":{"app":"api"},"name":"api","namespace":"production"},"spec":{"replicas":3}}
                  prometheus.io/port: 3000
                  prometheus.io/scrape: true
Status:           Running
IP:               10.4.2.17
IPs:
  IP:           10.4.2.17
Controlled By:  ReplicaSet/api-7d9f8c6b5
Containers:
  api:
    Container ID:   containerd://9f8e7d6c5b4a39281706f5e4d3c2b1a0
    Image:          myregistry.io/team/api:v2.3.1
    Image ID:       myregistry.io/team/api@sha256:0d3c3c3f3c8d1e6b5a4938271605f4e3
    Port:           3000/TCP
    Host Port:      0/TCP
    State:          Running
      Started:      Tue, 21 Jul 2026 09:01:20 +0000
    Ready:          True
    Restart Count:  0
    Limits:
      cpu:     500m
      memory:  512Mi
    Environment:
      NODE_ENV:  production
    Mounts:
      /var/run/secrets/kubernetes.io/serviceaccount from kube-api-access-8xk2p (ro)
Conditions:
  Type              Status
  Initialized       True
  Ready             False
  ContainersReady   False
  PodScheduled      True
Volumes:
  kube-api-access-8xk2p:
    Type:                    Projected (a volume that contains injected data)
    TokenExpirationSeconds:  3607
QoS Class:                   Burstable
Node-Selectors:              <none>
Tolerations:                 node.kubernetes.io/not-ready:NoExecute op=Exists for 300s
                             node.kubernetes.io/unreachable:NoExecute op=Exists for 300s
Events:
  Type     Reason     Age                From               Message
  ----     ------     ----               ----               -------
  Normal   Scheduled  22m                default-scheduler  Successfully assigned production/api-7d9f8c6b5-2xk4p to gke-node-2
  Normal   Pulled     22m                kubelet            Container image already present on machine
  Warning  Unhealthy  2m (x14 over 20m)  kubelet            Readiness probe failed: HTTP probe failed with statuscode: 503
`

describeCompression('kubectl deepening', [
  {
    name: 'get pods with a namespace flag - the kind is resolved past the flag, not read as args[1]',
    cmd: 'kubectl',
    args: ['-n', 'production', 'get', 'pods'],
    input: KUBECTL_PODS_NS,
    assert: (out) => {
      // the pods rollup must fire, exactly as it does without the flag
      expect(out).toMatch(/3 pods: 2 running/)
      expect(out).toContain('[x] worker-6b5a4c3d2-pl9wx [CrashLoopBackOff]')
    },
  },
  {
    // The rollup's total used to be running+pending+failed, so a STATUS with no
    // bucket was neither counted nor listed: a namespace of finished CronJob
    // pods reported "0 pods: 0 running". Every row must reach the total, and a
    // status the rollup has no bucket for is reported under the name kubectl
    // printed for it rather than invented into one of the three.
    name: 'get pods - a STATUS outside running/pending/failed still reaches the total, under its own name',
    cmd: 'kubectl',
    args: ['get', 'pods'],
    input: KUBECTL_PODS_UNBUCKETED,
    assert: (out) => {
      // six data rows in, six pods out
      expect(out).toMatch(/^6 pods: /)
      expect(out).toContain('1 running')
      // the two finished Job pods are counted, under the status kubectl printed
      expect(out).toMatch(/2 Completed/)
      // and the three failure states are counted AND named
      expect(out).toContain('3 failed')
      expect(out).toContain('[x] loader-6b4d9f7c5-qqqqq [ErrImagePull]')
      expect(out).toContain('[x] stale-7c6b5a4d3-hh2mn [Evicted]')
      expect(out).toContain('[x] config-9e8d7c6b5-rr3jp [CreateContainerConfigError]')
    },
  },
  {
    // FABRICATION. `Terminating` was bucketed as a FAILURE, so every pod inside
    // its grace period - the old ReplicaSet through any rolling update, every
    // pod of a `kubectl delete` - was reported to the agent as a problem, in the
    // `[x]` list, under a "N failed" count. Nothing in the input says the pod
    // failed; kubectl said it is shutting down. It gets no bucket, for the same
    // reason `Completed` gets none: the word in the summary is then the one
    // kubectl printed, not one this file chose on its behalf.
    name: 'get pods - a draining pod is a lifecycle state, not a failure, and never reaches the [x] list',
    cmd: 'kubectl',
    args: ['get', 'pods'],
    input: KUBECTL_PODS_TERMINATING,
    assert: (out) => {
      expect(out).toBe('3 pods: 2 running, 1 Terminating')
      // the `[x]` list means "something is wrong"; a rolling update is not
      expect(out).not.toContain('[x]')
      expect(out).not.toContain('failed')
    },
  },
  {
    name: 'get pods - a drain alongside a real failure: only the failure is flagged, and both are counted',
    cmd: 'kubectl',
    args: ['get', 'pods'],
    input: KUBECTL_PODS_TERMINATING_AND_FAILED,
    assert: (out) => {
      expect(out).toMatch(/^3 pods: /)
      expect(out).toContain('1 running')
      expect(out).toContain('1 failed')
      expect(out).toContain('1 Terminating')
      // exactly one issue, and it is the crash-looping pod
      expect((out.match(/\[x\]/g) ?? [])).toHaveLength(1)
      expect(out).toContain('[x] api-59d7c4b8f-zzzzz [CrashLoopBackOff]')
      expect(out).not.toContain('[x] web-6c4b3a2d1-klmno')
    },
  },
  {
    // `-A` prepends NAMESPACE. The header filter dropped the header anyway, then
    // every row was read one column off - parts[2] was READY ("1/1"), never
    // STATUS - so a full cluster came back as "0 pods: 0 running" with a
    // CrashLoopBackOff in it.
    name: 'get pods -A - the NAMESPACE column shifts every other one, so the columns are read from the header',
    cmd: 'kubectl',
    args: ['get', 'pods', '-A'],
    input: KUBECTL_PODS_ALL_NS,
    assert: (out) => {
      expect(out).toContain('3 pods: 2 running, 1 failed')
      // and the pod is identified by namespace, since -A spans all of them
      expect(out).toContain('[x] default/api-59d7c4b8f-zzzzz [CrashLoopBackOff]')
    },
  },
  {
    name: 'get pods --all-namespaces - the long spelling behaves identically',
    cmd: 'kubectl',
    args: ['get', 'pods', '--all-namespaces'],
    input: KUBECTL_PODS_ALL_NS,
    assert: (out) => {
      expect(out).toContain('3 pods: 2 running, 1 failed')
    },
  },
  {
    // `-o custom-columns=` is a caller-defined format: the columns, their order
    // and their names are whatever was asked for, and there is usually an awk
    // downstream. isMachineOutput does not know the spelling, so the rollup ran
    // on a table with no STATUS column and deleted every row.
    name: 'get pods -o custom-columns - a caller-defined column set is passed through, never rolled up',
    cmd: 'kubectl',
    args: ['get', 'pods', '-o', 'custom-columns=NAME:.metadata.name,NODE:.spec.nodeName'],
    input: KUBECTL_PODS_CUSTOM_COLUMNS,
    assert: (out, input) => {
      expect(out).toBe(input.trim())
      expect(out).not.toContain('pods:')
    },
  },
  {
    name: 'get pods -o=custom-columns-file - the inline-value spelling is recognised too',
    cmd: 'kubectl',
    args: ['get', 'pods', '-o=custom-columns-file=/tmp/cols.txt'],
    input: KUBECTL_PODS_CUSTOM_COLUMNS,
    assert: (out, input) => {
      expect(out).toBe(input.trim())
    },
  },
  {
    name: 'get pods --no-headers - with no header row the columns cannot be named, so the table passes through',
    cmd: 'kubectl',
    args: ['get', 'pods', '--no-headers'],
    input: `web-7f9c5d8b6-abcde      1/1   Running            0   2d
api-59d7c4b8f-zzzzz      0/1   CrashLoopBackOff   7   40m
`,
    assert: (out, input) => {
      expect(out).toBe(input.trim())
      expect(out).not.toContain('0 pods')
    },
  },
  {
    name: 'describe pod - the container names and the crash Reason survive, on both containers',
    cmd: 'kubectl',
    args: ['describe', 'pod', 'web-7f9c5d8b6-abcde'],
    input: KUBECTL_DESCRIBE_MULTI,
    assert: (out, input) => {
      // which container is which - `kubectl logs -c <name>` needs the name
      expect(out).toMatch(/^ {2}app:$/m)
      expect(out).toMatch(/^ {2}sidecar:$/m)
      // the reason the sidecar is Waiting, and the reason it died before that
      expect(out).toContain('CrashLoopBackOff')
      expect(out).toContain('OOMKilled')
      expect(out).toMatch(/State:\s+Waiting/)
      expect(out).toMatch(/Last State:\s+Terminated/)
      // still a condenser: ids, digests and limits go
      expect(out).not.toContain('containerd://')
      expect(out).not.toContain('sha256:')
      expect(out).not.toContain('512Mi')
      // Still condensing - modestly, because this fixture is deliberately dense
      // (no annotation dump, no volumes) so that what it does keep is visible.
      expect(out.length).toBeLessThan(input.length * 0.75)
    },
  },
  {
    name: 'describe pod - keeps status, failing conditions and events; drops the annotation JSON dump',
    cmd: 'kubectl',
    args: ['describe', 'pod', 'api-7d9f8c6b5-2xk4p'],
    input: KUBECTL_DESCRIBE,
    assert: (out, input) => {
      // identity and state
      expect(out).toContain('api-7d9f8c6b5-2xk4p')
      expect(out).toMatch(/Status:\s+Running/)
      // the reason it is being described at all
      expect(out).toContain('Readiness probe failed')
      expect(out).toContain('Unhealthy')
      // the failing condition survives; the satisfied ones are noise
      expect(out).toMatch(/Ready\s+False/)
      // an entire JSON document inlined in an annotation is the single biggest
      // block and is never what the agent asked for
      expect(out).not.toContain('last-applied-configuration')
      expect(out).not.toContain('"apiVersion":"apps/v1"')
      // as are the mount, volume, toleration and image-digest blocks
      expect(out).not.toContain('kube-api-access-8xk2p')
      expect(out).not.toContain('sha256:0d3c3c3f')
      expect(out).not.toContain('Tolerations')
      expect(out.length).toBeLessThan(input.length / 2)
    },
  },
  {
    name: 'describe - an unrecognised shape passes through rather than being summarised',
    cmd: 'kubectl',
    args: ['describe', 'pod', 'missing'],
    input: 'Error from server (NotFound): pods "missing" not found\n',
    assert: (out, input) => {
      expect(out).toBe(input.trim())
    },
  },
])
// ── `kubectl get pods -o wide` ────────────────────────────────────────────────
// Not a describeCompression case, because the point is what happens to a table
// far too large to keep as a snapshot - which is exactly the table this used to
// let through whole.
//
// `wide` sat in the machine-format list beside json and yaml, so the output
// skipped the condenser AND the frame's 8 KB backstop: a 2000-pod listing
// reached the agent at 186 KB, roughly 46k tokens, for a command that prints a
// human table. Removing it there is only half of it - the pod rollup answers
// "N pods: N running", and the IP and NODE columns it drops are the whole
// reason anyone types `-o wide`. So the rollup steps aside and the table is
// relayed as printed, capped like any other large output.
describe('kubectl get pods -o wide', () => {
  const HEADER = 'NAMESPACE   NAME   READY   STATUS    RESTARTS   AGE   IP           NODE\n'
  const WIDE =
    HEADER +
    Array.from(
      { length: 2000 },
      (_, i) =>
        `prod        api-${i}   1/1     Running   0          3d    ` +
        `10.0.${i % 250}.${i % 250}   node-${i % 40}.cluster.local`,
    ).join('\n') +
    '\n'

  it.each([
    ['-o wide', ['get', 'pods', '-A', '-o', 'wide']],
    ['-o=wide', ['get', 'pods', '-o=wide']],
    ['-owide', ['get', 'pods', '-owide']],
    ['--output=wide', ['get', 'pods', '--output=wide']],
    ['--output wide', ['get', 'pods', '--output', 'wide']],
  ])('%s is capped by the backstop instead of passing through whole', (_label, args) => {
    const out = compress(WIDE, 'kubectl', args as string[])
    expect(WIDE.length).toBeGreaterThan(100_000) // the fixture really is huge
    expect(out.length).toBeLessThan(20_000)
    // The columns the flag was typed for survive in what is kept.
    expect(out).toContain('10.0.1.1')
    expect(out).toContain('node-1.cluster.local')
    // And the rollup did NOT fire: that answer has no IP or NODE in it at all.
    expect(out).not.toMatch(/^\d+ pods:/m)
  })

  it('still rolls up the plain listing, where there are no extra columns to lose', () => {
    expect(compress(WIDE, 'kubectl', ['get', 'pods', '-A'])).toBe('2000 pods: 2000 running')
  })
})// ── `docker compose` with its own global flags ────────────────────────────────
// `resolveSub` tables DOCKER's value-taking flags, not compose's, so a flag was
// skipped without its value being consumed and the value came back as the verb:
// `docker compose -f docker-compose.prod.yml build` resolved to
// "docker-compose.prod.yml", missed the build branch and fell into compose's
// passthrough at 0% saved. Every spelling below is an ordinary agent or CI line,
// and `--progress plain` is the one that FORCES the transcript being condensed.
describe('docker compose global flags', () => {
  const BUILDKIT =
    [
      '#1 [internal] load build definition from Dockerfile',
      '#1 transferring dockerfile: 512B done',
      '#1 DONE 0.0s',
      '#2 [internal] load metadata for docker.io/library/node:22-alpine',
      '#2 DONE 0.4s',
      '#3 [1/6] FROM docker.io/library/node:22-alpine@sha256:abcdef0123456789',
      '#3 resolve docker.io/library/node:22-alpine@sha256:abcdef0123456789 done',
      '#3 sha256:aaaa 3.99MB / 3.99MB 0.3s done',
      '#3 extracting sha256:aaaa done',
      '#3 DONE 1.2s',
      '#4 [2/6] WORKDIR /app',
      '#4 CACHED',
      '#5 [3/6] COPY package.json pnpm-lock.yaml ./',
      '#5 DONE 0.1s',
      '#6 [4/6] RUN pnpm install --frozen-lockfile',
      '#6 DONE 22.4s',
      '#7 exporting to image',
      '#7 exporting layers 1.8s done',
      '#7 writing image sha256:cccc done',
      '#7 DONE 2.0s',
    ].join('\n') + '\n'

  it.each([
    [['compose', 'build']],
    [['compose', '-f', 'docker-compose.prod.yml', 'build']],
    [['compose', '--file', 'a.yml', '--file', 'b.yml', 'build']],
    [['compose', '--file=x.yml', 'build']],
    [['compose', '--progress', 'plain', 'build']],
    [['compose', '-p', 'myproj', 'build']],
    [['compose', '--env-file', '.env.prod', 'build']],
    [['compose', '--project-directory', '../stack', 'build']],
  ])('%j reaches the build condenser', (args) => {
    const out = compress(BUILDKIT, 'docker', args as string[])
    expect(out.length, (args as string[]).join(' ')).toBeLessThan(BUILDKIT.length * 0.7)
  })

  it('leaves the subcommands that stream a CONTAINED program alone, flags or not', () => {
    // `up`, `logs`, `run` and `exec` put the application's own stdout on the
    // stream. That is the output the agent asked for, and the passthrough
    // branch exists to protect it - resolving the verb correctly must not
    // start folding it.
    for (const args of [['compose', 'up'], ['compose', '-f', 'x.yml', 'up'], ['compose', 'ps']]) {
      expect(compress(BUILDKIT, 'docker', args), args.join(' ')).toBe(BUILDKIT.trimEnd())
    }
  })
})