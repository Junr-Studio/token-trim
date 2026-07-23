import { expect } from 'vitest'
import { describeCompression } from '../support/harness.js'

// Characterization + behavioral suite for the helm handler.
//
// helm renders its tables with gosuri/uitable, which pads every cell to the
// column width AND separates cells with a tab, so the fixtures below carry both
// (\t escapes) - a parser that only splits on runs of spaces would work on a
// screenshot and fail on the real bytes.

// ── helm list: four releases, one of them failed ──
const HELM_LIST = `NAME         \tNAMESPACE    \tREVISION\tUPDATED                              \tSTATUS  \tCHART               \tAPP VERSION
argo-cd      \targocd       \t3       \t2026-05-12 09:14:22.118273 +0200 CEST\tdeployed\targo-cd-5.51.6      \tv2.9.3
cert-manager \tcert-manager \t1       \t2026-04-02 11:03:47.912004 +0200 CEST\tdeployed\tcert-manager-v1.14.4\tv1.14.4
ingress-nginx\tingress-nginx\t7       \t2026-06-30 15:22:09.441182 +0200 CEST\tdeployed\tingress-nginx-4.10.1\t1.10.1
myapp        \tdefault      \t12      \t2026-07-21 18:44:02.771930 +0200 CEST\tfailed  \tmyapp-0.4.2         \t2.3.1
`

// ── helm list on a cluster with no releases: helm still prints the header ──
const HELM_LIST_EMPTY = `NAME\tNAMESPACE\tREVISION\tUPDATED\tSTATUS\tCHART\tAPP VERSION
`

// ── helm list on a busy cluster: 30 releases, more than the row cap ──
const HELM_LIST_MANY = [
  'NAME  \tNAMESPACE\tREVISION\tUPDATED                              \tSTATUS  \tCHART      \tAPP VERSION',
  ...Array.from({ length: 30 }, (_, i) => {
    const n = String(i + 1).padStart(2, '0')
    return `svc-${n}\tprod     \t${i + 1}       \t2026-07-0${(i % 9) + 1} 08:${n}:11.201004 +0200 CEST\tdeployed\tsvc-0.9.${n}  \t1.4.${n}`
  }),
].join('\n') + '\n'

// ── helm list -q: names only, the canonical `| xargs helm uninstall` input ──
const HELM_LIST_SHORT = `argo-cd
cert-manager
ingress-nginx
myapp
`

// ── helm status --debug: the release report with every YAML dump attached ──
const HELM_STATUS_DEBUG = `NAME: myapp
LAST DEPLOYED: Tue Jul 21 18:44:02 2026
NAMESPACE: default
STATUS: deployed
REVISION: 12
TEST SUITE: None

USER-SUPPLIED VALUES:
image:
  repository: myregistry.io/team/api
  tag: v2.3.1
ingress:
  enabled: true
  host: api.example.com
replicaCount: 3

COMPUTED VALUES:
affinity: {}
autoscaling:
  enabled: false
  maxReplicas: 10
  minReplicas: 2
  targetCPUUtilizationPercentage: 80
image:
  pullPolicy: IfNotPresent
  repository: myregistry.io/team/api
  tag: v2.3.1
imagePullSecrets: []
ingress:
  className: nginx
  enabled: true
  host: api.example.com
nameOverride: ""
podAnnotations: {}
replicaCount: 3
resources:
  limits:
    cpu: 500m
    memory: 512Mi
  requests:
    cpu: 100m
    memory: 128Mi
serviceAccount:
  create: true
  name: ""
tolerations: []

HOOKS:
---
# Source: myapp/templates/tests/test-connection.yaml
apiVersion: v1
kind: Pod
metadata:
  name: "myapp-test-connection"
  annotations:
    "helm.sh/hook": test
spec:
  containers:
    - name: wget
      image: busybox
      command: ['wget']
      args: ['myapp:80']
  restartPolicy: Never

MANIFEST:
---
# Source: myapp/templates/serviceaccount.yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: myapp
  labels:
    helm.sh/chart: myapp-0.4.2
    app.kubernetes.io/name: myapp
---
# Source: myapp/templates/service.yaml
apiVersion: v1
kind: Service
metadata:
  name: myapp
spec:
  type: ClusterIP
  ports:
    - port: 80
      targetPort: http
      protocol: TCP
      name: http
  selector:
    app.kubernetes.io/name: myapp
---
# Source: myapp/templates/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: myapp
spec:
  replicas: 3
  selector:
    matchLabels:
      app.kubernetes.io/name: myapp
  template:
    metadata:
      labels:
        app.kubernetes.io/name: myapp
    spec:
      serviceAccountName: myapp
      containers:
        - name: myapp
          image: "myregistry.io/team/api:v2.3.1"
          imagePullPolicy: IfNotPresent
          ports:
            - name: http
              containerPort: 3000
              protocol: TCP

NOTES:
1. Get the application URL by running these commands:
  https://api.example.com/

2. Watch the rollout status with:
  kubectl --namespace default rollout status deployment/myapp
`

// ── helm status with no --debug: header + NOTES only, nothing to elide ──
const HELM_STATUS = `NAME: argo-cd
LAST DEPLOYED: Tue May 12 09:14:22 2026
NAMESPACE: argocd
STATUS: deployed
REVISION: 3
TEST SUITE: None
NOTES:
In order to access the server UI you have the following options:

1. kubectl port-forward service/argo-cd-server -n argocd 8080:443

2. enable ingress in the values file \`server.ingress.enabled\`

After reaching the UI the first time you can login with username: admin and
the random password generated during the installation.
`

// ── helm upgrade --dry-run --debug: a status report with the manifest attached ──
const HELM_UPGRADE_DRY_RUN = `Release "myapp" has been upgraded. Happy Helming!
NAME: myapp
LAST DEPLOYED: Tue Jul 21 19:02:44 2026
NAMESPACE: default
STATUS: pending-upgrade
REVISION: 13
TEST SUITE: None

HOOKS:

MANIFEST:
---
# Source: myapp/templates/service.yaml
apiVersion: v1
kind: Service
metadata:
  name: myapp
spec:
  type: ClusterIP
  ports:
    - port: 80
      targetPort: http
      protocol: TCP
      name: http
---
# Source: myapp/templates/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: myapp
spec:
  replicas: 4
  template:
    spec:
      containers:
        - name: myapp
          image: "myregistry.io/team/api:v2.4.0"
          ports:
            - name: http
              containerPort: 3000
              protocol: TCP

NOTES:
1. Get the application URL by running these commands:
  https://api.example.com/
`

// ── helm status --debug on a chart whose VALUES contain a top-level `kind:`
// key. fluent-bit, datadog and external-dns all ship one. This is a YAML map of
// chart values, not a stream of k8s objects ──
const HELM_STATUS_VALUES_KIND = `NAME: fluent-bit
STATUS: deployed

USER-SUPPLIED VALUES:
kind: DaemonSet
replicaCount: 1
image:
  repository: fluent/fluent-bit
  tag: 2.2.0

NOTES:
hi
`

// ── helm status whose NOTES prose contains a column-0 uppercase line that
// happens to spell a dump-section name. Chart authors write exactly this ──
const HELM_STATUS_NOTES_LOOKALIKE = `NAME: myapp
STATUS: deployed
NOTES:
WARNING:
  this chart is deprecated
MANIFEST:
  see the docs for the manifest layout
`

// ── the same lookalike, plus the thing chart NOTES.txt files do all the time:
// a column-0 `---` used as a visual divider between paragraphs. "Prose never
// carries a document separator" is not a property of real charts, so a divider
// anywhere below a dump-section-shaped word in the prose must not be enough to
// promote that word back into a section header ──
const HELM_STATUS_NOTES_DIVIDER = `NAME: myapp
STATUS: deployed
NOTES:
Thank you for installing myapp.

MANIFEST:
  the rendered manifest is available with: helm get manifest myapp

---
Read the docs at https://example.com/docs
Contact the platform team for help.
`

// ── helm status --debug whose MANIFEST opens with the `# Source:` comment
// instead of the `---` separator. It is still a stream of k8s objects - the
// separator between the documents says so - and the inventory is what the
// section is worth summarising as ──
const HELM_STATUS_MANIFEST_COMMENT_FIRST = `NAME: myapp
STATUS: deployed

MANIFEST:
# Source: myapp/templates/svc.yaml
apiVersion: v1
kind: Service
metadata:
  name: myapp
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: myapp-cm

NOTES:
ok
`

// ── a dump section that turns up AFTER the NOTES header. helm prints NOTES
// last, so this is not something real helm emits - but passing a whole rendered
// manifest through because of where it sat is the one thing this condenser is
// for, and a YAML document stream is not something chart prose ever contains ──
const HELM_STATUS_DUMP_AFTER_NOTES = `NAME: myapp
STATUS: deployed
NOTES:
hello there

MANIFEST:
---
apiVersion: v1
kind: Service
metadata:
  name: myapp
`

// ── helm history: revision 9 is dated "Jul  6", the day is space-padded, so a
// naive split on runs of whitespace tears the UPDATED cell in two ──
const HELM_HISTORY = `REVISION\tUPDATED                 \tSTATUS    \tCHART      \tAPP VERSION\tDESCRIPTION
9       \tMon Jul  6 09:12:41 2026\tsuperseded\tmyapp-0.3.9\t2.2.0      \tUpgrade complete
10      \tTue Jul 14 11:55:02 2026\tfailed    \tmyapp-0.4.0\t2.3.0      \tUpgrade "myapp" failed: timed out waiting for the condition
11      \tTue Jul 14 12:04:18 2026\tsuperseded\tmyapp-0.3.9\t2.2.0      \tRollback to 9
12      \tTue Jul 21 18:44:02 2026\tdeployed  \tmyapp-0.4.2\t2.3.1      \tUpgrade complete
`

// ── helm search repo redis: chart descriptions are the chart author's prose
// and run to a hundred characters, most of it shared between sibling charts ──
const HELM_SEARCH = `NAME                                          \tCHART VERSION\tAPP VERSION\tDESCRIPTION
bitnami/redis                                 \t19.6.4       \t7.2.5      \tRedis(R) is an open source, advanced key-value store. It is often referred to as a data structure server.
bitnami/redis-cluster                         \t10.2.5       \t7.2.5      \tRedis(R) is an open source, advanced key-value store. It is often referred to as a data structure server.
bitnami/redis-sentinel                        \t1.0.1        \t7.2.5      \tDEPRECATED Redis(TM) is an open source, advanced key-value store.
prometheus-community/prometheus-redis-exporter\t6.2.0        \t1.61.0     \tPrometheus exporter for Redis metrics
`

// ── helm template: a stream of YAML documents and nothing else. This is what
// `helm template ./chart | kubectl apply -f -` feeds to kubectl ──
const HELM_TEMPLATE = `---
# Source: myapp/templates/serviceaccount.yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: myapp
  labels:
    helm.sh/chart: myapp-0.4.2
    app.kubernetes.io/name: myapp
    app.kubernetes.io/managed-by: Helm
---
# Source: myapp/templates/service.yaml
apiVersion: v1
kind: Service
metadata:
  name: myapp
spec:
  type: ClusterIP
  ports:
    - port: 80
      targetPort: http
      protocol: TCP
      name: http
  selector:
    app.kubernetes.io/name: myapp
---
# Source: myapp/templates/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: myapp
spec:
  replicas: 3
  selector:
    matchLabels:
      app.kubernetes.io/name: myapp
  template:
    metadata:
      labels:
        app.kubernetes.io/name: myapp
    spec:
      serviceAccountName: myapp
      containers:
        - name: myapp
          image: "myregistry.io/team/api:v2.3.1"
          ports:
            - name: http
              containerPort: 3000
              protocol: TCP
`

// ── helm get values: the release's values, the input to a re-install ──
const HELM_GET_VALUES = `USER-SUPPLIED VALUES:
image:
  repository: myregistry.io/team/api
  tag: v2.3.1
ingress:
  enabled: true
  host: api.example.com
replicaCount: 3
`

// ── helm repo list: two columns, already minimal ──
const HELM_REPO_LIST = `NAME      \tURL
argo      \thttps://argoproj.github.io/argo-helm
bitnami   \thttps://charts.bitnami.com/bitnami
jetstack  \thttps://charts.jetstack.io
prometheus\thttps://prometheus-community.github.io/helm-charts
`

// ── helm search hub: same subcommand, different table - it is keyed by URL ──
const HELM_SEARCH_HUB = `URL                                               \tCHART VERSION\tAPP VERSION\tDESCRIPTION
https://artifacthub.io/packages/helm/bitnami/redis\t19.6.4       \t7.2.5      \tRedis(R) is an open source, advanced key-value store.
https://artifacthub.io/packages/helm/truecharts/redis\t14.0.3    \t7.2.5      \tRedis is an open source key-value store.
`

// ── helm search repo with a term nothing matches ──
const HELM_SEARCH_NONE = `No results found
`

// ── helm version: a shape no branch claims ──
const HELM_VERSION = `version.BuildInfo{Version:"v3.14.4", GitCommit:"81c902a123462fd4052bc5e9aa9c513c4c8fc142", GitTreeState:"clean", GoVersion:"go1.21.9"}
`

describeCompression('helm', [
  {
    name: 'list - one line per release (name/namespace/status/chart/app version/revision), dropping the UPDATED timestamp column and the padded header',
    cmd: 'helm',
    args: ['list'],
    input: HELM_LIST,
    assert: (out) => {
      expect(out).toContain('[helm] 4 releases:')
      expect(out).toContain('argo-cd (argocd) deployed argo-cd-5.51.6 v2.9.3 rev3')
      // a non-deployed release is the reason anyone runs `helm list`
      expect(out).toContain('myapp (default) failed myapp-0.4.2 2.3.1 rev12')
      // the header and the 37-char timestamps are the bulk of the table
      expect(out).not.toContain('NAMESPACE')
      expect(out).not.toContain('2026-05-12')
      // header line + one line per release
      expect(out.split('\n')).toHaveLength(5)
    },
  },
  {
    name: 'list - past the row cap the count stays the true total and the dropped rows are announced with a way to get them back',
    cmd: 'helm',
    args: ['list', '--all-namespaces'],
    input: HELM_LIST_MANY,
    assert: (out) => {
      // the count is what helm reported, not what survived the cap
      expect(out).toContain('[helm] 30 releases:')
      expect(out).toContain('... +5 more releases (--full)')
      expect(out).toContain('svc-25 (prod) deployed svc-0.9.25 1.4.25 rev25')
      expect(out).not.toContain('svc-26')
      // header + 25 rows + overflow marker
      expect(out.split('\n')).toHaveLength(27)
    },
  },
  {
    name: 'list - no releases installed collapses the lone header to a single zero line',
    cmd: 'helm',
    args: ['list'],
    input: HELM_LIST_EMPTY,
    assert: (out) => {
      expect(out).toBe('[helm] 0 releases')
    },
  },
  {
    name: 'list -q - a bare release-name list stays verbatim, it is piped into xargs helm uninstall',
    cmd: 'helm',
    args: ['list', '-q'],
    input: HELM_LIST_SHORT,
    assert: (out, input) => {
      expect(out).toBe(input.trim())
      // no header, no indent, no reordering: still valid xargs input
      expect(out).not.toContain('[helm]')
      expect(out.split('\n')).toHaveLength(4)
    },
  },
  {
    name: 'status - keeps the release header and the NOTES, replaces the values/hooks/manifest YAML dumps with a kind/name inventory',
    cmd: 'helm',
    args: ['status', 'myapp', '--debug'],
    input: HELM_STATUS_DEBUG,
    assert: (out) => {
      // the answer to "what is this release doing"
      expect(out).toContain('NAME: myapp')
      expect(out).toContain('STATUS: deployed')
      expect(out).toContain('REVISION: 12')
      // NOTES are the chart author's instructions - the point of the command
      expect(out).toContain('kubectl --namespace default rollout status deployment/myapp')
      // the dumps are gone, and what they contained is stated, not implied
      expect(out).not.toContain('targetCPUUtilizationPercentage')
      expect(out).not.toContain('imagePullPolicy')
      expect(out).toContain('USER-SUPPLIED VALUES: 7 lines elided')
      expect(out).toContain('COMPUTED VALUES: 29 lines elided')
      expect(out).toContain('MANIFEST: 3 documents: ServiceAccount/myapp, Service/myapp, Deployment/myapp')
      expect(out).toContain('HOOKS: 1 document: Pod/myapp-test-connection')
      // The manifest is the largest single elision this handler makes, so it is
      // the last one that should be missing the way to get it back: every
      // summarising marker carries the flag, inventory branch included.
      expect(out).toContain('MANIFEST: 3 documents: ServiceAccount/myapp, Service/myapp, Deployment/myapp (--full)')
      expect(out).toContain('HOOKS: 1 document: Pod/myapp-test-connection (--full)')
    },
  },
  {
    name: 'status - a values dump whose YAML happens to carry a top-level `kind:` key is counted, never reported as a k8s document inventory it was never parsed as',
    cmd: 'helm',
    args: ['status', 'fluent-bit'],
    input: HELM_STATUS_VALUES_KIND,
    assert: (out) => {
      // a values map is not a document stream: size is all that can be claimed
      expect(out).toContain('USER-SUPPLIED VALUES: 5 lines elided (--full)')
      expect(out).not.toContain('document')
      expect(out).not.toContain('DaemonSet')
      // the header and NOTES, the parts worth reading, are untouched
      expect(out).toContain('NAME: fluent-bit')
      expect(out).toContain('STATUS: deployed')
      expect(out).toContain('NOTES:')
      expect(out).toContain('hi')
    },
  },
  {
    name: 'status - NOTES ends the structured region: a column-0 uppercase line in the chart author\'s prose is prose, not a dump section, and the rest of the NOTES survives',
    cmd: 'helm',
    args: ['status', 'myapp'],
    input: HELM_STATUS_NOTES_LOOKALIKE,
    assert: (out, input) => {
      // NOTES are the whole reason anyone runs `helm status`; truncating them
      // at a word that looks like a header loses the deprecation notice AND the
      // documentation pointer under it
      expect(out).toBe(input.trim())
      expect(out).toContain('WARNING:')
      expect(out).toContain('this chart is deprecated')
      expect(out).toContain('MANIFEST:')
      expect(out).toContain('see the docs for the manifest layout')
      expect(out).not.toContain('elided')
    },
  },
  {
    name: 'status - a `---` divider further down the NOTES does not promote a word in the prose above it into a dump section',
    cmd: 'helm',
    args: ['status', 'myapp'],
    input: HELM_STATUS_NOTES_DIVIDER,
    assert: (out, input) => {
      // A bare separator is not a document stream: there is no object under it
      // to inventory, and the paragraphs below were the answer the NOTES exist
      // to deliver. Treating the divider as proof deleted them silently.
      expect(out).toBe(input.trim())
      expect(out).toContain('https://example.com/docs')
      expect(out).toContain('Contact the platform team for help.')
      expect(out).not.toContain('elided')
      expect(out).not.toContain('documents:')
    },
  },
  {
    name: 'status - a MANIFEST that opens with its `# Source:` comment is still inventoried, not reduced to a line count',
    cmd: 'helm',
    args: ['status', 'myapp', '--debug'],
    input: HELM_STATUS_MANIFEST_COMMENT_FIRST,
    assert: (out) => {
      // The separator between the two documents is what makes this a stream;
      // which line happens to come first does not change what was elided.
      expect(out).toContain('MANIFEST: 2 documents: Service/myapp, ConfigMap/myapp-cm (--full)')
      expect(out).not.toContain('lines elided')
      expect(out).not.toContain('apiVersion')
      // The header and NOTES survive as always.
      expect(out).toContain('NAME: myapp')
      expect(out).toContain('STATUS: deployed')
      expect(out).toContain('NOTES:')
      expect(out).toContain('ok')
    },
  },
  {
    name: 'status - a dump section after the NOTES header is elided too, once a real document stream proves it is one',
    cmd: 'helm',
    args: ['status', 'myapp', '--debug'],
    input: HELM_STATUS_DUMP_AFTER_NOTES,
    assert: (out) => {
      expect(out).toContain('MANIFEST: 1 document: Service/myapp (--full)')
      // the rendered YAML is gone
      expect(out).not.toContain('apiVersion')
      expect(out).not.toContain('kind: Service')
      // ... and the NOTES prose above it is untouched
      expect(out).toContain('NOTES:')
      expect(out).toContain('hello there')
    },
  },
  {
    name: 'status - a report with no attached dumps survives verbatim, nothing is summarised away',
    cmd: 'helm',
    args: ['status', 'argo-cd'],
    input: HELM_STATUS,
    assert: (out, input) => {
      expect(out).toBe(input.trim())
      expect(out).not.toContain('elided')
    },
  },
  {
    name: 'upgrade --dry-run - the rendered manifest is an inventory, because this report is read by the agent and never piped to kubectl (it opens with a prose line)',
    cmd: 'helm',
    args: ['upgrade', '--install', 'myapp', './chart', '--dry-run', '--debug'],
    input: HELM_UPGRADE_DRY_RUN,
    assert: (out) => {
      expect(out).toContain('Release "myapp" has been upgraded. Happy Helming!')
      expect(out).toContain('STATUS: pending-upgrade')
      expect(out).toContain('REVISION: 13')
      expect(out).toContain('MANIFEST: 2 documents: Service/myapp, Deployment/myapp')
      expect(out).toContain('MANIFEST: 2 documents: Service/myapp, Deployment/myapp (--full)')
      // the rendered YAML body is gone
      expect(out).not.toContain('containerPort')
      expect(out).not.toContain('myregistry.io/team/api:v2.4.0')
      // an empty section says it is empty rather than offering --full for nothing
      expect(out).toContain('HOOKS: (none)')
      expect(out).not.toContain('HOOKS: (none) (--full)')
      expect(out).not.toContain('0 lines elided')
      expect(out).toContain('https://api.example.com/')
    },
  },
  {
    name: 'history - one line per revision in release order, keeping the DESCRIPTION that says why a revision exists',
    cmd: 'helm',
    args: ['history', 'myapp'],
    input: HELM_HISTORY,
    assert: (out) => {
      expect(out).toContain('[helm] 4 revisions:')
      // the failure and the rollback that answered it are the reason to run this
      expect(out).toContain('rev10 failed myapp-0.4.0 2.3.0 Upgrade "myapp" failed: timed out waiting for the condition')
      expect(out).toContain('rev11 superseded myapp-0.3.9 2.2.0 Rollback to 9')
      expect(out).toContain('rev12 deployed myapp-0.4.2 2.3.1 Upgrade complete')
      // rows keep helm's order, oldest first, so "rollback to N" still reads
      expect(out.indexOf('rev9 ')).toBeLessThan(out.indexOf('rev12 '))
      expect(out).not.toContain('09:12:41')
      expect(out.split('\n')).toHaveLength(5)
    },
  },
  {
    name: 'search repo - one line per chart with both versions, truncating the long description rather than dropping it (it is where DEPRECATED is announced)',
    cmd: 'helm',
    args: ['search', 'repo', 'redis'],
    input: HELM_SEARCH,
    assert: (out) => {
      expect(out).toContain('[helm] 4 charts:')
      expect(out).toContain('bitnami/redis 19.6.4 (app 7.2.5)')
      expect(out).toContain('prometheus-community/prometheus-redis-exporter 6.2.0 (app 1.61.0)')
      // the deprecation warning has to survive the truncation
      expect(out).toContain('DEPRECATED')
      // ... but the boilerplate tail of the description does not
      expect(out).not.toContain('data structure server')
      expect(out).toContain('...')
      // a short description is kept whole, with no truncation marker after it
      expect(out).toContain('Prometheus exporter for Redis metrics')
      expect(out).not.toContain('Prometheus exporter for Redis metrics...')
      expect(out.split('\n')).toHaveLength(5)
    },
  },
  {
    name: 'template - rendered manifests stay verbatim: the canonical use is `helm template ./chart | kubectl apply -f -`, and stdout being a pipe is exactly what makes the frame compress, so an inventory here would break the apply for every chart small enough to work today',
    cmd: 'helm',
    args: ['template', 'myapp', './chart'],
    input: HELM_TEMPLATE,
    assert: (out, input) => {
      expect(out).toBe(input.trim())
      // every document separator and every kind survives, so it still parses
      expect((out.match(/^---$/gm) ?? [])).toHaveLength(3)
      expect(out).toContain('kind: Deployment')
      expect(out).not.toContain('[helm]')
      expect(out).not.toContain('documents:')
    },
  },
  {
    // The passthrough above only kept `| kubectl apply -f -` working for charts
    // small enough to sit under the frame's 8 KB backstop cap - and real charts
    // are 50-500 KB. Above the cap the backstop head/tail-truncated the stream
    // and spliced an English sentence into it, so the apply failed to parse.
    // `helm template` is routed through isMachineOutput now, which returns
    // before the cap runs.
    name: 'template - a chart larger than the backstop cap is still emitted whole, or the apply it feeds cannot parse',
    cmd: 'helm',
    args: ['template', './chart'],
    input:
      Array.from(
        { length: 40 },
        (_, i) =>
          `---\n# Source: myapp/templates/deployment-${i}.yaml\napiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: myapp-${i}\n  labels:\n    app.kubernetes.io/name: myapp\n    app.kubernetes.io/instance: release-${i}\nspec:\n  replicas: 2\n  selector:\n    matchLabels:\n      app.kubernetes.io/name: myapp\n  template:\n    spec:\n      containers:\n        - name: myapp\n          image: "ghcr.io/acme/myapp:1.4.2"\n          ports:\n            - containerPort: 8080`,
      ).join('\n') + '\n',
    assert: (out, input) => {
      expect(input.length).toBeGreaterThan(8000)
      expect(out).toBe(input.trim())
      // no elision marker anywhere in the document stream
      expect(out).not.toMatch(/elided/)
      expect(out).not.toMatch(/re-run with/)
      expect((out.match(/^kind: Deployment$/gm) ?? [])).toHaveLength(40)
    },
  },
  {
    name: 'get manifest - the live manifest is the same pipeable YAML as template and stays verbatim',
    cmd: 'helm',
    args: ['get', 'manifest', 'myapp'],
    input: HELM_TEMPLATE,
    assert: (out, input) => {
      expect(out).toBe(input.trim())
      expect(out).not.toContain('[helm]')
    },
  },
  {
    name: 'get values - values YAML stays verbatim; its "USER-SUPPLIED VALUES:" banner must not be read as a status dump section',
    cmd: 'helm',
    args: ['get', 'values', 'myapp'],
    input: HELM_GET_VALUES,
    assert: (out, input) => {
      expect(out).toBe(input.trim())
      expect(out).toContain('replicaCount: 3')
      expect(out).not.toContain('elided')
    },
  },
  {
    name: 'repo list - two columns of name and URL are already minimal, reshaping them would only risk the `| awk` that reads them',
    cmd: 'helm',
    args: ['repo', 'list'],
    input: HELM_REPO_LIST,
    assert: (out, input) => {
      expect(out).toBe(input.trim())
      expect(out).not.toContain('[helm]')
    },
  },
  {
    name: 'search hub - a sibling table keyed by URL instead of NAME is left alone rather than parsed as if its columns lined up',
    cmd: 'helm',
    args: ['search', 'hub', 'redis'],
    input: HELM_SEARCH_HUB,
    assert: (out, input) => {
      expect(out).toBe(input.trim())
      expect(out).not.toContain('[helm]')
      expect(out).toContain('https://artifacthub.io/packages/helm/bitnami/redis')
    },
  },
  {
    name: 'search repo - "No results found" is passed through, never restated as a count parsed from nothing',
    cmd: 'helm',
    args: ['search', 'repo', 'nosuchchart'],
    input: HELM_SEARCH_NONE,
    assert: (out) => {
      expect(out).toBe('No results found')
      expect(out).not.toContain('0 charts')
    },
  },
  {
    name: 'version - a subcommand no branch claims passes through untouched',
    cmd: 'helm',
    args: ['version'],
    input: HELM_VERSION,
    assert: (out, input) => {
      expect(out).toBe(input.trim())
      expect(out).not.toContain('[helm]')
    },
  },
])
