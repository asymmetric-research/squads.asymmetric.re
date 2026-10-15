# squads-verifier deployment (ops-prod, staging on ops-staging)

Kubernetes manifests for the Squads multisig verifier. Runs in the `squads-verifier` namespace of the `ops-prod` EKS
cluster, serving https://squads.asymmetric.re behind an internet-facing ALB. Mirrors
[dotcom's deploy](https://github.com/asymmetric-research/dotcom/tree/main/deploy): the container is nginx serving the
webpack build (see the [Dockerfile](../Dockerfile)), with no runtime, no env vars and no application secrets.

The ArgoCD `Application`s that sync these manifests live in `config-management` and point at this repo:
`kubernetes/deployment/ops-prod/squads-verifier/` syncs `deploy/` to ops-prod, and
`kubernetes/deployment/ops-staging/squads-verifier/` syncs `deploy/staging/` to ops-staging.

For the day-to-day runbook (cutting a release, verifying, rolling back) see
[`docs/deploying.md`](../docs/deploying.md).

- **Staging** (`staging/`, its own ArgoCD Application on ops-staging): every merge to `main` runs
  [`publish-main.yml`](../.github/workflows/publish-main.yml), which pushes `main` / `main-<sha>` tags, and
  `argocd-image-updater` rolls the staging deployment to the newest `main-<sha>`. Teleport-only, see below.
- **Production**: pushing a `vX.Y.Z` tag runs [`publish-semver.yml`](../.github/workflows/publish-semver.yml), which
  pushes `ghcr.io/asymmetric-research/squads.asymmetric.re`, and `argocd-image-updater` picks up the new tag and rolls
  the deployment.

Manifest changes deploy when `deploy/` changes on `main`; commits elsewhere in this repo produce no manifest diff and
no sync.

## Layout

```
deploy/
├── kustomization.yaml            # workload kustomization (namespace: squads-verifier)
├── deployment.yaml               # nginx serving the static build (2 replicas, port 8080, non-root)
├── service.yaml
├── ingress.yaml                  # ALB, squads.asymmetric.re
├── certificate.yaml              # ACM cert (ACK), squads.asymmetric.re
├── preview-bucket.yaml           # PR previews: public S3 website bucket (30-day expiry)
├── preview-distribution.yaml     # PR previews: CloudFront (default *.cloudfront.net domain)
├── preview-ci-role.yaml          # PR previews: Teleport-assumed IAM role for the upload workflow
└── staging/                      # staging site (own kustomization, own ArgoCD Application)
    ├── kustomization.yaml
    ├── deployment.yaml           # nginx serving the `main` image (1 replica)
    └── service.yaml              # Teleport app discovery, no ingress
```

## RPC endpoint

The Solana RPC URL is baked into the image at build time: webpack inlines it into the bundle, and
[`scripts/render-nginx.sh`](../scripts/render-nginx.sh) writes its origin into the CSP `connect-src` in
[`nginx/default.conf.template`](../nginx/default.conf.template), so the two can't drift. CI reads it from the
`RPC_URL` repo variable. It is not a secret (every visitor's browser receives it) but it stays out of git because
this repo is public and scrapers harvest paid RPC endpoints from GitHub. Without the variable, builds fall back to
`https://api.mainnet-beta.solana.com`.

Baking the URL in, rather than substituting it at container start, means the files nginx serves are exactly the
`dist/` that was built, so the build-hash check in the top-level README holds against the live site.

To change the endpoint: update the variable, then cut a release (it reaches staging on the next merge to `main`).

```sh
gh variable set RPC_URL --repo asymmetric-research/squads.asymmetric.re --body https://<endpoint>
```

## Staging site

Staging runs on the ops-staging cluster (same `squads-verifier` namespace name), separate from production. It has no
ingress: the service carries the `asymmetricresearch.teleport.sh/app-discovery: "true"` label, so the Teleport
kube-agent exposes it as the `squads-verifier-staging` app at
<https://squads-verifier-staging.asymmetricresearch.teleport.sh>, open to the `all-employees` role.

Staging talks to Solana mainnet with the production RPC endpoint. Approving or rejecting a proposal there signs a real
transaction.

## PR previews

Every branch PR gets a static preview: [`preview.yml`](../.github/workflows/preview.yml) runs `npm run build` (webpack
emits relative asset URLs, so the output works under any prefix), syncs `dist/` to `pr-<num>/<shortsha>` in the
preview bucket, and comments the URL on the PR. Each push gets a fresh immutable prefix, so there is no cache
invalidation. Every preview lives for 30 days from upload (the bucket lifecycle rule), regardless of later pushes or
the PR closing.

Previews serve the static build only: the nginx security headers (including the stricter CSP) are not exercised, only
the `<meta>` CSP in `index.html`. Check headers on staging or locally:

```sh
docker build -t squads-verifier . && docker run --rm -p 8080:8080 squads-verifier
```

The workflow authenticates through Teleport Machine ID with no AWS keys in the repo: it joins as the
`github-action-squads-verifier-preview-bot` bot, logs in to the `aws-integration-ops-prod` app, and assumes the
`squads-verifier-preview-ci` IAM role (`preview-ci-role.yaml`). The bot, its Teleport role and its join token live in
`config-management` (`teleport/github-action-squads-verifier-preview-bot*.yaml`).

## One-time setup

Production and PR previews live on ops-prod (`tsh kube login eks-ops-prod`); staging lives on ops-staging
(`tsh kube login eks-ops-staging`). Run each step below against the cluster it names.

### 1. config-management

- ArgoCD Applications: `deploy/` in `ops-prod/squads-verifier/`, `deploy/staging/` in `ops-staging/squads-verifier/`
  (both with image-updater annotations), and bridgit GitHub App access to this repo.
- Teleport bot `github-action-squads-verifier-preview-bot`, applied with `tctl create -f` (not ArgoCD-synced).

### 2. GitHub repo settings

- A `production` environment with required reviewers (the `swe` team), **Prevent self-review** on, and a deployment
  tag policy of `v*`, as on dotcom. `publish-semver.yml` runs in it.
- Repo variable `RPC_URL` (see above).

### 3. GHCR image-pull secret

The image is private, so each cluster needs the secret with that cluster's token (`<cluster>` is `ops-prod` or
`ops-staging`). ops-prod already has it from the config-management deploy. Verify first,
`kubectl -n squads-verifier get secret ghcr-puller`, and only create it if missing:

```sh
kubectl -n squads-verifier create secret docker-registry ghcr-puller \
    --docker-server=https://ghcr.io \
    --docker-username=$(op read 'op://Validators/github machine user/username') \
    --docker-password=$(op read "op://Validators/github machine user/ghcr-pull-token-<cluster>")
```

### 4. PR-preview host

Once ArgoCD has created the CloudFront distribution:

```sh
kubectl -n squads-verifier get distribution squads-verifier-previews -o jsonpath='{.status.domainName}'
gh variable set PREVIEW_HOST --repo asymmetric-research/squads.asymmetric.re --body <that-domain>
```

### DNS and certificate

Unchanged by the move from config-management: the Ingress and Certificate keep their names, so ArgoCD adopts the
existing ALB and ACM cert and `squads.asymmetric.re` keeps pointing at the same ALB.

## Migrating from the config-management deploy

Before this, arci built `ghcr.io/asymmetric-research/squads-verifier` from every `main` commit and the manifests lived
in `config-management/kubernetes/deployment/ops-prod/squads-verifier/kustomize/`. To cut over without downtime:

1. Merge this repo's deploy PR, set the repo settings above, and push `v0.1.0`. Wait for **Publish Semver Image** to
   push the image.
2. Merge the config-management PR that repoints the existing `squads-verifier-kustomize` Application at this repo's
   `deploy/` and the new image, adds the staging Application and the preview bot, and deletes the old `kustomize/`
   directory. Same Application, same resource names: ArgoCD rolls the Deployment to the new image (port 80 → 8080 via
   the `http` named port) and prunes the old nginx ConfigMap.
3. Check https://squads.asymmetric.re serves the new build and the CSP header, then remove the `squads-verifier`
   workflow from arci so it stops publishing images nobody deploys.

## Updating

- **Code change**: merge to `main` — staging updates automatically. Ship to production by tagging a release; another
  reviewer has to approve the **Publish Semver Image** run before it builds.
- **Manifest change**: edit here, merge to `main`; ArgoCD syncs.
- **nginx or CSP change**: `nginx/default.conf.template` is baked into the image, so it ships with the next release.
- **ArgoCD Application / image-updater change**: edit the Application in `config-management`, not here.

## Verifying

```sh
kubectl -n squads-verifier get pods
kubectl -n squads-verifier logs -l app.kubernetes.io/name=squads-verifier --tail=100
```

Staging, on ops-staging: the same commands with `-l app.kubernetes.io/name=squads-verifier-staging`.
