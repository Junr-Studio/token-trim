import type { MatrixEntry } from '../support/matrix.js'

// Infra / cloud group: docker, kubectl, helm, terraform, tofu, aws, psql,
// curl, wget, jq.
//
// Every fixture below is the shape the real tool prints on a PIPE (which is the
// only case the proxy compresses): no ANSI, no TTY progress redraws, stderr
// kept separate - the frame writes stderr through untouched and only ever hands
// compress() the child's stdout. That distinction decides two of the entries
// here: wget's transfer log and curl's progress meter never reach a condenser
// at all, because neither is written to stdout.

// ── docker ps ─────────────────────────────────────────────────────────────────
// The COMMAND / CREATED / PORTS columns are ~60% of every row and none of them
// answer the question the agent asked ("what is up, and is it healthy").
const DOCKER_PS = `CONTAINER ID   IMAGE                                    COMMAND                  CREATED       STATUS                         PORTS                                                                                  NAMES
3f2a9c8d1e4b   ghcr.io/acme/api-gateway:1.24.3          "/app/gateway --conf…"   2 days ago    Up 2 days (healthy)            0.0.0.0:8080->8080/tcp, :::8080->8080/tcp                                              acme-api-gateway
b71c4e05a9d3   ghcr.io/acme/orders-worker:2.8.0         "python -m orders.wo…"   2 days ago    Up 2 days                                                                                                             acme-orders-worker
c0d9f3b81a27   postgres:16.3-alpine                     "docker-entrypoint.s…"   3 weeks ago   Up 2 days (healthy)            0.0.0.0:5432->5432/tcp, :::5432->5432/tcp                                              acme-postgres
9ea1b7c46d80   redis:7.2-alpine                         "docker-entrypoint.s…"   3 weeks ago   Up 2 days                      0.0.0.0:6379->6379/tcp, :::6379->6379/tcp                                              acme-redis
44f8ac0921be   ghcr.io/acme/billing-sync:0.14.2         "/usr/local/bin/sync"    5 hours ago   Restarting (1) 8 seconds ago                                                                                          acme-billing-sync
e2b6d95f7c31   docker.elastic.co/elasticsearch:8.14.1   "/bin/tini -- /usr/l…"   3 weeks ago   Up 2 days (unhealthy)          0.0.0.0:9200->9200/tcp, :::9200->9200/tcp, 0.0.0.0:9300->9300/tcp, :::9300->9300/tcp   acme-search
7c5e18a2f4b9   grafana/grafana:11.1.0                   "/run.sh"                3 weeks ago   Up 2 days                      0.0.0.0:3000->3000/tcp, :::3000->3000/tcp                                              acme-grafana
1d3b6f8e5a02   prom/prometheus:v2.53.0                  "/bin/prometheus --c…"   3 weeks ago   Up 2 days                      0.0.0.0:9090->9090/tcp, :::9090->9090/tcp                                              acme-prometheus`

// ── docker build (BuildKit, plain progress) ───────────────────────────────────
// BuildKit is the default builder since Docker 23, and on a pipe it emits this
// plain "#N step" transcript rather than the legacy "Step k/n" + "--->" one.
//
// WHICH STREAM: measured on docker 29.4.1 -
//   docker build --progress=plain --no-cache . >out.txt 2>err.txt
//   -> out.txt 0 bytes, err.txt 2238 bytes
// BuildKit writes the whole transcript to STDERR. The proxy compresses stdout
// only (src/frame.ts spawns with ['inherit','pipe','pipe'] and writes rawStderr
// through untouched), so on a current engine this text does not reach
// compress() at all - what a modern `docker build` puts on stdout is nothing,
// or one image id under -q. Both cases have their own entry below. This fixture
// therefore measures the CONDENSER on BuildKit's bytes; it is not a claim that
// the wrapper banks 32% on a modern build.
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
#4 CACHED

#5 [internal] load build context
#5 transferring context: 4.19MB 0.2s done
#5 DONE 0.3s

#6 [deps 2/4] WORKDIR /app
#6 CACHED

#7 [deps 3/4] COPY package.json pnpm-lock.yaml ./
#7 DONE 0.1s

#8 [deps 4/4] RUN --mount=type=cache,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile
#8 2.104 Lockfile is up to date, resolution step is skipped
#8 2.310 Progress: resolved 1, reused 0, downloaded 0, added 0
#8 6.882 Packages: +812
#8 12.44 Progress: resolved 812, reused 806, downloaded 6, added 812, done
#8 13.02 dependencies:
#8 13.02 + @fastify/cors 9.0.1
#8 13.02 + fastify 4.28.1
#8 13.02 + pino 9.2.0
#8 13.71 Done in 13.4s
#8 DONE 14.1s

#9 [build 1/3] COPY tsconfig.json ./
#9 DONE 0.1s

#10 [build 2/3] COPY src ./src
#10 DONE 0.1s

#11 [build 3/3] RUN pnpm run build
#11 0.612
#11 0.612 > api-gateway@1.24.3 build /app
#11 0.612 > tsc -p tsconfig.json
#11 0.612
#11 9.884 Done in 9.7s
#11 DONE 10.2s

#12 [runtime 1/3] COPY --from=build /app/dist ./dist
#12 DONE 0.2s

#13 [runtime 2/3] COPY --from=deps /app/node_modules ./node_modules
#13 DONE 1.4s

#14 [runtime 3/3] RUN adduser -D -u 10001 gateway && chown -R gateway /app
#14 DONE 0.4s

#15 exporting to image
#15 exporting layers
#15 exporting layers 2.1s done
#15 writing image sha256:9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b2a1f0e9d8c7b6a5f4e3d2c1b0a9f8e done
#15 naming to ghcr.io/acme/api-gateway:1.24.3 done
#15 DONE 2.2s`

// ── docker build -q ───────────────────────────────────────────────────────────
// The one thing a BuildKit `docker build` puts on STDOUT, and only when asked:
// the image id, for `docker run $(docker build -q .)`. Measured on 29.4.1 -
// `docker build -q . >qout.txt` gave exactly this one line and nothing else.
const DOCKER_BUILD_QUIET = `sha256:2c08fd738158e5c155d9223414301696d668d6edb79c8a148b04ef97da7db05b
`

// ── docker build (legacy builder) ─────────────────────────────────────────────
// What DOCKER_BUILDKIT=0 (and every engine before 23.0) prints, ON STDOUT -
// re-verified on docker 29.4.1, where the legacy builder still works behind
// that variable and still streams its transcript to stdout (352 bytes of Step
// lines out, 209 bytes of deprecation warning on stderr). This is the shape
// condenseDocker's build branch was written against: the "--->" layer-id echoes
// and the build-context banner are pure noise.
const DOCKER_BUILD_LEGACY = `Sending build context to Docker daemon  4.191MB
Step 1/14 : FROM node:22-alpine AS deps
22-alpine: Pulling from library/node
9824c27679d3: Pulling fs layer
6bbb3e1d1e6e: Pulling fs layer
b0a5eb0e0d0f: Pulling fs layer
3f4e1c8b7a29: Waiting
6bbb3e1d1e6e: Verifying Checksum
6bbb3e1d1e6e: Download complete
9824c27679d3: Verifying Checksum
9824c27679d3: Download complete
9824c27679d3: Extracting
9824c27679d3: Pull complete
6bbb3e1d1e6e: Extracting
6bbb3e1d1e6e: Pull complete
b0a5eb0e0d0f: Pull complete
3f4e1c8b7a29: Already exists
Digest: sha256:8c2c4b7f1a5d0e93f4c6d9b2a7e1f0c3d5b8a9e2f4c7d1b6a3e0f9c2d5b8a1e4
Status: Downloaded newer image for node:22-alpine
 ---> a1b2c3d4e5f6
Step 2/14 : WORKDIR /app
 ---> Using cache
 ---> f0e1d2c3b4a5
Step 3/14 : COPY package.json pnpm-lock.yaml ./
 ---> Using cache
 ---> 4d5e6f708192
Step 4/14 : RUN pnpm install --frozen-lockfile
 ---> Using cache
 ---> 6a7b8c9d0e1f
Step 5/14 : COPY tsconfig.json ./
 ---> Using cache
 ---> 2b3c4d5e6f70
Step 6/14 : COPY src ./src
 ---> 8192a3b4c5d6
Step 7/14 : RUN pnpm run build
 ---> Running in 7e8f9a0b1c2d

> api-gateway@1.24.3 build /app
> tsc -p tsconfig.json

Removing intermediate container 7e8f9a0b1c2d
 ---> d6e5f4a3b2c1
Step 8/14 : FROM node:22-alpine AS runtime
 ---> a1b2c3d4e5f6
Step 9/14 : WORKDIR /app
 ---> Using cache
 ---> f0e1d2c3b4a5
Step 10/14 : COPY --from=build /app/dist ./dist
 ---> 3c2b1a0f9e8d
Step 11/14 : COPY --from=deps /app/node_modules ./node_modules
 ---> 5e4d3c2b1a0f
Step 12/14 : RUN adduser -D -u 10001 gateway && chown -R gateway /app
 ---> Running in 0f1e2d3c4b5a
Removing intermediate container 0f1e2d3c4b5a
 ---> 7a6b5c4d3e2f
Step 13/14 : USER gateway
 ---> Running in 1a2b3c4d5e6f
Removing intermediate container 1a2b3c4d5e6f
 ---> 9f8e7d6c5b4a
Step 14/14 : CMD ["node", "dist/server.js"]
 ---> Running in 2c3d4e5f6a7b
Removing intermediate container 2c3d4e5f6a7b
 ---> 3e4f5a6b7c8d
Successfully built 3e4f5a6b7c8d
Successfully tagged ghcr.io/acme/api-gateway:1.24.3`

// ── kubectl get pods ──────────────────────────────────────────────────────────
const KUBECTL_GET_PODS = `NAME                                   READY   STATUS             RESTARTS         AGE
api-gateway-7d4b9c8f5-x2ktp            1/1     Running            0                2d1h
api-gateway-7d4b9c8f5-qm4vd            1/1     Running            0                2d1h
api-gateway-7d4b9c8f5-hb9zt            1/1     Running            1 (31h ago)      2d1h
orders-worker-6c8b5d4f9-2xnpl          1/1     Running            0                6d
orders-worker-6c8b5d4f9-lk7wq          1/1     Running            0                6d
billing-sync-59f7c6d8b4-t8vrm          0/1     CrashLoopBackOff   142 (2m14s ago)  11h
billing-sync-59f7c6d8b4-w4pdz          0/1     CrashLoopBackOff   141 (94s ago)    11h
search-indexer-0                       1/1     Running            0                19d
search-indexer-1                       1/1     Running            0                19d
search-indexer-2                       0/1     Pending            0                4m11s
notifications-84dcb9f7c6-jr5nq         1/1     Running            2 (5d ago)       19d
notifications-84dcb9f7c6-vz8mk         1/1     Running            0                19d
migrations-run-28714920-6ktzr          0/1     ImagePullBackOff   0                8m42s
grafana-6f9d4c7b58-p2xhn               1/1     Running            0                19d
prometheus-0                           2/2     Running            0                19d`

// ── kubectl describe pod ──────────────────────────────────────────────────────
// The 200-400 line case. The single largest thing in it is the
// last-applied-configuration annotation - an entire Deployment manifest inlined
// on one line - followed by the Volumes and Environment blocks. What the agent
// came for is Status, the unsatisfied Conditions, and the Events table.
const KUBECTL_DESCRIBE_POD = `Name:             api-gateway-7d4b9c8f5-x2ktp
Namespace:        production
Priority:         0
Service Account:  api-gateway
Node:             ip-10-24-7-131.eu-west-1.compute.internal/10.24.7.131
Start Time:       Mon, 20 Jul 2026 06:12:44 +0000
Labels:           app.kubernetes.io/component=gateway
                  app.kubernetes.io/instance=api-gateway
                  app.kubernetes.io/managed-by=Helm
                  app.kubernetes.io/name=api-gateway
                  app.kubernetes.io/part-of=acme-platform
                  app.kubernetes.io/version=1.24.3
                  helm.sh/chart=api-gateway-3.4.1
                  pod-template-hash=7d4b9c8f5
Annotations:      checksum/config: 6f1c0f0c3a1a9b8d7e6f5a4b3c2d1e0f9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d
                  kubectl.kubernetes.io/restartedAt: 2026-07-20T06:12:41Z
                  kubectl.kubernetes.io/last-applied-configuration:
                    {"apiVersion":"apps/v1","kind":"Deployment","metadata":{"annotations":{"deployment.kubernetes.io/revision":"37"},"labels":{"app.kubernetes.io/instance":"api-gateway","app.kubernetes.io/managed-by":"Helm","app.kubernetes.io/name":"api-gateway","app.kubernetes.io/version":"1.24.3","helm.sh/chart":"api-gateway-3.4.1"},"name":"api-gateway","namespace":"production"},"spec":{"replicas":3,"revisionHistoryLimit":5,"selector":{"matchLabels":{"app.kubernetes.io/instance":"api-gateway","app.kubernetes.io/name":"api-gateway"}},"strategy":{"rollingUpdate":{"maxSurge":1,"maxUnavailable":0},"type":"RollingUpdate"},"template":{"metadata":{"annotations":{"prometheus.io/path":"/metrics","prometheus.io/port":"9102","prometheus.io/scrape":"true"},"labels":{"app.kubernetes.io/instance":"api-gateway","app.kubernetes.io/name":"api-gateway"}},"spec":{"containers":[{"env":[{"name":"NODE_ENV","value":"production"},{"name":"LOG_LEVEL","value":"info"},{"name":"PGHOST","value":"db.production.svc.cluster.local"},{"name":"REDIS_URL","value":"redis://redis.production.svc.cluster.local:6379"}],"image":"ghcr.io/acme/api-gateway:1.24.3","imagePullPolicy":"IfNotPresent","livenessProbe":{"httpGet":{"path":"/healthz","port":"http"},"initialDelaySeconds":15,"periodSeconds":10},"name":"api-gateway","ports":[{"containerPort":8080,"name":"http","protocol":"TCP"},{"containerPort":9102,"name":"metrics","protocol":"TCP"}],"readinessProbe":{"httpGet":{"path":"/readyz","port":"http"},"periodSeconds":5},"resources":{"limits":{"cpu":"1","memory":"768Mi"},"requests":{"cpu":"250m","memory":"256Mi"}},"volumeMounts":[{"mountPath":"/etc/api-gateway","name":"config","readOnly":true},{"mountPath":"/var/run/secrets/acme","name":"gateway-tls","readOnly":true},{"mountPath":"/tmp","name":"tmp"}]}],"serviceAccountName":"api-gateway","volumes":[{"configMap":{"name":"api-gateway-config"},"name":"config"},{"name":"gateway-tls","secret":{"secretName":"api-gateway-tls"}},{"emptyDir":{},"name":"tmp"}]}}}}
                  prometheus.io/path: /metrics
                  prometheus.io/port: 9102
                  prometheus.io/scrape: true
Status:           Running
IP:               10.24.9.44
IPs:
  IP:           10.24.9.44
Controlled By:  ReplicaSet/api-gateway-7d4b9c8f5
Init Containers:
  wait-for-migrations:
    Container ID:  containerd://5f0a3d2c1b0a9e8f7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b2a1f0e9d8c7b6a5f4e
    Image:         ghcr.io/acme/dbtools:0.9.2
    Image ID:      ghcr.io/acme/dbtools@sha256:1c0d9e8f7a6b5c4d3e2f1a0b9c8d7e6f5a4b3c2d1e0f9a8b7c6d5e4f3a2b1c0d
    Port:          <none>
    Host Port:     <none>
    Command:
      /bin/sh
      -c
    Args:
      until pg_isready -h db.production.svc.cluster.local -p 5432; do echo waiting for db; sleep 2; done
    State:          Terminated
      Reason:       Completed
      Exit Code:    0
      Started:      Mon, 20 Jul 2026 06:12:46 +0000
      Finished:     Mon, 20 Jul 2026 06:12:59 +0000
    Ready:          True
    Restart Count:  0
    Limits:
      cpu:     200m
      memory:  128Mi
    Requests:
      cpu:        100m
      memory:     64Mi
    Environment:
      PGHOST:      db.production.svc.cluster.local
      PGPORT:      5432
      PGUSER:      <set to the key 'username' in secret 'api-gateway-db'>  Optional: false
      PGPASSWORD:  <set to the key 'password' in secret 'api-gateway-db'>  Optional: false
    Mounts:
      /var/run/secrets/kubernetes.io/serviceaccount from kube-api-access-9v7qd (ro)
Containers:
  api-gateway:
    Container ID:   containerd://7e6d5c4b3a2f1e0d9c8b7a6f5e4d3c2b1a0f9e8d7c6b5a4f3e2d1c0b9a8f7e6d
    Image:          ghcr.io/acme/api-gateway:1.24.3
    Image ID:       ghcr.io/acme/api-gateway@sha256:9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b2a1f0e9d8c7b6a5f4e3d2c1b0a9f8e
    Ports:          8080/TCP, 9102/TCP
    Host Ports:     0/TCP, 0/TCP
    State:          Running
      Started:      Mon, 20 Jul 2026 06:13:01 +0000
    Last State:     Terminated
      Reason:       Error
      Exit Code:    137
      Started:      Sat, 18 Jul 2026 22:41:10 +0000
      Finished:     Mon, 20 Jul 2026 06:12:58 +0000
    Ready:          True
    Restart Count:  1
    Limits:
      cpu:     1
      memory:  768Mi
    Requests:
      cpu:      250m
      memory:   256Mi
    Liveness:   http-get http://:http/healthz delay=15s timeout=1s period=10s #success=1 #failure=3
    Readiness:  http-get http://:http/readyz delay=0s timeout=1s period=5s #success=1 #failure=3
    Environment:
      NODE_ENV:                  production
      LOG_LEVEL:                 info
      PGHOST:                    db.production.svc.cluster.local
      PGPORT:                    5432
      PGDATABASE:                acme
      REDIS_URL:                 redis://redis.production.svc.cluster.local:6379
      OTEL_EXPORTER_OTLP_ENDPOINT:  http://otel-collector.observability.svc.cluster.local:4318
      OTEL_SERVICE_NAME:         api-gateway
      OTEL_RESOURCE_ATTRIBUTES:  deployment.environment=production,service.version=1.24.3
      RATE_LIMIT_WINDOW_MS:      60000
      RATE_LIMIT_MAX:            600
      FEATURE_FLAGS_URL:         https://flags.internal.acme.example/v2/api-gateway
      SESSION_SECRET:            <set to the key 'session-secret' in secret 'api-gateway'>  Optional: false
      STRIPE_API_KEY:            <set to the key 'stripe-api-key' in secret 'api-gateway'>  Optional: false
      KUBERNETES_NODE_NAME:       (v1:spec.nodeName)
      POD_NAME:                  api-gateway-7d4b9c8f5-x2ktp (v1:metadata.name)
      POD_NAMESPACE:             production (v1:metadata.namespace)
    Mounts:
      /etc/api-gateway from config (ro)
      /tmp from tmp (rw)
      /var/run/secrets/acme from gateway-tls (ro)
      /var/run/secrets/kubernetes.io/serviceaccount from kube-api-access-9v7qd (ro)
  otel-sidecar:
    Container ID:  containerd://2b1a0f9e8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b3a2f1e0d9c8b7a6f5e4d3c2b1a
    Image:         otel/opentelemetry-collector-contrib:0.104.0
    Image ID:      docker.io/otel/opentelemetry-collector-contrib@sha256:5a4b3c2d1e0f9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c8d7e6f5a4b
    Port:          4318/TCP
    Host Port:     0/TCP
    Args:
      --config=/conf/collector.yaml
    State:          Waiting
      Reason:       CrashLoopBackOff
    Last State:     Terminated
      Reason:       Error
      Exit Code:    1
      Started:      Mon, 20 Jul 2026 09:44:02 +0000
      Finished:     Mon, 20 Jul 2026 09:44:03 +0000
    Ready:          False
    Restart Count:  47
    Limits:
      cpu:     200m
      memory:  256Mi
    Requests:
      cpu:        50m
      memory:     64Mi
    Environment:
      GOMEMLIMIT:  200MiB
    Mounts:
      /conf from otel-config (ro)
      /var/run/secrets/kubernetes.io/serviceaccount from kube-api-access-9v7qd (ro)
Conditions:
  Type                        Status
  PodReadyToStartContainers   True
  Initialized                 True
  Ready                       False
  ContainersReady             False
  PodScheduled                True
Volumes:
  config:
    Type:      ConfigMap (a volume populated by a ConfigMap)
    Name:      api-gateway-config
    Optional:  false
  otel-config:
    Type:      ConfigMap (a volume populated by a ConfigMap)
    Name:      otel-collector-config
    Optional:  false
  gateway-tls:
    Type:        Secret (a volume populated by a Secret)
    SecretName:  api-gateway-tls
    Optional:    false
  tmp:
    Type:       EmptyDir (a temporary directory that shares a pod's lifetime)
    Medium:
    SizeLimit:  <unset>
  kube-api-access-9v7qd:
    Type:                    Projected (a volume that contains injected data from multiple sources)
    TokenExpirationSeconds:  3607
    ConfigMapName:           kube-root-ca.crt
    ConfigMapOptional:       <nil>
    DownwardAPI:             true
QoS Class:                   Burstable
Node-Selectors:              kubernetes.io/os=linux
                             topology.kubernetes.io/zone=eu-west-1b
Tolerations:                 node.kubernetes.io/memory-pressure:NoSchedule op=Exists
                             node.kubernetes.io/not-ready:NoExecute op=Exists for 300s
                             node.kubernetes.io/unreachable:NoExecute op=Exists for 300s
                             workload=platform:NoSchedule
Events:
  Type     Reason     Age                     From               Message
  ----     ------     ----                    ----               -------
  Normal   Scheduled  3h32m                   default-scheduler  Successfully assigned production/api-gateway-7d4b9c8f5-x2ktp to ip-10-24-7-131.eu-west-1.compute.internal
  Normal   Pulled     3h32m                   kubelet            Container image "ghcr.io/acme/dbtools:0.9.2" already present on machine
  Normal   Created    3h32m                   kubelet            Created container wait-for-migrations
  Normal   Started    3h32m                   kubelet            Started container wait-for-migrations
  Normal   Pulled     3h32m                   kubelet            Container image "ghcr.io/acme/api-gateway:1.24.3" already present on machine
  Normal   Created    3h32m                   kubelet            Created container api-gateway
  Normal   Started    3h32m                   kubelet            Started container api-gateway
  Warning  Unhealthy  3h31m (x2 over 3h31m)   kubelet            Readiness probe failed: Get "http://10.24.9.44:8080/readyz": dial tcp 10.24.9.44:8080: connect: connection refused
  Normal   Pulled     3h30m (x3 over 3h32m)   kubelet            Container image "otel/opentelemetry-collector-contrib:0.104.0" already present on machine
  Warning  BackOff    2m37s (x812 over 3h30m) kubelet            Back-off restarting failed container otel-sidecar in pod api-gateway-7d4b9c8f5-x2ktp_production(4c1f2a7e-9b3d-4e6a-8f1c-2d5b7a9e0c3f)`

// ── helm list ─────────────────────────────────────────────────────────────────
// helm renders with uitable: cells padded to the column width, then joined with
// a TAB. The UPDATED column is a 37-char Go timestamp and the widest thing in
// the table.
const HELM_LIST = `NAME           \tNAMESPACE     \tREVISION\tUPDATED                                \tSTATUS  \tCHART                 \tAPP VERSION
api-gateway    \tproduction    \t37      \t2026-07-20 06:12:41.118422 +0000 UTC    \tdeployed\tapi-gateway-3.4.1     \t1.24.3
billing-sync   \tproduction    \t12      \t2026-07-19 18:03:55.771209 +0000 UTC    \tfailed  \tbilling-sync-0.9.4    \t0.14.2
cert-manager   \tcert-manager  \t8       \t2026-05-02 11:41:09.330871 +0000 UTC    \tdeployed\tcert-manager-v1.15.1  \tv1.15.1
external-dns   \tkube-system   \t4       \t2026-04-28 09:17:44.902314 +0000 UTC    \tdeployed\texternal-dns-8.3.5    \t0.14.2
ingress-nginx  \tingress-nginx \t21      \t2026-06-30 15:22:07.664190 +0000 UTC    \tdeployed\tingress-nginx-4.11.1  \t1.11.1
kube-prometheus\tobservability \t16      \t2026-07-11 07:55:31.209773 +0000 UTC    \tdeployed\tkube-prometheus-61.3.2\tv0.75.1
loki           \tobservability \t9       \t2026-06-14 12:08:19.441055 +0000 UTC    \tpending-upgrade\tloki-6.6.4    \t3.1.0
orders-worker  \tproduction    \t58      \t2026-07-20 06:12:39.884210 +0000 UTC    \tdeployed\torders-worker-2.2.0   \t2.8.0
redis          \tproduction    \t3       \t2026-03-19 16:44:02.117338 +0000 UTC    \tdeployed\tredis-19.6.2          \t7.2.5
search         \tsearch        \t27      \t2026-07-02 22:31:50.005914 +0000 UTC    \tdeployed\telasticsearch-21.3.7  \t8.14.1`

// ── terraform plan ────────────────────────────────────────────────────────────
// A plan is a full resource diff - every unchanged attribute of every touched
// resource - wrapped in a fixed preamble. The answer is the Plan: line and
// which addresses move.
const TERRAFORM_PLAN = `data.aws_caller_identity.current: Reading...
data.aws_region.current: Reading...
data.aws_region.current: Read complete after 0s [id=eu-west-1]
data.aws_caller_identity.current: Read complete after 0s [id=401238819920]
aws_ecs_cluster.prod: Refreshing state... [id=arn:aws:ecs:eu-west-1:401238819920:cluster/prod]
aws_ecs_service.api: Refreshing state... [id=arn:aws:ecs:eu-west-1:401238819920:service/prod/api]
aws_ecs_task_definition.api: Refreshing state... [id=api]
aws_s3_bucket.artifacts: Refreshing state... [id=acme-prod-artifacts]
aws_s3_bucket.logs: Refreshing state... [id=acme-prod-logs]
aws_iam_role.task_execution: Refreshing state... [id=acme-prod-task-execution]
aws_cloudwatch_log_group.api: Refreshing state... [id=/ecs/prod/api]
module.rds.aws_db_instance.primary: Refreshing state... [id=acme-prod-db]
module.rds.aws_db_parameter_group.this: Refreshing state... [id=acme-prod-pg16]

Terraform used the selected providers to generate the following execution
plan. Resource actions are indicated with the following symbols:
  + create
  ~ update in-place
  - destroy

Terraform will perform the following actions:

  # aws_cloudwatch_log_group.api will be updated in-place
  ~ resource "aws_cloudwatch_log_group" "api" {
        id                = "/ecs/prod/api"
        name              = "/ecs/prod/api"
      ~ retention_in_days = 7 -> 30
        tags              = {
            "env"     = "prod"
            "service" = "api"
        }
        # (5 unchanged attributes hidden)
    }

  # aws_ecs_service.api will be updated in-place
  ~ resource "aws_ecs_service" "api" {
        id                                 = "arn:aws:ecs:eu-west-1:401238819920:service/prod/api"
      ~ desired_count                      = 4 -> 6
        enable_ecs_managed_tags            = true
        health_check_grace_period_seconds  = 60
        launch_type                        = "FARGATE"
        name                               = "api"
        platform_version                   = "LATEST"
        scheduling_strategy                = "REPLICA"
      ~ task_definition                    = "arn:aws:ecs:eu-west-1:401238819920:task-definition/api:118" -> (known after apply)
        # (11 unchanged attributes hidden)

        network_configuration {
            assign_public_ip = false
            security_groups  = [
                "sg-0a1b2c3d4e5f60718",
            ]
            subnets          = [
                "subnet-0123456789abcdef0",
                "subnet-0fedcba9876543210",
            ]
        }
    }

  # aws_ecs_task_definition.api will be created
  + resource "aws_ecs_task_definition" "api" {
      + arn                      = (known after apply)
      + container_definitions    = jsonencode(
            [
              + {
                  + cpu         = 512
                  + environment = [
                      + {
                          + name  = "LOG_LEVEL"
                          + value = "info"
                        },
                    ]
                  + image       = "401238819920.dkr.ecr.eu-west-1.amazonaws.com/api:1.24.3"
                  + memory      = 1024
                  + name        = "api"
                },
            ]
        )
      + cpu                      = "512"
      + execution_role_arn       = "arn:aws:iam::401238819920:role/acme-prod-task-execution"
      + family                   = "api"
      + id                       = (known after apply)
      + memory                   = "1024"
      + network_mode             = "awsvpc"
      + requires_compatibilities = [
          + "FARGATE",
        ]
      + revision                 = (known after apply)
    }

  # aws_s3_bucket.logs will be destroyed
  - resource "aws_s3_bucket" "logs" {
      - arn                         = "arn:aws:s3:::acme-prod-logs" -> null
      - bucket                      = "acme-prod-logs" -> null
      - bucket_domain_name          = "acme-prod-logs.s3.amazonaws.com" -> null
      - force_destroy               = false -> null
      - hosted_zone_id              = "Z1BKCTXD74EZPE" -> null
      - id                          = "acme-prod-logs" -> null
      - object_lock_enabled         = false -> null
      - region                      = "eu-west-1" -> null
      - request_payer               = "BucketOwner" -> null
      - tags                        = {
          - "env" = "prod"
        } -> null
    }

  # aws_security_group_rule.legacy_ssh will be destroyed
  - resource "aws_security_group_rule" "legacy_ssh" {
      -cidr_blocks       = [
          - "10.0.0.0/8",
        ] -> null
      - from_port         = 22 -> null
      - id                = "sgrule-2841938471" -> null
      - protocol          = "tcp" -> null
      - security_group_id = "sg-0a1b2c3d4e5f60718" -> null
      - to_port           = 22 -> null
      - type              = "ingress" -> null
    }

  # module.rds.aws_db_parameter_group.tuned will be created
  + resource "aws_db_parameter_group" "tuned" {
      + arn         = (known after apply)
      + description = "Managed by Terraform"
      + family      = "postgres16"
      + id          = (known after apply)
      + name        = (known after apply)
      + name_prefix = "acme-prod-pg16-tuned-"

      + parameter {
          + apply_method = "pending-reboot"
          + name         = "max_connections"
          + value        = "400"
        }
      + parameter {
          + apply_method = "immediate"
          + name         = "log_min_duration_statement"
          + value        = "500"
        }
    }

  # module.rds.aws_db_instance.replica will be created
  + resource "aws_db_instance" "replica" {
      + allocated_storage           = 200
      + arn                         = (known after apply)
      + auto_minor_version_upgrade  = true
      + availability_zone           = (known after apply)
      + backup_retention_period     = 7
      + endpoint                    = (known after apply)
      + engine                      = "postgres"
      + engine_version              = "16.3"
      + id                          = (known after apply)
      + identifier                  = "acme-prod-db-replica"
      + instance_class              = "db.r6g.xlarge"
      + replicate_source_db         = "acme-prod-db"
      + storage_encrypted           = true
      + storage_type                = "gp3"
    }

Plan: 3 to add, 2 to change, 2 to destroy.

Changes to Outputs:
  ~ db_replica_endpoint = (known after apply)

Note: You didn't use the -out option to save this plan, so Terraform can't
guarantee to take exactly these actions if you run "terraform apply" now.`

// ── tofu plan ─────────────────────────────────────────────────────────────────
const TOFU_PLAN = `module.network.data.aws_availability_zones.available: Reading...
module.network.data.aws_availability_zones.available: Read complete after 0s [id=eu-central-1]
module.network.aws_vpc.this: Refreshing state... [id=vpc-0c1d2e3f4a5b6c7d8]
module.network.aws_subnet.private[0]: Refreshing state... [id=subnet-0aa11bb22cc33dd44]
module.network.aws_subnet.private[1]: Refreshing state... [id=subnet-0ee55ff66aa77bb88]
module.network.aws_nat_gateway.this: Refreshing state... [id=nat-0123456789abcdef0]
kubernetes_namespace.staging: Refreshing state... [id=staging]
helm_release.ingress_nginx: Refreshing state... [id=ingress-nginx]

OpenTofu used the selected providers to generate the following execution plan.
Resource actions are indicated with the following symbols:
  + create
  ~ update in-place

OpenTofu will perform the following actions:

  # helm_release.ingress_nginx will be updated in-place
  ~ resource "helm_release" "ingress_nginx" {
        id                         = "ingress-nginx"
        name                       = "ingress-nginx"
        namespace                  = "ingress-nginx"
      ~ version                    = "4.10.6" -> "4.11.1"
        atomic                     = true
        cleanup_on_fail            = true
        create_namespace           = false
        # (24 unchanged attributes hidden)
    }

  # kubernetes_config_map.feature_flags will be created
  + resource "kubernetes_config_map" "feature_flags" {
      + data = {
          + "flags.json" = jsonencode(
                {
                  + checkout_v2   = true
                  + orders_search = false
                }
            )
        }
      + id   = (known after apply)

      + metadata {
          + generation       = (known after apply)
          + name             = "feature-flags"
          + namespace        = "staging"
          + resource_version = (known after apply)
          + uid              = (known after apply)
        }
    }

  # module.network.aws_subnet.private[2] will be created
  + resource "aws_subnet" "private" {
      + arn                            = (known after apply)
      + assign_ipv6_address_on_creation = false
      + availability_zone              = "eu-central-1c"
      + cidr_block                     = "10.42.6.0/22"
      + id                             = (known after apply)
      + map_public_ip_on_launch        = false
      + tags                           = {
          + "Name" = "acme-staging-private-c"
          + "tier" = "private"
        }
      + vpc_id                         = "vpc-0c1d2e3f4a5b6c7d8"
    }

Plan: 2 to add, 1 to change, 0 to destroy.`

// ── aws (default output format: JSON) ─────────────────────────────────────────
// Nothing on the command line says "json" - it is simply the default - so
// isMachineOutput cannot see it, and \`aws … | jq\` is the normal way to consume
// it. condenseAws re-serialises the SAME document compactly: still one valid
// JSON value, byte-identical once parsed, minus every space of indentation.
const AWS_DESCRIBE_INSTANCES = `{
    "Reservations": [
        {
            "ReservationId": "r-0a1b2c3d4e5f60718",
            "OwnerId": "401238819920",
            "Groups": [],
            "Instances": [
                {
                    "AmiLaunchIndex": 0,
                    "ImageId": "ami-0e2f1a9c8b7d6e5f4",
                    "InstanceId": "i-04c3f1a2b9d8e7061",
                    "InstanceType": "m6i.xlarge",
                    "KeyName": "acme-prod",
                    "LaunchTime": "2026-05-14T08:22:41.000Z",
                    "Monitoring": {
                        "State": "disabled"
                    },
                    "Placement": {
                        "AvailabilityZone": "eu-west-1b",
                        "GroupName": "",
                        "Tenancy": "default"
                    },
                    "PrivateDnsName": "ip-10-24-7-131.eu-west-1.compute.internal",
                    "PrivateIpAddress": "10.24.7.131",
                    "ProductCodes": [],
                    "PublicDnsName": "",
                    "State": {
                        "Code": 16,
                        "Name": "running"
                    },
                    "StateTransitionReason": "",
                    "SubnetId": "subnet-0123456789abcdef0",
                    "VpcId": "vpc-0c1d2e3f4a5b6c7d8",
                    "Architecture": "x86_64",
                    "BlockDeviceMappings": [
                        {
                            "DeviceName": "/dev/xvda",
                            "Ebs": {
                                "AttachTime": "2026-05-14T08:22:42.000Z",
                                "DeleteOnTermination": true,
                                "Status": "attached",
                                "VolumeId": "vol-0abcdef1234567890"
                            }
                        }
                    ],
                    "ClientToken": "",
                    "EbsOptimized": true,
                    "EnaSupport": true,
                    "Hypervisor": "xen",
                    "IamInstanceProfile": {
                        "Arn": "arn:aws:iam::401238819920:instance-profile/acme-prod-node",
                        "Id": "AIPA4XKQZ2VJH7T6R9LMN"
                    },
                    "RootDeviceName": "/dev/xvda",
                    "RootDeviceType": "ebs",
                    "SecurityGroups": [
                        {
                            "GroupName": "acme-prod-node",
                            "GroupId": "sg-0a1b2c3d4e5f60718"
                        }
                    ],
                    "SourceDestCheck": true,
                    "Tags": [
                        {
                            "Key": "Name",
                            "Value": "acme-prod-node-1b-01"
                        },
                        {
                            "Key": "env",
                            "Value": "prod"
                        },
                        {
                            "Key": "kubernetes.io/cluster/acme-prod",
                            "Value": "owned"
                        }
                    ],
                    "VirtualizationType": "hvm",
                    "CpuOptions": {
                        "CoreCount": 2,
                        "ThreadsPerCore": 2
                    },
                    "CapacityReservationSpecification": {
                        "CapacityReservationPreference": "open"
                    },
                    "HibernationOptions": {
                        "Configured": false
                    },
                    "MetadataOptions": {
                        "State": "applied",
                        "HttpTokens": "required",
                        "HttpPutResponseHopLimit": 2,
                        "HttpEndpoint": "enabled",
                        "InstanceMetadataTags": "disabled"
                    },
                    "EnclaveOptions": {
                        "Enabled": false
                    },
                    "PlatformDetails": "Linux/UNIX",
                    "UsageOperation": "RunInstances",
                    "UsageOperationUpdateTime": "2026-05-14T08:22:41.000Z",
                    "PrivateDnsNameOptions": {
                        "HostnameType": "ip-name",
                        "EnableResourceNameDnsARecord": true,
                        "EnableResourceNameDnsAAAARecord": false
                    },
                    "MaintenanceOptions": {
                        "AutoRecovery": "default"
                    },
                    "CurrentInstanceBootMode": "legacy-bios"
                },
                {
                    "AmiLaunchIndex": 1,
                    "ImageId": "ami-0e2f1a9c8b7d6e5f4",
                    "InstanceId": "i-0f7e6d5c4b3a29180",
                    "InstanceType": "m6i.xlarge",
                    "KeyName": "acme-prod",
                    "LaunchTime": "2026-05-14T08:22:41.000Z",
                    "Monitoring": {
                        "State": "disabled"
                    },
                    "Placement": {
                        "AvailabilityZone": "eu-west-1c",
                        "GroupName": "",
                        "Tenancy": "default"
                    },
                    "PrivateDnsName": "ip-10-24-8-77.eu-west-1.compute.internal",
                    "PrivateIpAddress": "10.24.8.77",
                    "ProductCodes": [],
                    "PublicDnsName": "",
                    "State": {
                        "Code": 16,
                        "Name": "running"
                    },
                    "StateTransitionReason": "",
                    "SubnetId": "subnet-0fedcba9876543210",
                    "VpcId": "vpc-0c1d2e3f4a5b6c7d8",
                    "Architecture": "x86_64",
                    "BlockDeviceMappings": [
                        {
                            "DeviceName": "/dev/xvda",
                            "Ebs": {
                                "AttachTime": "2026-05-14T08:22:42.000Z",
                                "DeleteOnTermination": true,
                                "Status": "attached",
                                "VolumeId": "vol-01234567890abcdef"
                            }
                        }
                    ],
                    "ClientToken": "",
                    "EbsOptimized": true,
                    "EnaSupport": true,
                    "Hypervisor": "xen",
                    "RootDeviceName": "/dev/xvda",
                    "RootDeviceType": "ebs",
                    "SecurityGroups": [
                        {
                            "GroupName": "acme-prod-node",
                            "GroupId": "sg-0a1b2c3d4e5f60718"
                        }
                    ],
                    "SourceDestCheck": true,
                    "Tags": [
                        {
                            "Key": "Name",
                            "Value": "acme-prod-node-1c-01"
                        },
                        {
                            "Key": "env",
                            "Value": "prod"
                        }
                    ],
                    "VirtualizationType": "hvm",
                    "CpuOptions": {
                        "CoreCount": 2,
                        "ThreadsPerCore": 2
                    },
                    "MetadataOptions": {
                        "State": "applied",
                        "HttpTokens": "required",
                        "HttpPutResponseHopLimit": 2,
                        "HttpEndpoint": "enabled",
                        "InstanceMetadataTags": "disabled"
                    },
                    "PlatformDetails": "Linux/UNIX",
                    "UsageOperation": "RunInstances",
                    "CurrentInstanceBootMode": "legacy-bios"
                }
            ]
        }
    ]
}`

// ── psql ──────────────────────────────────────────────────────────────────────
// The only thing condensePsql can remove from a default (aligned) result is the
// ruler under the header, so the floor here is small and honest.
//
// One caveat about the number: psql pads every cell to its column width
// INCLUDING the last one, so in real output each NULL in the trailing column is
// followed by 26 spaces, which compress() would strip for free (measured 23%
// with that padding restored, 5% without). Trailing whitespace does not survive
// reliably in a source file - any editor that trims on save would silently move
// the measurement - so the fixture is committed unpadded and the floor is set
// against the conservative 5%.
const PSQL_TABLE = ` id  |            email             |   plan    | seats |         created_at         |        canceled_at
-----+------------------------------+-----------+-------+----------------------------+----------------------------
 101 | ops@northwind.example        | team      |    25 | 2025-11-02 09:14:22.118+00 |
 104 | billing@globex.example       | business  |   140 | 2025-11-08 17:41:03.552+00 |
 109 | dev@initech.example          | starter   |     3 | 2025-12-01 08:02:47.910+00 | 2026-02-14 08:11:52.441+00
 112 | platform@umbrella.example    | business  |   310 | 2025-12-14 13:37:19.004+00 |
 118 | admin@hooli.example          | team      |    48 | 2026-01-05 10:55:41.762+00 |
 121 | it@vehement.example          | starter   |     5 | 2026-01-09 22:18:06.330+00 | 2026-03-02 19:47:11.208+00
 126 | eng@stark.example            | enterprise|   980 | 2026-01-17 06:44:58.117+00 |
 130 | ops@wayne.example            | enterprise|   615 | 2026-01-23 15:09:12.883+00 |
 133 | accounts@acme.example        | team      |    31 | 2026-02-02 11:26:35.475+00 |
 137 | dev@cyberdyne.example        | starter   |     2 | 2026-02-11 09:51:44.019+00 | 2026-04-19 07:03:28.664+00
 141 | infra@soylent.example        | business  |    96 | 2026-02-19 18:12:57.238+00 |
 146 | ops@tyrell.example           | enterprise|  1240 | 2026-03-01 07:35:20.601+00 |
 150 | billing@massive.example      | team      |    27 | 2026-03-09 14:48:03.977+00 |
 154 | dev@paper.example            | starter   |     4 | 2026-03-15 20:01:39.145+00 |
 159 | admin@bluth.example          | business  |    73 | 2026-03-27 05:22:51.809+00 | 2026-06-30 12:40:07.552+00
 163 | ops@pied-piper.example       | team      |    19 | 2026-04-04 16:57:44.362+00 |
 168 | eng@hooli-xyz.example        | business  |   205 | 2026-04-12 08:29:16.740+00 |
 172 | platform@aviato.example      | starter   |     6 | 2026-04-25 21:03:58.291+00 |
 177 | ops@duff.example             | team      |    42 | 2026-05-03 12:14:29.855+00 |
 181 | billing@krusty.example       | business  |   118 | 2026-05-19 09:47:12.406+00 |
 186 | dev@planet-express.example   | starter   |     8 | 2026-06-01 23:36:05.673+00 |
 190 | ops@momcorp.example          | enterprise|  2050 | 2026-06-14 04:18:47.229+00 |
 195 | admin@bigco.example          | team      |    36 | 2026-06-28 19:52:33.918+00 |
 199 | eng@nakatomi.example         | business  |   164 | 2026-07-09 10:07:26.481+00 |
(24 rows)`

// ── curl (JSON body) ──────────────────────────────────────────────────────────
// curl's progress meter goes to stderr, so stdout is exactly the response body.
// condenseCurl re-serialises a JSON body compactly, which keeps
// \`curl … | jq\` working - the reason it does not use the "[N items]" preview.
const CURL_JSON = `{
  "object": "list",
  "url": "/v1/orders",
  "has_more": true,
  "data": [
    {
      "id": "ord_1P9xQ2Ej8kLmNoPq",
      "object": "order",
      "amount_total": 24990,
      "currency": "eur",
      "customer": "cus_QaZ1xSw2De3Fr",
      "created": 1784551122,
      "status": "complete",
      "payment_status": "paid",
      "livemode": false,
      "metadata": {
        "channel": "web",
        "cart_id": "cart_9f3a1c",
        "referrer": "newsletter-2026-07"
      },
      "shipping": {
        "carrier": "dhl",
        "tracking_number": "JJD000390075119116",
        "address": {
          "city": "Rotterdam",
          "country": "NL",
          "line1": "Weena 505",
          "postal_code": "3013 AL"
        }
      },
      "line_items": [
        {
          "id": "li_7Hg5Tf4Rd3Es",
          "description": "Acme Widget Pro (annual)",
          "quantity": 1,
          "amount_subtotal": 19990,
          "amount_total": 19990
        },
        {
          "id": "li_2Bn8Mk9Lp0Oi",
          "description": "Priority support add-on",
          "quantity": 1,
          "amount_subtotal": 5000,
          "amount_total": 5000
        }
      ]
    },
    {
      "id": "ord_1P9xR7Uv6wXyZaBc",
      "object": "order",
      "amount_total": 8900,
      "currency": "eur",
      "customer": "cus_RbY2yTx3Ef4Gs",
      "created": 1784550013,
      "status": "complete",
      "payment_status": "paid",
      "livemode": false,
      "metadata": {
        "channel": "ios",
        "cart_id": "cart_2b7e4d",
        "referrer": "organic"
      },
      "shipping": {
        "carrier": "postnl",
        "tracking_number": "3SPNL8842019773",
        "address": {
          "city": "Antwerpen",
          "country": "BE",
          "line1": "Meir 78",
          "postal_code": "2000"
        }
      },
      "line_items": [
        {
          "id": "li_4Kj6Yh5Gf7Ds",
          "description": "Acme Widget Standard (monthly)",
          "quantity": 1,
          "amount_subtotal": 8900,
          "amount_total": 8900
        }
      ]
    },
    {
      "id": "ord_1P9xS1Cd0eFgHiJk",
      "object": "order",
      "amount_total": 149700,
      "currency": "usd",
      "customer": "cus_ScX3zUw4Fg5Ht",
      "created": 1784548907,
      "status": "processing",
      "payment_status": "unpaid",
      "livemode": false,
      "metadata": {
        "channel": "sales",
        "cart_id": "cart_5c1f9a",
        "po_number": "PO-2026-0714"
      },
      "shipping": {
        "carrier": "ups",
        "tracking_number": null,
        "address": {
          "city": "Austin",
          "country": "US",
          "line1": "600 Congress Ave",
          "postal_code": "78701"
        }
      },
      "line_items": [
        {
          "id": "li_9Pl3Qw2Er1Ty",
          "description": "Acme Widget Enterprise (annual, 50 seats)",
          "quantity": 50,
          "amount_subtotal": 149700,
          "amount_total": 149700
        }
      ]
    }
  ]
}`

// ── wget ──────────────────────────────────────────────────────────────────────
// wget writes its transfer log ("Resolving…", "HTTP request sent…", the dot
// meter) to STDERR, and the frame passes stderr through untouched - compress()
// only ever sees the child's stdout. With \`-O -\` that stdout is the fetched
// payload itself, and nothing in it is wget's own chatter.
const WGET_BODY = `{
  "schemaVersion": 2,
  "name": "acme-platform",
  "channel": "stable",
  "current": {
    "version": "1.24.3",
    "released": "2026-07-18T11:04:00Z",
    "sha256": "9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b2a1f0e9d8c7b6a5f4e3d2c1b0a9f8e",
    "url": "https://downloads.acme.example/platform/1.24.3/acme-platform-linux-amd64.tar.gz"
  },
  "previous": {
    "version": "1.24.2",
    "released": "2026-07-04T09:31:00Z",
    "sha256": "1c0d9e8f7a6b5c4d3e2f1a0b9c8d7e6f5a4b3c2d1e0f9a8b7c6d5e4f3a2b1c0d",
    "url": "https://downloads.acme.example/platform/1.24.2/acme-platform-linux-amd64.tar.gz"
  },
  "supported": ["1.24", "1.23", "1.22"],
  "eol": {"1.21": "2026-04-30", "1.20": "2026-01-31"}
}`

// ── jq (large array) ──────────────────────────────────────────────────────────
const JQ_ARRAY = `[
  {
    "name": "acme/api-gateway",
    "private": true,
    "default_branch": "main",
    "open_issues": 14,
    "pushed_at": "2026-07-20T06:11:58Z"
  },
  {
    "name": "acme/orders-worker",
    "private": true,
    "default_branch": "main",
    "open_issues": 3,
    "pushed_at": "2026-07-19T21:44:12Z"
  },
  {
    "name": "acme/billing-sync",
    "private": true,
    "default_branch": "main",
    "open_issues": 27,
    "pushed_at": "2026-07-20T04:02:33Z"
  },
  {
    "name": "acme/platform-charts",
    "private": true,
    "default_branch": "main",
    "open_issues": 5,
    "pushed_at": "2026-07-17T13:20:41Z"
  },
  {
    "name": "acme/terraform-modules",
    "private": true,
    "default_branch": "main",
    "open_issues": 9,
    "pushed_at": "2026-07-16T08:55:07Z"
  },
  {
    "name": "acme/web-storefront",
    "private": true,
    "default_branch": "main",
    "open_issues": 61,
    "pushed_at": "2026-07-20T05:38:19Z"
  },
  {
    "name": "acme/design-system",
    "private": false,
    "default_branch": "main",
    "open_issues": 12,
    "pushed_at": "2026-07-15T16:09:52Z"
  },
  {
    "name": "acme/mobile-ios",
    "private": true,
    "default_branch": "develop",
    "open_issues": 33,
    "pushed_at": "2026-07-18T19:27:44Z"
  },
  {
    "name": "acme/mobile-android",
    "private": true,
    "default_branch": "develop",
    "open_issues": 41,
    "pushed_at": "2026-07-18T20:03:11Z"
  },
  {
    "name": "acme/search-indexer",
    "private": true,
    "default_branch": "main",
    "open_issues": 2,
    "pushed_at": "2026-07-11T07:14:36Z"
  },
  {
    "name": "acme/notifications",
    "private": true,
    "default_branch": "main",
    "open_issues": 7,
    "pushed_at": "2026-07-14T11:48:23Z"
  },
  {
    "name": "acme/data-pipeline",
    "private": true,
    "default_branch": "main",
    "open_issues": 18,
    "pushed_at": "2026-07-19T09:31:05Z"
  },
  {
    "name": "acme/ml-features",
    "private": true,
    "default_branch": "main",
    "open_issues": 22,
    "pushed_at": "2026-07-12T22:17:49Z"
  },
  {
    "name": "acme/docs-site",
    "private": false,
    "default_branch": "main",
    "open_issues": 4,
    "pushed_at": "2026-07-13T10:41:28Z"
  },
  {
    "name": "acme/status-page",
    "private": false,
    "default_branch": "main",
    "open_issues": 1,
    "pushed_at": "2026-06-29T14:52:16Z"
  },
  {
    "name": "acme/internal-tools",
    "private": true,
    "default_branch": "main",
    "open_issues": 35,
    "pushed_at": "2026-07-20T02:06:57Z"
  },
  {
    "name": "acme/cli",
    "private": false,
    "default_branch": "main",
    "open_issues": 16,
    "pushed_at": "2026-07-10T18:34:02Z"
  },
  {
    "name": "acme/sdk-python",
    "private": false,
    "default_branch": "main",
    "open_issues": 8,
    "pushed_at": "2026-07-08T07:59:40Z"
  },
  {
    "name": "acme/sdk-typescript",
    "private": false,
    "default_branch": "main",
    "open_issues": 11,
    "pushed_at": "2026-07-09T15:12:31Z"
  },
  {
    "name": "acme/sdk-go",
    "private": false,
    "default_branch": "main",
    "open_issues": 6,
    "pushed_at": "2026-07-06T12:25:14Z"
  },
  {
    "name": "acme/infra-runbooks",
    "private": true,
    "default_branch": "main",
    "open_issues": 0,
    "pushed_at": "2026-05-22T09:03:47Z"
  },
  {
    "name": "acme/security-policies",
    "private": true,
    "default_branch": "main",
    "open_issues": 3,
    "pushed_at": "2026-06-17T17:40:22Z"
  },
  {
    "name": "acme/legacy-monolith",
    "private": true,
    "default_branch": "master",
    "open_issues": 208,
    "pushed_at": "2026-02-28T13:11:09Z"
  },
  {
    "name": "acme/sandbox",
    "private": true,
    "default_branch": "main",
    "open_issues": 0,
    "pushed_at": "2026-07-01T08:44:55Z"
  }
]`

// Every floor below was measured against this exact fixture through the linked
// compress(), then rounded DOWN with several points of headroom, so a condenser
// tweak has to lose real ground before the matrix goes red. Measurements are
// quoted in each `what` as "(measured N%)".
export const INFRA_MATRIX: MatrixEntry[] = [
  {
    cmd: 'docker',
    args: ['ps'],
    what: '8 running containers with the full COMMAND/CREATED/PORTS columns (measured 73%)',
    input: DOCKER_PS,
    minReduction: 64,
  },
  {
    cmd: 'docker',
    args: ['build', '-t', 'ghcr.io/acme/api-gateway:1.24.3', '.'],
    what: "BuildKit plain progress for a 14-stage image build (measured 32%) - docker prints it on stderr, see the fixture's note",
    // This entry used to read minReduction 0 + a passthroughReason that said
    // "condenseDocker recognises only the legacy builder markers ... so it
    // removes blank lines and nothing else". That is a condenser that does not
    // work, which is exactly what the contract in test/support/matrix.ts
    // forbids a passthroughReason from covering. condenseDockerBuildKit now
    // handles the shape: one header per contiguous run of a step (steps
    // interleave in a parallel build, so the "#N" prefix is kept wherever the
    // step changes), the repeated elapsed clock off the front of every line a
    // RUN step printed, and the DONE / transferring / resolve / sha256 progress
    // echoes dropped. Step names, RUN output, CACHED, ERROR and the final
    // "naming to <tag>" all survive verbatim.
    //
    // Measured 32% here, and 73% on a REAL capture (docker 29.4.1,
    // `docker build --progress=plain --no-cache .`, 2238 -> 608 chars): this
    // fixture is deliberately dense in RUN output, which is the part that is
    // kept, so it is the conservative sample of the two.
    //
    // The floor is a floor on the CONDENSER. See the fixture's note above for
    // which stream carries these bytes: on a current engine it is stderr, which
    // this proxy never compresses, so no part of this 32% is a saving the
    // wrapper banks for `docker build` today.
    input: DOCKER_BUILD_BUILDKIT,
    minReduction: 25,
  },
  {
    cmd: 'docker',
    args: ['build', '-q', '.'],
    what: 'what a BuildKit `docker build` really puts on stdout: one image id',
    input: DOCKER_BUILD_QUIET,
    minReduction: 0,
    passthroughReason:
      '-q makes stdout a single image id and puts everything else on stderr. It exists to be ' +
      'substituted - `docker run $(docker build -q .)` - so the id is a machine format with a ' +
      'consumer, and dockerIsMachineForm routes it out of the build branch untouched. This is ' +
      'the entry that describes the DOMINANT modern invocation: measured on docker 29.4.1, a ' +
      'BuildKit build writes its whole transcript to stderr, so this one line is all the ' +
      'wrapper is ever handed for it.',
  },
  {
    cmd: 'docker',
    args: ['build', '-t', 'ghcr.io/acme/api-gateway:1.24.3', '.'],
    what: 'legacy builder (DOCKER_BUILDKIT=0) transcript on stdout, the shape the build branch was written for (measured 20%)',
    input: DOCKER_BUILD_LEGACY,
    minReduction: 14,
  },
  {
    cmd: 'kubectl',
    args: ['get', 'pods', '-n', 'production'],
    what: '15-pod namespace with two CrashLoopBackOff, one Pending and one ImagePullBackOff (measured 85%)',
    input: KUBECTL_GET_PODS,
    minReduction: 78,
  },
  {
    cmd: 'kubectl',
    args: ['describe', 'pod', 'api-gateway-7d4b9c8f5-x2ktp', '-n', 'production'],
    what: 'the 200-line describe: inlined last-applied-configuration, 3 containers, volumes, events (measured 74%)',
    input: KUBECTL_DESCRIBE_POD,
    minReduction: 66,
  },
  {
    cmd: 'helm',
    args: ['list', '-A'],
    what: '10 releases across a cluster, uitable-padded, with the 37-char UPDATED timestamp (measured 47%)',
    input: HELM_LIST,
    minReduction: 40,
  },
  {
    cmd: 'terraform',
    args: ['plan'],
    what: 'a 7-resource plan: full attribute diff plus the refresh preamble (measured 96%)',
    input: TERRAFORM_PLAN,
    minReduction: 88,
  },
  {
    cmd: 'tofu',
    args: ['plan'],
    what: 'OpenTofu plan over a helm_release, a config map and a subnet (measured 94%)',
    input: TOFU_PLAN,
    minReduction: 86,
  },
  {
    cmd: 'aws',
    args: ['ec2', 'describe-instances'],
    what: 'the DEFAULT output format - JSON, with nothing in argv saying so - recompacted to one still-valid JSON value (measured 56%)',
    input: AWS_DESCRIBE_INSTANCES,
    minReduction: 48,
  },
  {
    cmd: 'psql',
    args: ['-h', 'db.internal', '-U', 'analytics', '-d', 'billing', '-c', 'select id, email, plan, seats, created_at, canceled_at from subscriptions order by id'],
    what: '24-row aligned result table; only the header ruler is removable (measured 5%)',
    input: PSQL_TABLE,
    minReduction: 2,
  },
  {
    cmd: 'curl',
    args: ['-s', 'https://api.acme.example/v1/orders?limit=3'],
    what: 'a pretty-printed JSON response body, recompacted so "curl | jq" still parses (measured 36%)',
    input: CURL_JSON,
    minReduction: 28,
  },
  {
    cmd: 'wget',
    args: ['-qO', '-', 'https://downloads.acme.example/platform/releases.json'],
    what: 'fetched payload on stdout; wget writes its transfer log to stderr (measured 0%)',
    input: WGET_BODY,
    minReduction: 0,
    passthroughReason:
      'Everything condenseWget strips - "Resolving...", "HTTP request sent", the dot meter - is ' +
      'written by wget to STDERR, and the frame hands compress() only the child stdout. With ' +
      '"-O -" that stdout is the fetched payload itself and is normally piped onward, so the ' +
      'only safe transform is none; the wrapper is here to guard that payload, not to shrink it.',
  },
  {
    cmd: 'jq',
    args: ['.repositories', 'inventory.json'],
    what: 'a 24-object array, jq-pretty-printed (measured 76%)',
    input: JQ_ARRAY,
    minReduction: 68,
  },
]
