import { Link } from 'react-router-dom';

export function PrivacyPolicyPage(): React.ReactElement {
  return (
    <div className="min-h-screen bg-page">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-5 py-4">
          <Link to="/" className="text-lg font-bold">
            <span className="brand-wordmark-cipher">Cipher</span>
            <span className="brand-wordmark-note">Note</span>
          </Link>
          <Link to="/register" className="btn btn-primary btn-sm">
            Create account
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-5 py-10">
        <article className="card p-6 sm:p-8">
          <h1 className="text-2xl font-bold text-ink">Privacy Policy</h1>
          <p className="mt-1 text-xs text-muted">Last updated: October 11, 2026</p>

          <div className="flow-text mt-6 space-y-5">
            <section>
              <h2 className="flow-title">The short version</h2>
              <p>
                Your notes are encrypted in your browser before they leave your device. We store ciphertext
                and account details. We never see your notes, your password or your private keys. We do not
                sell data.
              </p>
            </section>

            <section>
              <h2 className="flow-title">What we store</h2>
              <p>
                Your email address, your display name, encrypted note ciphertext, your public key (so other
                users can share notes with you), timestamps, and encrypted file blobs you attach.
              </p>
            </section>

            <section>
              <h2 className="flow-title">What we never store</h2>
              <p>
                Plaintext note content, your password, or your private keys. The server only ever receives
                ciphertext, and it has no way to decrypt it.
              </p>
            </section>

            <section>
              <h2 className="flow-title">Metadata</h2>
              <p>
                The server does see metadata: note IDs, timestamps, sizes, and who shared what with whom.
                Content is protected; the relationship graph is not.
              </p>
            </section>

            <section>
              <h2 className="flow-title">Account deletion</h2>
              <p>
                You can delete your account from Settings. Deletion removes your ciphertext, shares, files and
                account record. Anything you already exported stays with you.
              </p>
            </section>

            <section>
              <h2 className="flow-title">Selling data</h2>
              <p>
                We do not sell, rent or trade your data. There is no advertising SDK in this app.
              </p>
            </section>

            <section>
              <h2 className="flow-title">Contact</h2>
              <p>
                Questions? Email <a href="mailto:yourname@gmail.com" className="link">yourname@gmail.com</a>.
              </p>
            </section>
          </div>

          <p className="mt-6 rounded border border-danger-300 bg-danger-50 p-3 text-xs text-danger-700 dark:border-danger-700 dark:bg-danger-900/40 dark:text-danger-300">
            Have a lawyer review this before launch. This page is plain-language draft copy, not legal advice.
          </p>
        </article>

        <p className="mt-6 text-center text-sm text-muted">
          <Link to="/terms" className="link">
            Terms of Service
          </Link>
        </p>
      </main>
    </div>
  );
}
