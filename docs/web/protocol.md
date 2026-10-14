# Tolaria remote protocol, version 1.1

The HTTP protocol between a Tolaria client and a server that hosts one vault as a git repository. It is written so that anyone can implement a compatible server (self-hosting) or client. The reference implementation is `apps/server`; the wire types are in `packages/protocol/src/index.ts` and are the source of truth when this document and the code disagree.

Status: spikes S3 (TOL-5) and S4 (TOL-8). The file API and the collaboration channel below are implemented and tested. Version 1.1 added the collaboration channel; it changed nothing in the file API of 1.0.

## Design rules

- **Files stay files.** A vault is a git repository of markdown notes and attachments. The server never stores a note in a form git and the desktop app cannot read.
- **Every file has a revision.** The `etag` of a file is its git blob id (`sha1("blob <size>\0" + bytes)`), so a client or another server can compute it without asking.
- **A write states what it was based on.** The server never overwrites a version the client has not seen unless the client asks for exactly that.
- **Nothing is lost.** When a write cannot take the path it asked for, its bytes are saved next to it as a conflict copy.
- **Versioned and additive.** Routes carry the major version, responses carry the full version, and features are announced as capabilities. Collaboration adds routes and capabilities; it changes none of the file API.

## Versioning and negotiation

| Mechanism | Rule |
|---|---|
| Route prefix | `/v1`. A different major is a different prefix and a different protocol. |
| `Tolaria-Protocol-Version` response header | Sent on every response, for example `1.1`. |
| `Tolaria-Protocol-Version` request header | Optional. If present and its major is not the server's, the server answers `400 unsupported_protocol_version`. |
| Minor versions | Only add: new routes, new optional fields, new capabilities, new error codes. Clients must ignore fields and capabilities they do not know. |
| Capabilities | `GET /v1/vault` lists what this server does. Clients check a capability before using a feature. |

Capabilities:

| Capability | Meaning |
|---|---|
| `files.read`, `files.write`, `files.rename`, `files.delete` | The file routes below. |
| `files.conflict-copy` | A stale write is saved as a conflict copy instead of being rejected. |
| `search.text` | `GET /v1/search`. |
| `sync.git` | The vault is backed by a git remote; `pushed` and `POST /v1/sync` are meaningful. |
| `docs.ids` | Notes carry a stable `docId`. |
| `collab.yjs`, `collab.awareness` | The collaboration channel is served (since 1.1). |
| `collab.tickets` | `POST /v1/collab/tickets` issues websocket tickets (since 1.1). |

## Authentication and transport

- Every route except `GET /healthz` requires `Authorization: Bearer <token>`. A missing or wrong token gets `401 unauthorized` with `WWW-Authenticate: Bearer`.
- The reference server reads the token from `TOLARIA_SERVER_TOKEN` and does not start without it. It speaks plain HTTP and binds `127.0.0.1`; anything else needs an explicit opt-in and a TLS-terminating proxy in front.
- One token gives full access to the one vault. Accounts, per-user identity and permissions are outside this protocol version.
- `GET /healthz` answers `200 {"status":"ok"}` and reveals nothing about the vault.

## Paths

A path is relative to the vault root, uses `/`, and is percent-encoded in URLs (`/v1/files/my%20notes/caf%C3%A9.md`). The server answers `400 invalid_path` for:

- an empty path, an absolute path, an empty segment, or a `.` or `..` segment;
- any segment starting with `.git` in any letter case (`.git/`, `.gitignore`, `.gitattributes`);
- a backslash or a control character;
- more than 1024 bytes of UTF-8.

Symbolic links in the repository are not listed and are checked out as plain files.

## Errors

Every error has the same JSON body. `code` is stable; `message` is for people.

```json
{ "error": { "code": "precondition_failed", "message": "welcome.md changed since the given revision", "details": { "current": { "path": "welcome.md", "etag": "e7b4…" } } } }
```

| Status | `code` | When |
|---|---|---|
| 400 | `invalid_path` | The path breaks the rules above or is not valid percent-encoding. |
| 400 | `invalid_request` | A malformed body or query parameter. |
| 400 | `unsupported_protocol_version` | The client asked for another major version. |
| 401 | `unauthorized` | Missing or wrong bearer token. |
| 404 | `not_found` | No such file, or no such route. |
| 405 | `method_not_allowed` | The route exists but not for this method. `Allow` lists the supported ones. |
| 409 | `destination_exists` | A rename target exists, or the path runs through a file or names a folder. |
| 412 | `precondition_failed` | Rename or delete with an `etag` that is no longer current. `details.current` has the current one. |
| 413 | `payload_too_large` | The body exceeds the server's limit (25 MB by default). |
| 428 | `precondition_required` | A write or delete without the header that says what it was based on. |
| 500 | `internal` | Unexpected failure. The cause is logged, not returned. |
| 426 | `upgrade_required` | A plain HTTP request to the websocket route of the collaboration channel. |
| 501 | `not_implemented` | The collaboration channel on a server that does not serve it. |

A write that ends in a conflict copy is not an error body: see `PUT` below.

## Routes

### `GET /v1/vault`

```json
{
  "protocolVersion": "1.1",
  "capabilities": ["files.read", "files.write", "files.rename", "files.delete", "files.conflict-copy", "search.text", "sync.git", "docs.ids", "collab.yjs", "collab.awareness", "collab.tickets"],
  "vault": { "name": "my-vault", "branch": "main", "head": "eea2db93a391d110c4707fa1f6c6078c2f39c1ca" },
  "collab": { "available": true, "path": "/v1/collab/docs", "docFormat": "tolaria.blocknote/1", "blocksFragment": "blocks", "frontmatterField": "frontmatter", "metaMap": "meta" }
}
```

### `GET /v1/files[?prefix=<path prefix>]`

Lists every tracked file at the server's current commit.

```json
{
  "head": "eea2db93a391d110c4707fa1f6c6078c2f39c1ca",
  "files": [
    { "path": "projects/heron.md", "size": 106, "etag": "7b8f92b1420404a572d7da3665fe7d969127e438", "docId": "42862532-a9e7-437f-9e73-86d32c07ff56" },
    { "path": "attachments/pixel.png", "size": 70, "etag": "2f6d…" }
  ]
}
```

`docId` is present for notes (`.md`) only. The listing does not contact the git remote; call `POST /v1/sync` first to pick up pushes from other devices.

### `GET /v1/files/<path>`

Returns the bytes of the file.

| Response header | Value |
|---|---|
| `ETag` | `"<etag>"` |
| `Content-Type` | `text/markdown; charset=utf-8` for notes, `application/octet-stream` otherwise |
| `Tolaria-Doc-Id` | The note's `docId` (notes only) |

`If-None-Match: "<etag>"` gets `304` with no body when the client's copy is current.

### `PUT /v1/files/<path>`

The body is the complete new content of the file, as raw bytes. Exactly one precondition is required:

| Request header | Meaning |
|---|---|
| `If-Match: "<etag>"` | "I edited this revision." The normal save. |
| `If-None-Match: *` | "I am creating this file." |
| `If-Match: *` | "Overwrite whatever is there." Explicit last-write-wins. |
| none | `428 precondition_required`. A missing header is more often a bug than a decision. |

The server pulls from the git remote, decides, commits once, and pushes. The response is always a write result:

```json
{ "outcome": "updated", "path": "welcome.md", "etag": "872e91ac…", "commit": "ddd19dd2…", "pushed": true, "docId": "bc1a7bc2-…" }
```

| `outcome` | Status | What happened |
|---|---|---|
| `created` | 201 | The file did not exist. |
| `updated` | 200 | The stored revision matched (or `If-Match: *`). |
| `unchanged` | 200 | The stored content is already these bytes. No commit. |
| `recreated` | 201 | The client edited a revision of a file that has since been deleted. The edit wins and the file is back. |
| `conflict` | 409 | The stored revision is not the one the client edited (or a create found the file there). The stored file is untouched; the request's bytes are saved as a conflict copy. |

On `conflict`, `path` and `etag` describe the conflict copy and `current` describes the file that kept the requested path:

```json
{
  "outcome": "conflict",
  "path": "welcome (conflict 2026-10-12 1611).md",
  "etag": "cb6f3257…",
  "commit": "e2cb1688…",
  "pushed": true,
  "docId": "91db80d4-…",
  "current": { "path": "welcome.md", "etag": "e7b4ed52…" }
}
```

- The copy is named `<name> (conflict <YYYY-MM-DD HHMM>)<ext>` in UTC, next to the original, with a counter appended (`… 1611 2`, `… 1611 3`) when the name is taken. It is an ordinary file with its own `docId`.
- `pushed: false` means the commit is safe on the server but has not reached the git remote (the remote is unreachable, or pushing kept losing a race). The server pushes it with the next write or `POST /v1/sync`.
- `Server-Timing: pull;dur=…, commit;dur=…, push;dur=…` reports the three phases in milliseconds.
- If another device pushes the same file between the server's fetch and its push, the server keeps the pushed version and returns `conflict` with a conflict copy, exactly as above.

### `DELETE /v1/files/<path>`

Requires `If-Match: "<etag>"`; `*` is not accepted. `412 precondition_failed` when the file has changed. One commit, pushed.

```json
{ "path": "welcome.md", "commit": "…", "pushed": true }
```

### `POST /v1/rename`

```json
{ "from": "people/ada.md", "to": "people/ada-lovelace.md", "ifMatch": "b5fa61f2…" }
```

`ifMatch` is optional. Missing folders of `to` are created. One commit, pushed; the note keeps its `docId`.

```json
{ "from": "people/ada.md", "path": "people/ada-lovelace.md", "etag": "b5fa61f2…", "commit": "…", "pushed": true, "docId": "ecc6f1fe-…" }
```

`404 not_found` when `from` is missing, `409 destination_exists` when `to` exists, `412 precondition_failed` when `ifMatch` is stale. The route is not `/v1/files/<path>/rename` because a vault path may itself end in `/rename`. Version 1.0 moves the file only; it does not rewrite wikilinks in other notes.

### `GET /v1/search?q=<text>[&limit=<n>]`

Case-insensitive search for the literal text `q` (1 to 200 characters, one line) in tracked text files and in file paths. `limit` defaults to 50 and is capped at 200. Up to three matching lines per file, each cut at 300 characters.

```json
{ "results": [ { "path": "projects/alpha.md", "pathMatch": false, "matches": [ { "line": 3, "text": "Links to [[welcome]] and mentions the Heron." } ] } ], "truncated": false }
```

### `POST /v1/sync`

Pulls from the git remote and pushes anything pending. Clients call it to pick up changes pushed by the desktop app.

```json
{ "head": "dede5f41…", "pulled": true, "pushed": true }
```

`pulled: false` means the remote could not be reached; the server keeps serving its copy.

## How the server keeps git consistent

Every mutation runs alone, in this order: fetch and integrate the remote, change files, commit, push.

- **Remote ahead, nothing local pending:** fast-forward.
- **Local commits pending and the remote moved** (the server was offline, or lost a push race): the remote's history wins. The server resets to it and re-applies its pending changes file by file in one commit. A pending change to a file the remote also changed becomes a conflict copy; a pending deletion of such a file is dropped.
- **Push rejected:** integrate and retry, up to three times, then answer `pushed: false`.

The server never force-pushes and never rewrites commits that reached the remote.

## Document ids

A `docId` is a random UUID the server assigns to each note. It identifies the note's collaborative document and stays with the note through renames, including renames made on the desktop and pulled in from git (detected with git's rename detection). It is server state, kept outside the repository; nothing is written into the note. A note that is deleted, or a conflict copy, gets a fresh id. If server state is lost, ids are reassigned and documents are rebuilt from the markdown files.

## The collaboration channel (since 1.1)

A note can be opened as a live document that several clients edit at once. The markdown file stays the canonical form: the document is loaded from it, written back to it, and can always be rebuilt from it.

### Document format `tolaria.blocknote/1`

One Y.Doc per note, with three shared types:

| Name | Type | Content |
|---|---|---|
| `blocks` | `Y.XmlFragment` | The note body, in the shape BlockNote's `collaboration.fragment` binds to (y-prosemirror). |
| `frontmatter` | `Y.Text` | The frontmatter block exactly as in the file, delimiters and final newline included; empty when the note has none. |
| `meta` | `Y.Map` | `format` (`tolaria.blocknote/1`); `baseRevision`, the `etag` of the file the document is in step with; `conflictCopy`, the path of a conflict copy holding edits that could not be merged with the file. Written by the server only: a client's change to this map is reverted. |

`Y.Text` holding raw markdown is deliberately not the body format: BlockNote's binding needs a `Y.XmlFragment`, and a text document would lose cursors and block identity. The format string leaves room for other formats.

### `POST /v1/collab/tickets`

Browsers cannot put an `Authorization` header on a websocket. A client holding the bearer token asks for a ticket and opens the websocket with it.

```json
{ "docId": "bc1a7bc2-…", "access": "write" }
```

`access` is `write` (default) or `read`. Answer, `201`:

```json
{ "ticket": "kq3…", "expiresAt": "2026-10-12T19:04:00.000Z", "path": "/v1/collab/docs/bc1a7bc2-…", "access": "write" }
```

A ticket opens one websocket, for that document only, and expires after 60 seconds. `404 not_found` for an unknown `docId`, `400 invalid_request` for another `access`, `501 not_implemented` when the channel is not served.

### `GET /v1/collab/docs/<docId>` (websocket)

Authentication, one of:

- `?ticket=<ticket>` from the route above;
- `Authorization: Bearer <token>` on the upgrade request, for clients that can send headers. It gives `write` access.

The upgrade is refused with `401` without valid credentials and with `404` for an unknown document. A request without an upgrade gets `426 upgrade_required`.

Messages are binary and framed as y-websocket frames them, so stock Yjs providers can connect: a varint message type, then the payload.

| Type | Payload | Meaning |
|---|---|---|
| `0` sync | y-protocols sync message: step 1 (state vector), step 2 (missing updates) or update | Both sides send step 1 on connect and answer the other's with step 2; afterwards every change is an update. A sync message of any other subtype is ignored. |
| `1` awareness | y-protocols awareness update | Presence. Clients publish `{ "user": { "name": "…", "color": "#rrggbb" } }` and BlockNote adds the cursor. The server relays it and withdraws a client's presence when its socket closes. |
| `3` awareness query | none | The server answers with the awareness of everyone present. |

Unknown message types are ignored. A message larger than 16 MiB (or the server's lower limit) closes the connection with `1009`; so does sending more than one message's worth before the document has opened. Bytes that are not a message close it with `4400`. When the note is deleted the server closes the room with `4410`.

The server tries every change on a copy of the document before applying it. A change that would add a shared type other than the three of the format, a node type or attribute the editor schema does not have, or an unknown mark, is not applied, and the connection that sent it is closed with `4422`. The `meta` map is written by the server only; a client's change to it is reverted.

A `read` session receives everything and may publish awareness; sync step 2 and update messages from it are dropped.

### What the server does with a document

- **Open.** The document is loaded from its stored snapshot when there is one, otherwise built from the markdown file. A snapshot whose `baseRevision` is not the file's current `etag` is reconciled with the file first.
- **Flush.** An edited document is written to its file, as one commit through the same write path as `PUT`, 5 seconds after the last edit or 60 seconds after the first unwritten one, when the last client has left, and when the server stops. Lines that were not edited keep the bytes they have in the file. A result identical to the file makes no commit. After a flush the server sets `meta.baseRevision`.
- **Reconcile.** When the file changes underneath a live document (a commit pulled from the git remote): a document without unwritten edits takes the file's content; edits on different lines are merged three ways; edits on the same lines are forked, the file keeps its path, the document's version is committed as a conflict copy and `meta.conflictCopy` names it.
- **Persist.** Snapshots are kept by `docId` in the server's blob store. They exist so that a reconnecting client and the server share one Yjs history; the markdown file remains what the document is rebuilt from.

Measured cadence and the reasons are in `docs/web/s4-spike-report.md`.

## Differences from the surface sketched in S1

`docs/web/s1-tauri-inventory.md` listed the server surface before this spike. What differs, and why:

| S1 sketch | This version | Reason |
|---|---|---|
| `PUT` with no precondition is last-write-wins | `428`; `If-Match: *` asks for last-write-wins | An absent header should not silently overwrite. |
| A stale `PUT` is rejected, conflict copy on request | Always a conflict copy, answered with `409` | The save is never lost, also when the client goes away. |
| `POST /v1/files/{path}/rename`, rewrites wikilinks | `POST /v1/rename`, moves the file only | Unambiguous paths; link rewriting needs the note index. |
| `GET /v1/entries`, `GET /v1/changes`, attachments routes | Not in 1.1 | Additive; listed as next steps in the spike reports. Attachments already work as plain files through `/v1/files`. |
| Collab tickets | `POST /v1/collab/tickets`, since 1.1 | As sketched. |
