# Tolaria server

The Tolaria remote: a small service that hosts one vault as a git working clone and exposes the file API and the collaboration channel of the [Tolaria remote protocol](../../docs/web/protocol.md). Spikes S3 (TOL-5) and S4 (TOL-8); see the spike reports for [files](../../docs/web/s3-spike-report.md) and [collaboration](../../docs/web/s4-spike-report.md).

Every save is one git commit, made after pulling from the vault's git remote and followed by a push. A write that is based on an outdated revision is saved as a conflict copy; nothing is overwritten silently.

A note can also be opened as a live Yjs document on `/v1/collab/docs/<docId>`. Edits are written to the note's markdown file on a cadence, with untouched lines byte-identical, and a commit pulled from git is merged into the live document or forked into a conflict copy.

## Run

Node 22.14 or newer and `git` on the `PATH`. From the repository root:

```bash
TOLARIA_SERVER_TOKEN="$(openssl rand -hex 24)" \
TOLARIA_VAULT_REMOTE_URL=/path/to/vault.git \
TOLARIA_SERVER_DATA_DIR=/var/lib/tolaria \
pnpm run server
```

Use `pnpm run server`: bare `pnpm server` is a pnpm built-in command.

| Variable | Default | Meaning |
|---|---|---|
| `TOLARIA_SERVER_TOKEN` | none, required | Bearer token for every route except `/healthz`. At least 16 characters. The server does not start without it |
| `TOLARIA_VAULT_REMOTE_URL` | none | Git URL of the vault. Required until the working clone exists |
| `TOLARIA_VAULT_BRANCH` | the remote's default | Branch to serve |
| `TOLARIA_SERVER_DATA_DIR` | `./data` | Holds `vault/` (the clone) and `state/` (doc index) |
| `TOLARIA_SERVER_HOST` | `127.0.0.1` | Bind address |
| `TOLARIA_SERVER_PORT` | `8787` | Port |
| `TOLARIA_SERVER_ALLOW_NON_LOOPBACK` | unset | Set to `1` to bind a non-loopback address. The server speaks plain HTTP: only do this behind a TLS-terminating proxy |
| `TOLARIA_SERVER_MAX_BODY_BYTES` | `26214400` | Largest accepted request body, and websocket message up to 16 MiB |
| `TOLARIA_COLLAB` | on | Set to `0` to leave the collaboration channel unserved |
| `TOLARIA_COLLAB_IDLE_MS` | `5000` | Write an edited document this long after its last edit |
| `TOLARIA_COLLAB_MAX_WAIT_MS` | `60000` | Write it at the latest this long after its first unwritten edit |
| `TOLARIA_COLLAB_LINGER_MS` | `30000` | Keep a document without clients open this long |

Git credentials for a private remote come from the environment the server runs in (SSH agent or a credential helper), never from the URL.

## Try it against a throwaway vault

```bash
pnpm server:seed /tmp/test-vault.git        # a bare repository with a fake vault
TOLARIA_SERVER_TOKEN=local-dev-token-0123456789 TOLARIA_VAULT_REMOTE_URL=/tmp/test-vault.git \
  TOLARIA_SERVER_DATA_DIR=/tmp/tolaria-data pnpm run server

curl -H 'Authorization: Bearer local-dev-token-0123456789' http://127.0.0.1:8787/v1/files
pnpm server:bench /tmp/test-vault.git 100   # latency of 100 saves; writes to that remote
pnpm run server:collab-bench /tmp/test-vault.git 30   # commit cadence of collaborative editing
```

Never point the seed, the benchmark or a test at a real vault.

## Develop

From the repository root:

| Command | What it does |
|---|---|
| `pnpm test:server` | Tests with coverage thresholds (Vitest, Node environment, real git in temporary directories) |
| `pnpm build` | Typechecks this directory with the rest of the repository (`tsc -b`) |
| `pnpm lint` | ESLint |

The file service uses Node's standard library, the system `git`, and the wire types in `packages/protocol`. The collaboration channel adds `ws`, `yjs`, `y-protocols`, `lib0`, `jsdom` and, through `packages/markdown-yjs`, BlockNote and the markdown pipeline in `src/`. That shared code is written for a bundler, so `scripts/run.ts` bundles an entry point with esbuild before running it. The three Yjs packages are not declared in `package.json` yet; `yjsResolution.ts` explains how they are resolved and why (see the S4 spike report, "Dependencies").

Like `apps/web`, this is a directory of the root package, not a pnpm workspace package, so the lockfile is untouched. The desktop app does not import it and its bundle is unchanged by it.
