# CipherNote

**End-to-end encrypted notes with revocable sharing.**

CipherNote is a full-stack secure notes application where note content is encrypted **on the user's device, in the browser, before it is ever sent to the server**. The API and database store ciphertext and wrapped keys that they cannot decrypt.

**Team SYNCSQUAD** — Srikanth G · Vignesh S · Moushika G · Navasakthi A

This project lives in `desktop/cipher/`. All commands below are run from this directory unless stated otherwise.

---

## Table of contents

1. [What it does](#what-it-does)
2. [Tech stack](#tech-stack)
3. [Repository layout](#repository-layout)
4. [Prerequisites](#prerequisites)
5. [Setup](#setup)
6. [Environment variables](#environment-variables)
7. [Running the application](#running-the-application)
8. [Architecture](#architecture)
9. [Data model](#data-model)
10. [API reference](#api-reference)
11. [Encryption flow](#encryption-flow)
12. [Sharing flow](#sharing-flow)
13. [Revocation model](#revocation-model)
14. [Local search](#local-search)
15. [Audit log](#audit-log)
16. [Security inspector](#security-inspector)
17. [Demo flow: Alice, Bob and a revoked share](#demo-flow-alice-bob-and-a-revoked-share)
18. [Threat model](#threat-model)
19. [Security limitations](#security-limitations)
20. [Troubleshooting](#troubleshooting)

---

## What it does

| Feature | Description |
| --- | --- |
| **Authentication** | Register, login, logout, bcrypt password hashing, JWT sessions, protected routes on both client and server. |
| **Notes** | Create, read, edit and delete notes with a title, body and tags. Content is sealed with AES-GCM in the browser; the server stores the resulting blob. |
| **Secure sharing** | Share a note with another registered user. The per-note AES key is wrapped with the recipient's RSA-OAEP public key, so only their private key can unwrap it. |
| **Shared With Me** | A dedicated page where recipients download ciphertext and decrypt it locally with their private key. |
| **Revocation** | The owner can revoke a recipient at any time. The API rejects every later request from that user, and the revocation is written to the audit log. |
| **Local search** | Search by title, body and tags. Search runs in the browser on notes that have already been decrypted — there is no server-side search endpoint. |
| **Activity log** | Sign-ins, note creation/update/deletion, sharing, revocation and denied access, all recorded with actor, target and timestamp. |
| **Security inspector** | A page that shows safe technical facts about a note (IDs, encryption version, nonce, ciphertext preview, sharing status) and never shows secrets. |
| **UI** | Responsive layout, sidebar navigation, dashboard cards, note cards, modals, toast notifications, loading/error/empty states, dark and light themes. |

### The one rule that shapes everything

> The server may see metadata — user IDs, note IDs, timestamps, sizes and the sharing graph. It **must never** receive or store plaintext note content.

No custom cryptography is used anywhere. Every primitive comes from the platform **Web Crypto API** on the client and from standard, audited libraries on the server.

---

## Tech stack

| Layer | Technology |
| --- | --- |
| Frontend | React 18, Vite 5, TypeScript, Tailwind CSS 3, React Router 6, Lucide React icons |
| Backend | Node.js, Express 4, TypeScript, Zod validation, Helmet, express-rate-limit |
| Database | SQLite via Prisma ORM |
| Password hashing | bcrypt (`bcryptjs`) |
| Note encryption | AES-GCM-256 (Web Crypto `crypto.subtle`) |
| Key derivation | PBKDF2-SHA256, 210,000 iterations (Web Crypto) |
| Secure key sharing | RSA-OAEP-2048 with SHA-256 (Web Crypto) |
| Session tokens | JSON Web Tokens (HS256) |

**Why bcrypt instead of Argon2?** The project uses `bcryptjs`, a pure-JavaScript implementation, so a fresh clone installs and runs on any machine without a native build toolchain. The stored hash string carries its algorithm and cost, and all password work is isolated in `server/src/lib/password.ts`, so swapping in `argon2` is a one-file change.

---

## Repository layout

```
desktop/cipher/
├── package.json                  # root scripts: setup, dev, build, typecheck
├── README.md
├── server/                       # Express + Prisma API
│   ├── .env.example
│   ├── package.json
│   ├── tsconfig.json
│   ├── prisma/
│   │   └── schema.prisma         # User, Note, NoteShare, AuditLog
│   └── src/
│       ├── index.ts              # app bootstrap, helmet, CORS, rate limits
│       ├── env.ts                # environment parsing and validation
│       ├── db.ts                 # Prisma client singleton
│       ├── lib/
│       │   ├── access.ts         # the single note authorization gate
│       │   ├── audit.ts          # audit actions + best-effort writer
│       │   ├── http.ts           # ApiError, asyncHandler, body parsing
│       │   ├── jwt.ts            # session token sign/verify
│       │   ├── password.ts       # bcrypt hashing and verification
│       │   ├── schemas.ts        # Zod request schemas
│       │   └── serialize.ts      # HTTP response shapes (never plaintext)
│       ├── middleware/
│       │   ├── auth.ts           # bearer-token authentication
│       │   └── error.ts          # central error -> HTTP mapping
│       └── routes/
│           ├── auth.ts           # register, login, me, logout
│           ├── users.ts          # public-key lookup for sharing
│           ├── notes.ts          # note CRUD + share + revoke
│           ├── shared.ts         # shared-with-me listing
│           └── audit.ts          # audit log listing
└── client/                       # React + Vite app
    ├── .env.example
    ├── index.html
    ├── tailwind.config.js
    ├── vite.config.ts            # dev proxy /api -> localhost:4000
    └── src/
        ├── App.tsx               # routes
        ├── main.tsx              # providers
        ├── index.css             # Tailwind layers + component classes
        ├── components/           # layout, sidebar, topbar, cards, modal, states
        ├── context/
        │   ├── AuthContext.tsx   # session state + in-memory crypto keys
        │   ├── ThemeContext.tsx  # dark/light theme
        │   └── ToastContext.tsx  # toast notifications
        ├── hooks/useNotes.ts     # load + locally decrypt notes
        ├── lib/
        │   ├── crypto.ts         # ALL client-side cryptography
        │   ├── api.ts            # typed API client
        │   ├── notes.ts          # decryption helpers + local search
        │   ├── auditActions.ts   # audit event presentation
        │   ├── format.ts         # date/size/text formatting
        │   └── types.ts          # API response types
        └── pages/                # landing, register, login, unlock, dashboard,
                                  # notes, editor, viewer, shared, activity, inspector
```

---

## Prerequisites

- **Node.js 18.17 or newer** (Node 20 LTS recommended) — the Web Crypto API and modern Prisma require it.
- **npm 9 or newer**.
- A modern browser with `crypto.subtle` (Chrome, Edge, Firefox or Safari). The app must be served from a **secure context**: `http://localhost` counts, but a LAN IP over plain HTTP does not, and the app will tell you so.

---

## Setup

### 1. Install dependencies

```bash
# from desktop/cipher
npm run setup
```

This installs `server/` and `client/` separately (they are independent packages, not npm workspaces). The server's `postinstall` step runs `prisma generate`.

If you prefer to install by hand:

```bash
npm --prefix server install
npm --prefix client install
```

### 2. Configure the server environment

```bash
cp server/.env.example server/.env
```

Then edit `server/.env` and set at least `JWT_SECRET`. Generate a strong value with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

### 3. Create the database

SQLite needs no server — Prisma creates a single file at `server/prisma/dev.db`.

```bash
# from desktop/cipher
npm run db:setup
```

That runs `prisma generate` followed by `prisma migrate dev --name init`, which creates the migration and applies it.

**Alternative (no migration files, fastest for a demo):**

```bash
npm run db:push
```

**Reset the database:**

```bash
npm run db:reset
```

**Inspect the data** (useful to prove that only ciphertext is stored):

```bash
npm --prefix server run prisma:studio
```

### 4. Start the app

```bash
npm run dev
```

- API: <http://localhost:4000>
- Web: <http://localhost:5173>

The Vite dev server proxies `/api` to the API, so the browser only ever talks to one origin.

---

## Environment variables

### `server/.env`

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | `file:./dev.db` | SQLite file location, relative to `server/prisma/`. |
| `PORT` | `4000` | Express listen port. |
| `CLIENT_ORIGIN` | `http://localhost:5173` | Allowed CORS origin(s), comma-separated. |
| `JWT_SECRET` | *(dev placeholder)* | Signs session tokens. **Must** be set in production — the server refuses to boot with the placeholder when `NODE_ENV=production`. |
| `JWT_EXPIRES_IN` | `12h` | Session lifetime. |
| `BCRYPT_ROUNDS` | `12` | bcrypt cost factor. |
| `AUTH_RATE_LIMIT_WINDOW_MS` | `900000` | Window for the credential rate limiter (15 min). |
| `AUTH_RATE_LIMIT_MAX` | `30` | Max credential attempts per window. |
| `NODE_ENV` | `development` | Production mode hides internal error details. |

### `client/.env` (optional)

| Variable | Default | Purpose |
| --- | --- | --- |
| `VITE_API_BASE_URL` | `/api` | API base URL. Leave empty in development so the Vite proxy handles it. Set it when the client and API are on different origins. |

No secret is required by the client. It is architecturally incapable of holding the server's JWT secret, because it never needs it.

---

## Running the application

| Command (run from `desktop/cipher`) | What it does |
| --- | --- |
| `npm run setup` | Install both packages. |
| `npm run db:setup` | Generate the Prisma client and apply migrations. |
| `npm run db:push` | Push the schema without creating migration files. |
| `npm run db:reset` | Drop and recreate the database. |
| `npm run dev` | Run API and web client together with `concurrently`. |
| `npm run dev:server` | API only (`tsx watch`). |
| `npm run dev:client` | Web client only (Vite). |
| `npm run typecheck` | TypeScript check for both packages. |
| `npm run build` | Compile the server to `server/dist` and build the client to `client/dist`. |
| `npm start` | Run the compiled server. |

> `server/` and `client/` are resolved relative to this directory, so the root scripts work unchanged from `desktop/cipher`.

---

## Architecture

```
┌──────────────────────────── Browser (trusted for this user) ─────────────────────────┐
│                                                                                      │
│  password ──PBKDF2──► KEK ──AES-GCM──► master key ──AES-GCM──► note key ──AES-GCM──►  │
│                                                                      note plaintext  │
│                                                                                      │
│  React app ── crypto.subtle only, keys live in memory ──► HTTPS fetch (JSON)          │
└───────────────────────────────────────┬──────────────────────────────────────────────┘
                                        │  ciphertext, nonce, wrapped keys, metadata
                                        ▼
┌──────────────────────────── Server (zero-knowledge) ─────────────────────────────────┐
│  Express + Zod validation + JWT auth + per-route authorization                        │
│  Prisma ──► SQLite: users, notes, note_shares, audit_logs                             │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

### Trust boundaries

| Component | Trusted with | Not trusted with |
| --- | --- | --- |
| Browser (client) | Password, all keys, all plaintext | — |
| API server | Metadata, ciphertext, wrapped keys, bcrypt hashes | Note plaintext, passwords, unwrapped keys |
| SQLite database | Same as the API (it is the API's storage) | Note plaintext, unwrapped keys |

### Session model

Two independent states are tracked after sign-in:

1. **Session** — a JWT that authenticates requests. Mirrored to `localStorage` so a page reload can restore it.
2. **Vault** — the in-memory `masterKey` and `privateKey` `CryptoKey` objects. **Never persisted anywhere.**

A reload therefore restores the session but not the keys, and the app routes to `/unlock`. Re-entering the password re-derives the KEK with PBKDF2 and unwraps the master key and private key again. This is the intended behaviour of a zero-knowledge app: there is nothing on disk to steal that would let an attacker read notes. The **Lock** button in the sidebar drops the keys while keeping the session.

Authorization is enforced server-side on every protected route by `server/src/middleware/auth.ts` and `server/src/lib/access.ts`. Client-side route guards are a UX affordance only.

---

## Data model

Four models in `server/prisma/schema.prisma`.

### `User`

Identity plus the key material the server stores but cannot read.

| Field | Meaning |
| --- | --- |
| `email`, `displayName`, `passwordHash` | Identity and bcrypt hash. |
| `publicKey` | RSA-OAEP public key, SPKI, base64. Public by design — other users fetch it to share notes with you. |
| `wrappedPrivateKey`, `privateKeyIv` | The PKCS#8 private key, encrypted with the user's master key (AES-GCM). |
| `kdfSalt`, `kdfIterations` | Parameters for PBKDF2 (password → KEK). Stored so the derivation can be repeated on login. |
| `wrappedMasterKey`, `masterKeyIv` | The AES-256 master key, encrypted with the password-derived KEK. |

### `Note`

| Field | Meaning |
| --- | --- |
| `ownerId` | Authorizing owner. |
| `ciphertext`, `iv` | AES-GCM output (base64) of the JSON payload `{title, content, tags}` and its unique 96-bit nonce. |
| `encryptionVersion`, `algorithm` | Format version and cipher label, for forward evolution. |
| `payloadBytes` | Length of the plaintext payload — metadata only, no content. |
| `wrappedNoteKey`, `noteKeyIv` | The per-note AES key, wrapped with the owner's master key. |

There is deliberately **no plaintext `title` column**. The dashboard, note list and search all read titles out of the decrypted payload.

### `NoteShare`

| Field | Meaning |
| --- | --- |
| `noteId`, `ownerId`, `sharedWithId` | Who shared what with whom. Unique per `(noteId, sharedWithId)`. |
| `wrappedKey`, `keyAlgorithm` | The note key encrypted to the recipient with RSA-OAEP-2048/SHA-256. |
| `createdAt`, `revokedAt` | `revokedAt === null` means the share is active. |

### `AuditLog`

| Field | Meaning |
| --- | --- |
| `userId`, `action` | Who did what. |
| `targetType`, `targetId`, `noteId` | What it was done to. |
| `metadata` | JSON string of identifiers and counts. **Never** note content. |
| `ipAddress`, `createdAt` | Origin and time. |

---

## API reference

All routes are prefixed with `/api`. Every route except `POST /auth/register`, `POST /auth/login` and `GET /health` requires `Authorization: Bearer <token>`.

### Health

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/health` | Liveness plus a summary of the algorithms in use, and `serverStoresPlaintext: false`. |

### Authentication

| Method | Path | Body / notes |
| --- | --- | --- |
| `POST` | `/auth/register` | `email`, `displayName`, `password`, plus the client-generated `publicKey`, `wrappedPrivateKey`, `privateKeyIv`, `kdfSalt`, `kdfIterations`, `wrappedMasterKey`, `masterKeyIv`. Returns `{ token, user }`. Rate limited. |
| `POST` | `/auth/login` | `email`, `password`. Verifies the bcrypt hash and returns `{ token, user }` with the wrapped key material. Rate limited. |
| `GET` | `/auth/me` | Rehydrates a session after a reload. |
| `POST` | `/auth/logout` | Records the logout event. Sessions are stateless JWTs, so the token is discarded client-side. |

### Users

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/users/lookup?email=` | Returns `{ id, email, displayName, publicKey }` for a registered user — the minimum needed to share with them. Exact match only. |

### Notes

| Method | Path | Authorization | Notes |
| --- | --- | --- | --- |
| `GET` | `/notes` | Owner | The caller's own notes, with active shares. |
| `POST` | `/notes` | Owner | Stores `ciphertext`, `iv`, `wrappedNoteKey`, `noteKeyIv`, `encryptionVersion`, `algorithm`, `payloadBytes`. |
| `GET` | `/notes/:id` | Owner **or** unrevoked share holder | Recipients receive their own `wrappedKey`; owners receive `wrappedNoteKey` and the share list. |
| `PATCH` | `/notes/:id` | Owner only | Replaces ciphertext fields. |
| `DELETE` | `/notes/:id` | Owner only | Removes the note; shares cascade. |
| `GET` | `/notes/:id/shares` | Owner only | All shares including revoked ones. |
| `POST` | `/notes/:id/shares` | Owner only | Body `{ userId, wrappedKey }`. Re-sharing after a revocation clears `revokedAt`. |
| `DELETE` | `/notes/:id/shares/:userId` | Owner only | Revokes the share. |

### Sharing and audit

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/shared` | Notes shared with the caller that are still active, each with its `wrappedKey`. |
| `GET` | `/audit?action=&limit=` | The caller's own audit trail, newest first. |

### Error format

```json
{ "error": "You no longer have access to this note", "code": "NOTE_ACCESS_DENIED" }
```

Only explicitly constructed `ApiError`s expose their message. Everything else returns a generic `500` so internal details never leak.

| Code | HTTP | Meaning |
| --- | --- | --- |
| `UNAUTHORIZED`, `INVALID_SESSION` | 401 | Missing or invalid token. |
| `INVALID_CREDENTIALS` | 401 | Wrong email or password. |
| `NOTE_ACCESS_DENIED` | 403 | Right user, no active share (for example after revocation). |
| `NOT_NOTE_OWNER` | 403 | A mutation attempted by a non-owner. |
| `EMAIL_TAKEN` | 409 | Registration with an existing address. |
| `SHARE_ALREADY_REVOKED` | 409 | Double revocation. |
| `VALIDATION_ERROR` | 400 | Zod validation failure, with a `details` array. |

---

## Encryption flow

### Key hierarchy

```
password
   │  PBKDF2-SHA256, random 16-byte salt, 210,000 iterations
   ▼
KEK  (AES-GCM-256, non-extractable, never leaves memory)
   │  AES-GCM, random 96-bit nonce  ──► wrappedMasterKey + masterKeyIv   [stored server-side]
   ▼
master key  (AES-256, random)
   │  AES-GCM, random 96-bit nonce  ──► wrappedPrivateKey + privateKeyIv [stored server-side]
   ▼
RSA-OAEP-2048 private key (PKCS#8)

master key
   │  AES-GCM, fresh nonce per note ──► wrappedNoteKey + noteKeyIv       [stored server-side]
   ▼
note key  (AES-256, random per note)
   │  AES-GCM, fresh 96-bit nonce per write
   ▼
note payload  JSON { v, title, content, tags }  ──► ciphertext          [stored server-side]
```

### Registration

1. A random 16-byte PBKDF2 salt and a 32-byte master key are generated.
2. The KEK is derived from the password and used to wrap the master key (`encryptBytes(kek, masterKeyRaw)`).
3. An RSA-OAEP-2048 key pair is generated. The PKCS#8 private key is wrapped with the master key. The SPKI public key stays in the clear.
4. The password (for bcrypt) and the wrapped blobs are sent to `POST /auth/register`.
5. The unwrapped `masterKey` and `privateKey` stay in memory for the session.
6. Raw key bytes are zero-filled after use (`wipe`), as best-effort hygiene — JavaScript cannot guarantee erasure of intermediate copies.

### Login and unlock

1. `POST /auth/login` verifies the bcrypt hash and returns the user's wrapped key material.
2. The browser repeats the PBKDF2 derivation with the stored salt and iteration count.
3. The KEK unwraps `wrappedMasterKey`, and the master key unwraps `wrappedPrivateKey`.
4. A wrong password fails at AES-GCM **authentication**, not on the server — the server only ever compared a bcrypt hash.

### Writing a note

1. A fresh AES-256 note key is generated.
2. `{ title, content, tags }` is serialised to versioned JSON and encrypted with AES-GCM using a new 96-bit nonce.
3. The note key is wrapped with the master key.
4. Only the ciphertext, nonce, wrapped note key and metadata are uploaded.
5. Editing re-encrypts the payload with the **same** note key, so existing shares stay valid.

### Why a fresh nonce matters

AES-GCM catastrophically fails if a nonce is reused with the same key. Every write generates a new random 96-bit nonce via `crypto.getRandomValues`, and nonces are stored per ciphertext. AES-GCM also authenticates the ciphertext: any alteration to the blob, the nonce or the key makes decryption throw rather than returning corrupted plaintext. The notes list surfaces such failures explicitly instead of showing a broken note.

---

## Sharing flow

```
Alice (owner)                                          Bob (recipient)
─────────────                                          ───────────────
1. GET /users/lookup?email=bob  ──────────►  { id, publicKey (SPKI) }

2. noteKey = unwrap(masterKey, wrappedNoteKey)      [in memory]
   wrappedKey = RSA-OAEP(bob.publicKey, noteKey)

3. POST /notes/:id/shares { userId, wrappedKey } ─► NoteShare row
                                                   (revokedAt = null)

4. Audit: NOTE_SHARE

                        5. GET /shared  ◄──────────  lists active shares
                                                  with wrappedKey

                        6. noteKey = RSA-OAEP-decrypt(bob.privateKey, wrappedKey)
                           plaintext = AES-GCM-decrypt(noteKey, ciphertext, iv)

                        7. Bob reads the note locally
```

Key point: the note key is wrapped **in Alice's browser** with Bob's public key, and unwrapped **in Bob's browser** with Bob's private key. The server holds only the RSA ciphertext and cannot unwrap it. If Bob has never signed in on this device, his private key is not present, and the note cannot be decrypted — which is the definition of end-to-end.

Re-sharing with a user who was previously revoked reuses the same endpoint. The server clears `revokedAt` and stores the new `wrappedKey`, and the audit entry records `restoredAfterRevocation: true`.

---

## Revocation model

Revocation is **access control**, not cryptographic erasure.

**What happens when Alice revokes Bob:**

1. `DELETE /notes/:id/shares/:userId` verifies Alice owns the note.
2. The share row's `revokedAt` is set. The row is kept so the audit trail and share history remain intact.
3. Every authorization check filters on `revokedAt === null`, so the next request Bob makes fails immediately:
   - `GET /notes` no longer includes the note.
   - `GET /shared` no longer lists it.
   - `GET /notes/:id` returns `403 NOTE_ACCESS_DENIED`.
4. The denial is logged in **Bob's** audit trail as `ACCESS_DENIED` with `reason: REVOKED_SHARE`, and the revocation is logged in **Alice's** trail as `SHARE_REVOKE`.

**What revocation cannot do:**

- It cannot delete a copy of the plaintext Bob already decrypted, copied, screenshotted or exported.
- It cannot invalidate the `wrappedKey` Bob already holds. The note key itself is unchanged, so that key still matches the current ciphertext.
- It does not rotate the note key.

**Limitation, stated plainly:** CipherNote does not claim that revoking access erases anything already downloaded. The UI says this at the point of revocation, the landing page says it, and the security inspector says it, because overstating revocation is how security products lose trust.

**Stronger design (future work):** key rotation on revoke — generate a new note key, re-encrypt the note, re-wrap it for every remaining recipient, and discard the old ciphertext. That bounds the damage of a leaked key to the content a recipient already read, and is the natural next step. It is deliberately out of scope here so the current behaviour is honest and fully implemented rather than half-done.

---

## Local search

Search is **entirely client-side** (`client/src/lib/notes.ts` → `filterNotes`).

1. The app fetches ciphertext from `/notes` and `/shared`.
2. Each note is decrypted in the browser.
3. The filter matches the query against the decrypted **title**, **content** and **tags**, plus optional tag and role filters.

There is no server-side search route, no SQL `LIKE` over note content, and no search index of plaintext. The server would have nothing to search: it stores opaque blobs and it is not given the query. This prevents the two leaks a server-side search would create — the query terms themselves, and any ranking or match metadata derived from note content.

---

## Audit log

`server/src/lib/audit.ts` defines every recorded action.

| Action | Recorded when | Extra metadata |
| --- | --- | --- |
| `REGISTER` | A new account is created | — |
| `LOGIN` | Credentials accepted | `email` |
| `LOGIN_FAILED` | Wrong password for an existing account | — |
| `LOGOUT` | Session discarded | — |
| `NOTE_CREATE` | Note ciphertext stored | `encryptionVersion`, `algorithm`, `payloadBytes` |
| `NOTE_UPDATE` | Ciphertext replaced | `encryptionVersion`, `payloadBytes`, `keyRotated` |
| `NOTE_DELETE` | Note removed | `deletedNoteId`, `encryptionVersion` |
| `NOTE_SHARE` | Share created or restored | `recipientId`, `recipientEmail`, `keyAlgorithm`, `restoredAfterRevocation` |
| `SHARE_REVOKE` | Access withdrawn | `recipientId`, `recipientEmail`, `revokedAt` |
| `ACCESS_DENIED` | A request rejected for a revoked/absent share | `reason` |

Design decisions:

- **Metadata only.** `AuditMetadata` accepts strings, numbers and booleans. No note title, body or tag can be written, because the server never has them.
- **Self-scoped.** `GET /audit` only ever returns the caller's own events; there is no endpoint for another user's trail.
- **Best-effort writes.** An audit failure is logged to the server console but never turns a successful user action into an error response.
- **Visible in the UI.** `/activity` renders the trail with tone-coded icons, action filters, event counts and a JSON export.

---

## Security inspector

`/inspector` (and `/inspector/:noteId`) shows safe technical facts about one note. Clicking **Inspect** on any note card deep-links straight to it.

Displayed:

- Note ID, owner ID, your relationship to the note (owner or recipient)
- Encryption version and cipher label
- The full IV/nonce (base64) with a copy button
- Ciphertext preview (first 320 characters) with total base64 length
- Plaintext payload size, created and updated timestamps
- Sharing status: every share with recipient, algorithm, active or revoked
- A panel explaining which metadata the server *does* see

Never displayed: passwords or hashes, the KEK, the master key, note keys, the RSA private key in any form, or another user's private data. The page states this explicitly so the boundary is auditable rather than implied.

---

## Demo flow: Alice, Bob and a revoked share

Use two browser profiles (for example a normal window and a private/incognito window) so each has its own in-memory key session.

**Setup**

1. From `desktop/cipher`: `npm run setup` → `cp server/.env.example server/.env` → set `JWT_SECRET` → `npm run db:setup` → `npm run dev`.

**As Alice (window 1)**

2. Open <http://localhost:5173>, register **Alice** (`alice@example.com`). Watch the browser generate her keys before the request is sent.
3. **Create Note** → title "Incident review", some content, a tag → **Encrypt and save**.
   *Prove the ciphertext:* open Prisma Studio (`npm --prefix server run prisma:studio`) and look at the `Note` row — `ciphertext` and `iv` are base64 noise, and there is no title column.
4. Open the note → **Share** → look up `bob@example.com` → **Encrypt key & share**. Confirm the toast, and that Bob appears under "People with access".
5. **Activity Log** → confirm `NOTE_CREATE` and `NOTE_SHARE` entries.

**As Bob (window 2)**

6. Register **Bob** (`bob@example.com`).
7. **Shared With Me** → Alice's note appears, already decrypted locally.
8. Open it. Open **Security inspector** → "Recipient - holds a wrapped copy of the note key".
9. Try to edit: the button does not exist for recipients, and `PATCH /notes/:id` would return `403 NOT_NOTE_OWNER`.

**Revocation (back in Alice's window)**

10. Open the note → **Share** → **Revoke** next to Bob. Read the confirmation, which states what revocation can and cannot do.
11. Bob is still listed under "Revoked access" with `revokedAt` set.

**Bob is denied**

12. Refresh Bob's **Shared With Me**: the note is gone.
13. Navigate straight to `/notes/<id>` as Bob: the API returns `403 NOTE_ACCESS_DENIED` and the UI explains that access was withdrawn.
14. Bob's **Activity Log** now shows `ACCESS_DENIED` with `reason: REVOKED_SHARE`. Alice's shows `SHARE_REVOKE`.

**Optional: restore access**

15. Alice shares with Bob again. The API clears `revokedAt`, and the new audit entry has `restoredAfterRevocation: true`. The note reappears for Bob.

---

## Threat model

### Assets

| Asset | Where it lives | Protected by |
| --- | --- | --- |
| Note plaintext | Browser memory only | AES-GCM-256 with a per-note key |
| Note keys | Wrapped in the database, unwrapped in memory | AES-GCM-256 under the master key |
| Master key | Wrapped in the database, unwrapped in memory | PBKDF2-derived KEK |
| RSA private key | Wrapped in the database, unwrapped in memory | The master key |
| Password | In transit once; bcrypt hash at rest | TLS + bcrypt cost 12 |
| Session token | `localStorage` | JWT expiry, HTTPS |

### Adversaries considered

**1. A curious or compromised server operator.**
Can read the whole database: bcrypt hashes, wrapped keys, ciphertext, nonces and the full sharing graph. Cannot recover note plaintext, the master key, note keys or the private key, because unwrapping requires the password-derived KEK, which is never transmitted. Cannot search note content or learn titles.

**2. A database thief.**
Gains everything in (1) plus write access. Can delete or corrupt data and can mount offline brute-force against bcrypt hashes. Cannot decrypt notes. The strongest available attack is a **password-guessing** attack against a stolen bcrypt hash: success yields the password, and therefore the KEK and every note of that user. This is why the 210,000-iteration PBKDF2 step and the registration strength meter both push for strong, unique passwords.

**3. A malicious recipient.**
Can read exactly the notes shared with them, and can keep anything they have read. Revocation does not claw that back.

**4. A network attacker.**
Sees TLS-protected traffic containing ciphertext, wrapped keys and metadata. Cannot decrypt note content. Can observe sizes and timing (traffic analysis).

**5. An unauthenticated attacker.**
Faces bearer-token authentication on every protected route, per-route ownership and share checks in `lib/access.ts`, Zod validation on all input, security headers, a 300 req/min API ceiling and a 30-per-15-min credential limiter.

### Explicitly out of scope

- A compromised client device, malicious browser extension, keylogger or screen recorder.
- An attacker who knows the user's password **and** can reach their session.
- Rubber-hose cryptanalysis, or a user coerced into unlocking their vault.
- Traffic analysis and metadata correlation.
- Supply-chain compromise of the dependencies or the delivery path itself.

---

## Security limitations

Stated honestly, because an encrypted-notes app is only trustworthy if it is precise about its edges.

1. **Revocation is not cryptographic erasure.** See [Revocation model](#revocation-model). A recipient who decrypted or exported a note before revocation keeps that content, and the note key copy they hold would still open the current ciphertext.
2. **The note key is not rotated.** Because a share reuses the note key, an ex-recipient's wrapped key is still mathematically valid against the note's ciphertext. They are stopped by access control, not by cryptography. Key rotation on revoke is the documented next step.
3. **Password reset requires the recovery key.** The password derives the only key that can unlock the vault, so a forgotten password cannot be reset by the server. Instead, a one-time recovery key (shown once at registration, `RCVR-…`, regenerable from Settings → Recovery key) re-wraps the master key under a new password entirely in the browser. The server stores only a recovery-key-wrapped blob and a salted hash for verification - it still cannot decrypt anything. If BOTH the password and the recovery key are lost, the notes are unrecoverable by anyone; that is a property of correct end-to-end encryption, not a bug.
4. **Metadata is visible to the server.** User IDs, note IDs, timestamps, payload sizes, the nonce and the sharing graph (including revocation times) are all stored. Content is protected; the relationship graph is not.
5. **Sessions are bearer tokens in `localStorage`.** Any script running in the page origin can read the token. That grants API access until expiry (`12h` by default) but still not note plaintext, because keys live in memory and die with the tab. `httpOnly` cookies plus CSRF protection would be the hardening step; a token denylist would make logout server-enforced.
6. **Account enumeration.** Registration reveals whether an email is taken, and `/users/lookup` performs exact-match lookups, so any authenticated user can confirm whether an address is registered. The spec requires lookup-by-email sharing, which makes this inherent; rate limiting and generic responses would mitigate it.
7. **Revoked users get an explicit `403`.** This reveals that a note exists but is not accessible, rather than hiding existence behind a `404`. It was chosen for clarity in the demo and UI; returning `404` everywhere is the stricter alternative.
8. **`payloadBytes` leaks length.** Note size is visible, and very short bodies can be distinguished from long ones. Padding would mitigate this at a storage cost.
9. **Best-effort memory hygiene.** `wipe()` zero-fills byte arrays, but JavaScript's garbage collector and `CryptoKey` internals mean erasure cannot be guaranteed. Locking or closing the tab is the reliable action.
10. **No multi-device key sync, no rotation cadence and no key-verification UX.** There are no safety numbers or fingerprint comparison, so a malicious server could substitute a public key at share time (a classic MITM vector for this class of design). Out-of-band key verification is the standard mitigation.
11. **Client-side rate limiting is absent.** Protection against scripted abuse is server-side only.
12. **Local development runs over plain HTTP on `localhost`.** Deploy behind HTTPS, which `crypto.subtle` requires anyway on any non-localhost origin.

---

## Troubleshooting

**`window.crypto.subtle` is undefined.**
The page is not in a secure context. Use `http://localhost` or `https://`. A LAN IP over plain HTTP will not work, by browser design.

**Prisma errors on start, or `@prisma/client` complains it is not generated.**

```bash
npm run db:setup
```

**`Environment variable DATABASE_URL not found`.**
`server/.env` is missing. `cp server/.env.example server/.env`.

**The server refuses to start with `JWT_SECRET must be set ... when NODE_ENV=production`.**
That guard is intentional. Set a real `JWT_SECRET`.

**`PrismaClientInitializationError` / the database file is stale.**
Stop the server, run `npm run db:reset`, restart.

**Requests fail with a CORS error.**
`CLIENT_ORIGIN` in `server/.env` must match the client origin exactly, including the port. In development, leave `VITE_API_BASE_URL` empty so the Vite proxy is used and CORS never applies.

**After a page reload I am asked for my password again.**
Expected. Keys are never persisted; `/unlock` re-derives them. This is the core security property.

**A note shows "could not be decrypted".**
AES-GCM authentication failed: the ciphertext, nonce or key no longer match. Usually the row was edited directly in the database. The app hides such notes rather than displaying garbage.

**The root scripts cannot find `server` or `client`.**
Run them from `desktop/cipher`, not from the repository root. `npm --prefix server ...` resolves relative to the current directory.

---

## License

Built for an academic project by SYNCSQUAD. Use it, learn from it, and read the limitations section before trusting it with anything that matters.
