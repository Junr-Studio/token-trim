import { expect } from 'vitest'
import { describeCompression } from '../support/harness.js'

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
Pulling fs layer
Waiting
Verifying Checksum
Download complete
Extracting [==================================================>]  3.145MB/3.145MB
Pull complete
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
const DOCKER_PULL = `Using default tag: latest
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

// ── kubectl get nodes: not a targeted kind -> default passthrough ──
const KUBECTL_NODES = `NAME         STATUS   ROLES           AGE   VERSION
gke-node-1   Ready    control-plane   45d   v1.28.3
gke-node-2   Ready    <none>          45d   v1.28.3
gke-node-3   Ready    <none>          30d   v1.28.3
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
    name: 'kubectl get svc - no rows returns the "No <kind> found" sentinel',
    cmd: 'kubectl',
    args: ['get', 'svc'],
    input: KUBECTL_SVC_EMPTY,
    assert: (out) => {
      expect(out).toBe('No svc found')
    },
  },
  {
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
])
