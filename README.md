# devcontainers-part2

> Companion project for the Medium article  
> **"Dev Containers at Scale: CI/CD Integration, Team Governance, and GitHub Codespaces — Part 2"**

---

## Overview

This repository builds on the foundation established in Part 1 and demonstrates the advanced patterns required to operate Dev Containers reliably across a large engineering organisation. Where Part 1 covered the fundamentals of a reproducible local environment, Part 2 shows how to scale that environment across teams, CI pipelines, and cloud-hosted development.

**What this repository demonstrates:**

- Dev Container **Features** — composable, OCI-distributed packages that layer versioned tooling on top of any base image without modifying the Dockerfile
- The full **six-hook lifecycle** (`initializeCommand`, `onCreateCommand`, `updateContentCommand`, `postCreateCommand`, `postStartCommand`, `postAttachCommand`) — every hook with a real, purposeful command
- **CI/CD parity** via the `devcontainers/ci` GitHub Action — tests run inside the exact same container image that developers use locally; no translation layer, no "works on my machine"
- The **Blessed Base Image** governance pattern — a platform team owns and publishes a curated base image; product teams own only the layers below the `FROM` line, with Dependabot raising PRs when the base tag advances
- **GitHub Codespaces** readiness — `hostRequirements`, `forwardPorts`, and `portsAttributes` are all configured so the repo opens correctly on a remote GitHub-managed machine with zero additional setup
- **SSH agent forwarding** and host **gitconfig** mounting carried forward unchanged from Part 1 — private repository access and git identity work identically inside the container

---

## Prerequisites

| Tool | Notes |
|---|---|
| Docker Desktop (macOS / Windows) or Docker Engine (Linux) | The container runtime. Version 24 or later recommended. |
| Visual Studio Code + [Dev Containers extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers) **OR** [`@devcontainers/cli`](https://github.com/devcontainers/cli) | Either works. The CLI is preferred for headless / CI use. |
| Git with an SSH key loaded into the agent | Required for the SSH agent forwarding feature. Run `ssh-add -l` to verify your key is loaded before opening the container. |

---

## Getting Started

```bash
git clone git@github.com:your-org/devcontainers-part2.git
cd devcontainers-part2
code .
```

VS Code will detect `.devcontainer/devcontainer.json` and show a notification in the bottom-right corner: **"Reopen in Container"**. Click it. The first build pulls the base image, applies the four Features, and runs all lifecycle hooks — expect two to four minutes. Subsequent opens use the layer cache and complete in seconds.

> **`updateContentCommand` runs `npm install` automatically** every time the container is created or restored from a Codespaces prebuild snapshot, so your `node_modules` are always current without any manual step.
>
> **`postCreateCommand` runs `scripts/post-create.sh` once**, on first creation only. It installs git hooks (if Husky is present) and prints runtime version information so you can verify the environment at a glance.

---

## Using the CLI

If you prefer the terminal or are working in a headless environment, use the official Dev Containers CLI:

```bash
# Build the image defined in .devcontainer/devcontainer.json
devcontainer build --workspace-folder .

# Start the container (runs all applicable lifecycle hooks)
devcontainer up --workspace-folder .

# Execute a command inside the running container
devcontainer exec --workspace-folder . npm test
```

---

## Project Structure

```
devcontainers-part2/
├── .devcontainer/
│   ├── Dockerfile            # Blessed Base Image pattern — FROM + app-specific packages only
│   └── devcontainer.json     # Full config: Features, six hooks, mounts, Codespaces settings
├── .github/
│   ├── dependabot.yml        # Auto-PRs for npm deps and the Dockerfile FROM tag
│   └── workflows/
│       └── ci.yml            # CI via devcontainers/ci — tests run in the dev container image
├── scripts/
│   └── post-create.sh        # One-time setup: git hooks, version verification
├── src/
│   ├── app.ts                # Express app (no listen call — importable by tests)
│   ├── index.ts              # Entry point — imports app and binds to PORT
│   └── routes/
│       └── health.ts         # GET /health — status, timestamp, uptime
├── tests/
│   └── health.test.ts        # Vitest integration tests for / and /health
├── .env.example              # Documents all environment variables; copy to .env
├── .eslintrc.json            # ESLint + @typescript-eslint rules
├── .gitignore                # Excludes node_modules, dist, .env, coverage
├── .prettierrc               # Prettier formatting preferences
├── package.json              # Scripts, dependencies, devDependencies
├── tsconfig.json             # TypeScript — ES2022, commonjs, strict
├── vitest.config.ts          # Vitest in node environment, globals disabled
└── README.md                 # This file
```

---

## Dev Container Features

**Features** are composable, OCI-distributed packages that install a specific tool or set of tools into a Dev Container. They are versioned independently of the base image, published to any OCI registry, and layered on top of your `FROM` in a defined order — without you having to write the installation script yourself.

Key properties:

- Each Feature is a self-contained `devcontainer-feature.json` + install script, published as an OCI artifact (typically to GHCR).
- Features are applied **after** the Dockerfile build, so they never modify the blessed base image.
- Versions can be pinned with a semver major tag (e.g., `node:1`) and updated via Dependabot or Renovate PRs — the `.github/dependabot.yml` in this repo handles npm and Docker (which covers Feature image tags).

### Features configured in this repository

| Feature | Version pinned | Purpose |
|---|---|---|
| `ghcr.io/devcontainers/features/node:1` | `"version": "20"` | Node.js 20 LTS runtime and npm, installed via nvm so the version is trivially switchable |
| `ghcr.io/devcontainers/features/docker-in-docker:2` | `latest` | Docker CLI and daemon running inside the container; allows building and pushing images in CI-like workflows without leaving the dev environment |
| `ghcr.io/devcontainers/features/kubectl-helm-minikube:1` | `latest` (minikube disabled) | `kubectl` and `helm` for interacting with remote Kubernetes clusters; minikube is disabled because the target clusters are remote |
| `ghcr.io/devcontainers/features/aws-cli:1` | `latest` | AWS CLI v2 with shell completion for interacting with cloud resources |

> **Dependabot and Features:** The `docker` ecosystem entry in `.github/dependabot.yml` watches the `/.devcontainer` directory. When a new minor version of a Feature's OCI tag is published, Dependabot raises a PR to update the version string in `devcontainer.json`. Major version bumps are suppressed in `dependabot.yml` — they require a deliberate engineering decision, not an automated merge.

---

## The Six Lifecycle Hooks

The Dev Container specification defines six lifecycle hooks that run at different points during the container's lifetime and under different conditions. Using the right hook for each task is critical: an expensive operation placed in the wrong hook can run too often (wasting seconds on every start) or not often enough (leaving the environment stale after a prebuild restore).

### Hook reference

| Hook | Runs on | Runs as | What this repository uses it for |
|---|---|---|---|
| `initializeCommand` | **HOST machine**, before the container is created or started | Host user | Runs `docker info` to verify the Docker daemon is reachable before attempting to build the container image. Fails fast with a clear error if Docker is not running. |
| `onCreateCommand` | **Container**, once immediately after creation | `containerUser` (root or the configured user) | Configures npm global settings: disables the funding message (`fund false`) and the update notifier (`update-notifier false`). These are global settings that only need to be applied once. |
| `updateContentCommand` | **Container**, after creation **and** after each Codespaces prebuild snapshot is restored | `remoteUser` | Runs `npm install`. This is the correct hook for dependency installation when using Codespaces prebuilds — the snapshotted `node_modules` may be hours old; `updateContentCommand` brings them current on every restore without re-running the full first-time setup. |
| `postCreateCommand` | **Container**, once after the creation phase completes | `remoteUser` | Runs `scripts/post-create.sh` — installs git hooks via Husky (if present) and prints Node.js and npm versions so the developer can verify the environment at a glance. |
| `postStartCommand` | **Container**, **every time** the container starts | `remoteUser` | Prints a ready message with the dev server URL. Intentionally lightweight — this runs on every start, including resuming a stopped container. |
| `postAttachCommand` | Every time a client editor (VS Code, JetBrains, etc.) attaches to the running container | `remoteUser` | Prints the workspace path and API URL as a quick orientation reminder for the developer. |

> **The most common lifecycle mistake:** putting `npm install` in `postStartCommand` instead of `updateContentCommand`. `postStartCommand` runs on **every** container start, including resuming a stopped container where `node_modules` is already intact and current. `updateContentCommand` is the semantically correct hook — it runs after creation and after prebuild restores, which are exactly the two moments when dependencies may be out of date.

> **Codespaces prebuilds and `updateContentCommand`:** When a Codespaces prebuild snapshot is restored, `postCreateCommand` does **not** re-run (the container was already created when the snapshot was taken). Only `updateContentCommand` and `postStartCommand` run. Placing `npm install` in `updateContentCommand` ensures that any packages added or updated since the snapshot was captured are installed before the developer types their first command.

---

## CI/CD Integration

### The split-environment problem

In a typical CI setup, developers write and run tests locally inside a Dev Container, but CI runs those same tests on a bare `ubuntu-latest` runner. The environments differ in OS packages, Node.js version, global tools, and environment variables. Tests that pass locally can fail in CI — not because of a bug, but because of environment divergence. The inverse is equally dangerous: a CI-specific workaround can mask a real failure that would surface in production.

### How `devcontainers/ci` solves it

The [`devcontainers/ci`](https://github.com/devcontainers/ci) GitHub Action builds the Dev Container image from `devcontainer.json` on the CI runner and then executes `runCmd` inside that container. The developer's local environment and the CI environment are the same image — built from the same `Dockerfile`, with the same Features applied, running the same `npm test` command.

### Workflow structure

```yaml
- name: Build Dev Container and run tests
  uses: devcontainers/ci@v0.3
  with:
    imageName: ghcr.io/${{ github.repository }}/devcontainer
    cacheFrom: ghcr.io/${{ github.repository }}/devcontainer
    runCmd: npm test
```

**Key details of the workflow in `.github/workflows/ci.yml`:**

- **`cacheFrom`** pulls the previously published image and uses its layers as a Docker build cache. Unchanged layers (the base image, Features that haven't updated, system packages) are not rebuilt. On a warm cache, the build step typically completes in under 60 seconds.
- **`runCmd: npm test`** is the identical command developers run locally. There is no CI-specific test script, no environment translation, no "but it works on my machine."
- **On pushes to `main`**, after the tests pass, the validated image is tagged with both `:latest` and the commit SHA (`:${{ github.sha }}`) and pushed to the repository's GHCR namespace. This SHA-tagged image is ready to use as the `"image"` source in the Pre-built Image Pattern described below.
- **On pull requests**, the workflow builds the image and runs tests to validate the PR, but does **not** push — the cache is warmed for the eventual merge, but the registry is not polluted with unmerged images.
- **`GITHUB_TOKEN` with `packages: write`** is all that is required to push to the repository's own GHCR namespace. No additional secrets or service accounts are needed.

---

## Blessed Base Image Pattern

### The governance problem

Without a governance strategy, image sprawl is inevitable. In an organisation with 30 product teams, you quickly accumulate 30 different base images, each with a subtly different Ubuntu version, a different OpenSSL patch level, a different CA certificate bundle, and a different non-root user configuration. When a CVE requires a patch, you need 30 pull requests. When a new internal certificate authority is introduced, you need 30 manual updates. No single team has a complete picture of the organisation's exposure.

### The pattern

The **Blessed Base Image** pattern resolves this by establishing a clear ownership boundary:

- The **platform team** owns, builds, and publishes a curated base image to a private registry (e.g., `ghcr.io/your-org/devcontainer-base-node:20.11.0`). This image contains the pinned OS version, mandatory security patches, internal CA certificates, audit tooling, and the correctly configured non-root user. It is rebuilt and republished automatically when any of those upstream inputs change.
- **Product teams** own only what is below the `FROM` line in their `Dockerfile` — application-specific system packages and nothing else.

This gives the platform team a single patch point for organisation-wide concerns and gives product teams full autonomy over their application-level dependencies.

### This repository's Dockerfile

```dockerfile
# In a real organisation, replace the FROM line with your platform team's curated image:
#   FROM ghcr.io/your-org/devcontainer-base-node:20.11.0
FROM mcr.microsoft.com/devcontainers/base:ubuntu-22.04

# Only application-specific system packages belong here.
RUN apt-get update && apt-get install -y --no-install-recommends \
    postgresql-client \
    redis-tools \
    && rm -rf /var/lib/apt/lists/*
```

The `mcr.microsoft.com/devcontainers/base:ubuntu-22.04` image stands in for the platform team's private curated image. In a real organisation, swapping the `FROM` line is the only change required to adopt the pattern.

### Automated updates with Dependabot

The `docker` ecosystem entry in `.github/dependabot.yml` watches the `/.devcontainer` directory:

```yaml
- package-ecosystem: docker
  directory: /.devcontainer
  schedule:
    interval: weekly
  ignore:
    - dependency-name: "*"
      update-types: ["version-update:semver-major"]
```

When the platform team publishes a new patch or minor tag, Dependabot raises a PR that updates the `FROM` directive in the Dockerfile. The CI workflow runs against that PR, validating that the product team's application still builds and tests correctly on top of the updated base. Major version bumps are suppressed — advancing from `node:18` to `node:20` is a deliberate engineering decision and must not be merged automatically.

---

## Pre-built Image Pattern

Building a Dev Container from a `Dockerfile` with several Features applied takes time — typically two to five minutes on a cold cache. For a team of 20 developers, that is 40 minutes of aggregate waiting time every time a new hire onboards or a developer rebuilds their environment.

The **Pre-built Image Pattern** eliminates the cold-start penalty. The CI workflow in this repository already publishes the validated Dev Container image to GHCR on every push to `main`. A developer (or Codespace) can consume that pre-built image directly by swapping the `"build"` key for an `"image"` key in `devcontainer.json`:

```json
{
  "name": "Node.js Dev",
  "image": "ghcr.io/your-org/devcontainers-part2/devcontainer:latest",
  "updateContentCommand": "npm install",
  "postCreateCommand": "bash scripts/post-create.sh",
  "remoteUser": "vscode"
}
```

With this configuration, running `devcontainer up` pulls the pre-built image rather than building it from scratch. The pull is fast (cached layers are reused) and the result is bit-for-bit identical to what CI tested. The `updateContentCommand` and `postCreateCommand` hooks still run to install dependencies and set up git hooks, but the multi-minute image build is eliminated entirely.

> **Tip:** Pin to a specific SHA tag (e.g., `:ghcr.io/your-org/devcontainers-part2/devcontainer:abc1234`) rather than `:latest` for environments where reproducibility is a strict requirement, such as a security audit or a long-running release branch.

---

## GitHub Codespaces

GitHub Codespaces runs your Dev Container on a GitHub-managed virtual machine in the cloud. The `devcontainer.json` file is used without modification — there is no separate Codespaces configuration format, no translation layer. Opening a Codespace is equivalent to running `devcontainer up` on a remote machine with a fast internet connection to the GitHub network.

### Security posture

Because the development environment runs in the cloud, **source code and credentials never touch the physical device**. A developer can open a Codespace on a corporate-managed Chromebook, a personal iPad, or a borrowed laptop, and the security posture of the session is identical in all cases. This is a meaningful argument for organisations that need to enforce source code containment.

### Codespaces-specific keys in `devcontainer.json`

**`hostRequirements`** specifies the minimum machine specification that the Codespace must run on:

```json
"hostRequirements": {
  "cpus": 4,
  "memory": "8gb",
  "storage": "32gb"
}
```

GitHub will select a machine class that meets or exceeds these requirements. Organisation administrators can set a ceiling on the maximum machine class available to developers, so `hostRequirements` functions as a floor and policy sets the ceiling.

**`forwardPorts`** lists the ports that Codespaces (and VS Code Remote) should forward to the developer's local machine automatically, without any manual port-forwarding command:

```json
"forwardPorts": [3000, 5432, 6379]
```

**`portsAttributes`** assigns a human-readable label and an auto-forward behaviour to each port:

```json
"portsAttributes": {
  "3000": { "label": "App Server",  "onAutoForward": "notify" },
  "5432": { "label": "PostgreSQL",  "onAutoForward": "silent" },
  "6379": { "label": "Redis",       "onAutoForward": "silent" }
}
```

`"notify"` pops a VS Code notification when port 3000 opens, offering to open the browser. `"silent"` forwards the port without any notification — appropriate for infrastructure ports that developers do not interact with directly via a browser.

### `updateContentCommand` and prebuilds

Codespaces supports **prebuilds**: a GitHub Actions workflow that builds the Dev Container image and runs lifecycle hooks up to and including `postCreateCommand`, then snapshots the result. When a developer opens a new Codespace, the prebuild snapshot is restored rather than built from scratch, eliminating the cold-start penalty.

After a prebuild snapshot is restored, `postCreateCommand` does **not** re-run (it already ran when the snapshot was taken). `updateContentCommand` **does** re-run. This is why `npm install` lives in `updateContentCommand` rather than `postCreateCommand` in this repository — it ensures that packages added or updated since the snapshot was captured are installed before the developer begins working.

### Codespaces secrets

Environment variables that contain secrets (`INTERNAL_API_KEY`, cloud credentials, etc.) should be stored as Codespaces secrets, not in the repository:

```bash
gh secret set INTERNAL_API_KEY --app codespaces
```

Codespaces secrets are injected into the container as environment variables at startup. They are never stored in the repository, never visible in logs, and never included in prebuild snapshots.

---

## SSH Agent Forwarding

Private repositories, internal package registries, and remote servers that require SSH key authentication all work inside the container via socket bind-mounting — no key material is copied into the container.

### How it works

The host SSH agent listens on a Unix socket. The `devcontainer.json` bind-mounts that socket into the container and sets `SSH_AUTH_SOCK` inside the container to point at it:

```json
"mounts": [
  "source=${localEnv:SSH_AUTH_SOCK},target=/ssh-agent,type=bind"
],
"remoteEnv": {
  "SSH_AUTH_SOCK": "/ssh-agent"
}
```

Any process inside the container that needs SSH authentication talks to `/ssh-agent`, which is the host agent's socket. The private key never enters the container filesystem.

### Platform-specific notes

| Platform | SSH agent socket path | Notes |
|---|---|---|
| Linux | `$SSH_AUTH_SOCK` (set automatically by `ssh-agent` or `systemd`) | Works out of the box on most distributions. |
| macOS (OrbStack or Colima) | `$SSH_AUTH_SOCK` | Works out of the box; the socket is a standard Unix socket. |
| macOS (Docker Desktop) | `$SSH_AUTH_SOCK` | Works, but Docker Desktop uses a VM — ensure the socket is accessible to the VM. Some users need `SSH_AUTH_SOCK=/run/host-services/ssh-auth.sock` for the Docker Desktop-managed socket. |
| Windows (WSL2) | Set `SSH_AUTH_SOCK` in your WSL2 environment | Use `ssh-pageant` or `npiperelay` to bridge the Windows OpenSSH agent or Pageant into WSL2. |

### Pre-flight check

Before opening the container, verify that your SSH agent is running and has your key loaded:

```bash
ssh-add -l
```

You should see at least one key fingerprint. If you see `The agent has no identities`, run `ssh-add ~/.ssh/id_ed25519` (or the path to your key). If you see `Could not open a connection to your authentication agent`, start the agent with `eval "$(ssh-agent -s)"` and then add your key.

---

## Git Identity

Git commits made inside the container carry the correct author name and email because the host `~/.gitconfig` is mounted into the container as a read-only bind-mount:

```json
"mounts": [
  "source=${localEnv:HOME}/.gitconfig,target=/home/vscode/.gitconfig,type=bind,consistency=cached,readonly"
]
```

The mount is read-only to prevent accidental modification from inside the container. The `remoteUser` in `devcontainer.json` is `vscode`, so the target path `/home/vscode/.gitconfig` is the correct location for Git to discover the file.

> **Windows note:** On Windows, replace `${localEnv:HOME}` with `${localEnv:USERPROFILE}` in the mount source path, as Windows does not set `HOME` by default.

---

## API Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/` | Returns a welcome message and link to the repository |
| GET | `/health` | Returns `{ status, timestamp, uptime }` — suitable for use as a health check probe |

---

## Running Tests

```bash
npm test
```

This runs Vitest in **run mode** (non-watch, exits with code 0 on success or non-zero on failure). It is the identical command that the CI workflow executes inside the Dev Container via `runCmd: npm test`. There is no separate CI test script.

To run tests in watch mode during development:

```bash
npx vitest
```

---

## Environment Variables

| Variable | Source | Description |
|---|---|---|
| `NODE_ENV` | `containerEnv` in `devcontainer.json` | Set to `development` inside the container. Override to `test` or `production` as needed. |
| `TZ` | `containerEnv` in `devcontainer.json` | Timezone; set to `UTC` to ensure consistent timestamp behaviour across developer machines and CI. |
| `API_BASE_URL` | `remoteEnv` — read from host shell | Base URL for outbound API calls. Defaults to `http://localhost:3000` in `.env.example`. |
| `INTERNAL_API_KEY` | `remoteEnv` — read from host shell | API key for internal services. Set on the host; never commit this value. In Codespaces, set via `gh secret set --app codespaces`. |
| `PORT` | `.env` / host shell | Port the Express server listens on. Defaults to `3000` if unset. |
| `SSH_AUTH_SOCK` | `remoteEnv` in `devcontainer.json` | Path to the SSH agent socket inside the container. Set to `/ssh-agent` (the bind-mount target). |

---

## License

MIT © your-org
