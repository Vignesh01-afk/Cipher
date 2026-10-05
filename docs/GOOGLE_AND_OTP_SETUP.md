# Google sign-in + Gmail OTP password reset — setup guide

Both features are wired end to end in the code. They need credentials from your Google account before they will actually send mail / authenticate. Until then the app still works: the OTP path logs codes to the server console, and the Google button reports that sign-in is not configured.

## 1. Environment variables (add to `server/.env`)

```bash
# --- Gmail SMTP (sends the OTP emails) --------------------------------------
# Create an App Password: Google Account -> Security -> 2-Step Verification
# -> App passwords (requires 2FA to be enabled on the account).
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=your.address@gmail.com
SMTP_PASS=abcd efgh ijkl mnop        # the 16-char app password (spaces ok)
MAIL_FROM=CipherNote <your.address@gmail.com>
# While false/absent and SMTP is unset, codes are printed to the server console.
OTP_DEBUG_LOG=true

# --- Email OTP tuning (defaults shown) --------------------------------------
OTP_LENGTH=8
OTP_TTL_MINUTES=10
OTP_MAX_ATTEMPTS=5
OTP_RESEND_COOLDOWN_SECONDS=60
OTP_MAX_PER_HOUR=4

# --- Master-key escrow (REQUIRED for OTP reset) -----------------------------
# Generate with: openssl rand -base64 32
# Treat like root credentials - rotating it invalidates every escrowed copy.
ESCROW_MASTER_KEY=

# --- Google OAuth (sign in with Google) --------------------------------------
# https://console.cloud.google.com/apis/credentials -> Create credentials ->
# OAuth client ID -> Web application.
GOOGLE_CLIENT_ID=xxxxxxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=xxxxxxxx
# Must exactly match one of the "Authorized redirect URIs" on the OAuth client.
GOOGLE_REDIRECT_URI=http://localhost:5173/auth/google/callback
```

## 2. Gmail App Password (for sending OTP mail)

1. Enable 2-Step Verification on the Google account: <https://myaccount.google.com/security>
2. Go to <https://myaccount.google.com/apppasswords> and create an app password (16 characters).
3. Put the account address in `SMTP_USER` and the app password in `SMTP_PASS`.

Gmail's SMTP relay limits you to roughly 500 recipients/day - plenty for OTP mail.

## 3. Google OAuth client (for "Sign in with Google")

1. <https://console.cloud.google.com/apis/credentials> → **Create credentials → OAuth client ID → Web application**.
2. **Authorized JavaScript origins**: `http://localhost:5173` (and your production origin).
3. **Authorized redirect URIs**: `http://localhost:5173/auth/google/callback` — must equal `GOOGLE_REDIRECT_URI` exactly.
4. Copy the client ID/secret into the env vars above. No scopes beyond `openid email profile` are requested.
5. While the OAuth consent screen is in "Testing" mode, only listed test users can sign in — add yours under **Audience → Test users**.

## 4. How the flows work (and why)

### Gmail OTP password reset (forgot-password page, "Email code" tab)

1. **Request code** — a one-time numeric code is emailed to the account address. Responses never reveal whether the address is registered; codes are stored only as SHA-256 hashes and can be used once within 10 minutes.
2. **Verify code** — on success the server returns a 10-minute, single-purpose reset token **and** the master key, unwrapped from escrow (AES-256-GCM under `ESCROW_MASTER_KEY`), over TLS to the verified browser.
3. **Reset** — the browser re-derives a new password KEK (PBKDF2, fresh salt), re-wraps the master key under it, and completes the reset. The private-key wrap and the escrow copy are untouched because the master key itself never changes.

Security trade-off you accepted: escrow means the server *could* decrypt your vault (it holds a wrapped copy of the master key under a server secret). That is what makes OTP-only reset possible; the recovery-key tab remains fully zero-knowledge.

### Sign in with Google (login page button)

1. The client asks the API for the consent URL + CSRF state and redirects the browser to Google.
2. Google redirects back to `/auth/google/callback?code=…&state=…`.
3. The client posts the code to the API, which exchanges it (server-side secret), validates the ID token against Google's tokeninfo endpoint, and links the local account by verified email (one-time) or matches `googleId`.
4. The API issues the normal session JWT. **The vault is still locked**: Google proves identity, but the browser needs the vault password once to derive the PBKDF2 key that decrypts notes. End-to-end encryption is unchanged.

Google sign-in links accounts by verified email. There are two paths:

- **Existing account** → linked automatically, then the usual `/unlock` screen asks for the vault password once.
- **No account yet** → the API returns a short-lived signup token (a signed JWT carrying the Google-verified email, 15-minute TTL) and the client shows a completion form at `/auth/google/signup`. The user picks a display name and vault password; keys are generated locally exactly like normal registration, then `POST /api/auth/google/register` creates the account with the Google ID already linked. Both paths appear on the register page too ("Sign up with Google").

## 5. Local test checklist

```bash
npm run dev          # server on :4000, client on :5173
```

- Register a new account → `masterKeyRaw` is escrow-wrapped server-side.
- Sign out → Forgot password → **Email code** tab → with SMTP unset, the code appears in the server console; with SMTP set, it lands in your Gmail.
- Enter code → choose new password → sign in with it.
- Login page → **Sign in with Google** → consent → you land on `/unlock` → enter the vault password → dashboard.
- Existing accounts: they have no escrow copy (registered before this feature), so the email-code path returns `ESCROW_MISSING` until they reset once via recovery key (which now also stores a fresh escrow copy) — after that the OTP path works for them too.
