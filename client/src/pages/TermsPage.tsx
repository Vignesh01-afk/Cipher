import { Link } from 'react-router-dom';

export function TermsPage(): React.ReactElement {
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
          <h1 className="text-2xl font-bold text-ink">Terms of Service</h1>
          <p className="mt-1 text-xs text-muted">Last updated: October 11, 2026</p>

          <div className="flow-text mt-6 space-y-5">
            <section>
              <h2 className="flow-title">1. What CipherNote is</h2>
              <p>
                CipherNote is an end-to-end encrypted notes app. You write notes in your browser, they are
                encrypted on your device, and only ciphertext is sent to the server. You are responsible for
                your password and your recovery key.
              </p>
            </section>

            <section>
              <h2 className="flow-title">2. Your account</h2>
              <p>
                You need an account to store encrypted notes. Keep your password and recovery key safe. If you
                lose both, no one - including us - can recover your notes. That is how end-to-end encryption
                works.
              </p>
            </section>

            <section>
              <h2 className="flow-title">3. Acceptable use</h2>
              <p>
                Do not use CipherNote to store or share content that is illegal, that harms others, or that
                violates the law. We may suspend accounts that abuse the service, such as by scripting
                attacks against the API.
              </p>
            </section>

            <section>
              <h2 className="flow-title">4. Your content stays yours</h2>
              <p>
                You own your notes. We claim no rights to their content because we cannot read it. We only
                store what your client encrypts.
              </p>
            </section>

            <section>
              <h2 className="flow-title">5. Service availability</h2>
              <p>
                The service is provided as-is. It may go down for maintenance. Because the app is
                client-side encrypted, keep your own backups of anything that matters.
              </p>
            </section>

            <section>
              <h2 className="flow-title">6. Changes to these terms</h2>
              <p>
                If these terms change materially, we will update this page and change the date above.
                Continued use after a change means you accept the new terms.
              </p>
            </section>

            <section>
              <h2 className="flow-title">7. Contact</h2>
              <p>
                Questions? Email <a href="mailto:vignesh2k08@gmail.com" className="link">vignesh2k08@gmail.com</a>.
              </p>
            </section>
          </div>

          <p className="mt-6 rounded border border-danger-300 bg-danger-50 p-3 text-xs text-danger-700 dark:border-danger-700 dark:bg-danger-900/40 dark:text-danger-300">
            Have a lawyer review this before launch. This page is plain-language draft copy, not legal advice.
          </p>
        </article>

        <p className="mt-6 text-center text-sm text-muted">
          <Link to="/privacy-policy" className="link">
            Privacy Policy
          </Link>
        </p>
      </main>
    </div>
  );
}
