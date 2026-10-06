# Security policy

CipherNote is an end-to-end encrypted notes application. It is an academic
project, not a hardened commercial product: read the threat model and the
limitations sections of the [README](./README.md) before trusting it with
anything that matters.

## Reporting a vulnerability

Please **do not open a public issue** for a security problem.

- Email the maintainers (SYNCSQUAD) with a description, reproduction steps and
  the impact you believe it has.
- Include the affected commit/version and any proof-of-concept code.
- Give us a reasonable window to respond and ship a fix before disclosing
  publicly.

We will acknowledge a report, confirm or dispute the finding, and credit you in
the fix if you want.

## Supported versions

Only the `main` branch is supported. There are no maintained release branches;
fixes land on `main` and must be redeployed.

## Security model in one page

| Property | How it is achieved |
| --- | --- |
| Note/file confidentiality | AES-GCM-256 in the browser. The server stores ciphertext and wrapped keys only. |
| Key protection | Password → PBKDF2-SHA256 (210k iterations, 512-bit split) → KEK; the first half never leaves the browser, the second half (authKey) is bcrypt-hashed server-side. |
| Recipient access | Note keys wrapped with the recipient's RSA-OAEP-2048 public key; revoked shares are excluded at the authorization layer. |
| Account enumeration | `POST /auth/prelogin` returns deterministic pseudo-parameters for unknown emails, and login burns a bcrypt comparison on unknown accounts. |
| Credential stuffing | Per-IP and per-account rate limits on `/auth/login`, plus a global API ceiling. |
| Session revocation | `User.tokenVersion` is embedded in the JWT and re-checked on every request; logout and password/recovery resets bump it. |
| Recovery-key misuse | The raw recovery key never reaches the server (only an HKDF verifier), it is single-use, and regenerating one requires re-authentication. |
| File access | Uploads are owner-only, downloads re-check note access every request, blobs live in private storage, and Supabase downloads use short-lived signed URLs. |
| Input handling | Zod validation with tight limits on every body; rate limiting runs before body parsing. |
| Transport | HTTPS with HSTS, a strict Content-Security-Policy, and `nosniff`/frame-deny headers. |

## Out of scope

The following are **known and accepted** limitations, not vulnerabilities:

- A compromised client device, malicious browser extension, keylogger or
  screen recorder.
- OS-level screenshots and photographs of the screen. Privacy Mode is
  best-effort browser-level deterrence only.
- An attacker who already knows the password **and** holds the session.
- Traffic analysis and metadata correlation.
- Denial of service through sheer request volume (limits reduce, not remove,
  this).
- Loss of a user's password **and** recovery key: without either, the vault
  cannot be decrypted by design.

## Handling secrets

Never commit `server/.env`, the Supabase service-role key, `ESCROW_MASTER_KEY`,
`JWT_SECRET` or database credentials. Rotating `ESCROW_MASTER_KEY` invalidates
every escrowed recovery copy, so treat it like root credentials.
