# Project memory for AI agents

## Deployment instruction (standing user preference)

- When the user says **"host it vercel"** (or similar), deploy the site to **Vercel**.
- Do NOT host to GitHub Pages, do NOT run it locally when they ask for hosting — Vercel only.
- Deployment config lives in `vercel.json` (Vite client in `client/`, API as a serverless function at `api/index.ts` backed by `server/dist`).

## Running and verifying locally

- `node scripts/dev-bg.mjs` starts the API (:4000) and the Vite client (:5173) detached from
  the shell, logging to `<tmpdir>/cipher-dev.log` (override with `CIPHER_DEV_LOG`).
- `node scripts/browser-test.mjs` drives the real UI with Playwright (register, notes, realtime
  chat, share, recovery-key reset, mobile) and writes screenshots to `.test-artifacts/`. The
  reset step reuses the `RCVR-` key captured at registration, so it needs no dev-log or SMTP
  dependency - only that the servers were started normally.
- The register form gates submission on the Terms/Privacy consent checkbox; UI tests must tick it.

## Auth screen layout (2026-09)

- Every auth surface uses `client/src/components/AuthShell.tsx`: split-screen aurora
  background, brand panel on the left, glass card (`card-glass`) on the right.
  Pass `width="lg"` for the longer forms (register, forgot password).
- Consumers: LoginPage, RegisterPage, ForgotPasswordPage, GoogleSignupPage,
  GoogleCallbackPage, RecoveryKeyHandoffPage, UnlockPage. Do not hand-roll the
  old centered `card` + `dark:bg-stone-950` layout on new auth pages.
- `scripts/auth-shots.mjs` verifies every auth route still renders the shell in
  both themes and drops screenshots in `client/ui-shots/` (needs the Vite dev server).

## Chat realtime behavior (2026-09)

- Socket.IO is the primary chat transport (server/src/socket.ts, client/src/lib/chatSocket.ts).
- The REST send path in `server/src/routes/chat.ts` also fans out `chat:message` + `chat:activity` via `getSocketServer()` so HTTP-only sends arrive live.
- `client/src/pages/ChatPage.tsx` polls `listMessages` every 4s while a conversation is open as a fallback, so messages appear without a manual refresh even when the socket is unavailable.
- Note: `api/index.ts` (Vercel serverless) cannot hold WebSocket connections; the polling fallback is what keeps chat live there.
