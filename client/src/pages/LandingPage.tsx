import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Lock, CaretDown } from '@phosphor-icons/react';
import { useAuth } from '../context/AuthContext';
import { decryptBytes, encryptBytes, generateAesKey } from '../lib/crypto';

export function LandingPage(): React.ReactElement {
  const { status } = useAuth();

  return (
    <div className="flex min-h-screen flex-col">
      <header className="card-glass border-b border-white/10 px-4 py-4 sm:px-6">
        <div className="flex items-center justify-between">
          <Link to="/dashboard" className="flex items-center gap-3 group">
            <span className="flex h-10 w-10 items-center justify-center rounded-md     text-white ">
              <Lock className="h-5 w-5" />
            </span>
            <span className="text-xl font-bold tracking-tight text-stone-900 dark:text-white">
              <span className="brand-wordmark-cipher">Cipher</span>
              <span className="brand-wordmark-note">Note</span>
            </span>
          </Link>
          <div className="flex items-center gap-2">
            {status === 'unlocked' ? (
              <Link to="/dashboard" className="btn btn-secondary btn-sm">
                Go to app <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            ) : (
              <Link to="/login" className="btn btn-primary btn-sm">
                Sign in <CaretDown className="h-3.5 w-3.5" />
              </Link>
            )}
          </div>
        </div>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center px-4 py-12 sm:py-20">
        <div className="mx-auto max-w-4xl text-center">
          <div className="mb-6 flex justify-center">
            <span className="flex h-18 w-18 items-center justify-center rounded-md     text-white ">
              <Lock className="h-9 w-9" />
            </span>
          </div>

          <h1 className="text-4xl font-extrabold tracking-tight text-stone-900 dark:text-white sm:text-5xl lg:text-6xl">
            <span className="brand-gradient-text">CipherNote</span>
          </h1>

          <p className="mt-5 max-w-lg text-lg leading-8 text-stone-500 dark:text-stone-400">
            Your notes, your privacy. Encrypted end-to-end in your browser before anything is stored on the server.
            Share, revoke and manage access with a premium security workflow.
          </p>

          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link to="/register" className="btn btn-primary">
              Start for free <ArrowRight className="h-4 w-4" />
            </Link>
            <a href="#live-demo" className="btn btn-secondary">
              <Lock className="h-4 w-4" />
              See how it works
            </a>
          </div>

          <EncryptDemo />
        </div>
      </main>

      <footer className="border-t border-white/10 px-4 py-6 text-center text-xs text-stone-500 dark:border-white/[0.08] dark:text-stone-400">
        <div className="flex items-center justify-center gap-2">
          <Lock className="h-3.5 w-3.5" />
          <span>CipherNote · Encrypt. Share. Revoke.</span>
        </div>
        <p className="mt-2">Your privacy is your power.</p>
        <p className="mt-2 flex items-center justify-center gap-4">
          <Link to="/terms" className="link">Terms of Service</Link>
          <Link to="/privacy-policy" className="link">Privacy Policy</Link>
        </p>
      </footer>
    </div>
  );
}

/**
 * Live demo: encrypts with a throwaway AES-GCM-256 key generated in this
 * browser, using the exact helpers the app itself uses (lib/crypto.ts).
 */
function EncryptDemo(): React.ReactElement {
  const [plain, setPlain] = useState('This note never exists in plaintext on the server.');
  const [status, setStatus] = useState<'idle' | 'encrypted' | 'error'>('idle');
  const [iv, setIv] = useState('');
  const [ciphertext, setCiphertext] = useState('');
  const [roundTrip, setRoundTrip] = useState('');
  const keyRef = useRef<CryptoKey | null>(null);

  async function handleEncrypt(): Promise<void> {
    try {
      const { key } = await generateAesKey();
      keyRef.current = key;
      const sealed = await encryptBytes(key, new TextEncoder().encode(plain));
      setIv(sealed.iv);
      setCiphertext(sealed.ciphertext);
      setRoundTrip('');
      setStatus('encrypted');
    } catch {
      setStatus('error');
    }
  }

  async function handleDecrypt(): Promise<void> {
    if (!keyRef.current) return;
    try {
      const bytes = await decryptBytes(keyRef.current, ciphertext, iv);
      setRoundTrip(new TextDecoder().decode(bytes));
    } catch {
      setRoundTrip('Decryption failed - the ciphertext was tampered with or the key is wrong.');
    }
  }

  return (
    <section id="live-demo" className="mt-10 card p-5 text-left sm:p-6">
      <h2 className="text-lg font-bold text-ink">Try it now</h2>
      <p className="mt-1 text-sm leading-6 text-muted">
        Everything below runs in your browser with the same AES-GCM-256 helpers the app uses. The key is
        generated on this click and never leaves this tab, so the ciphertext is as opaque to a server as a
        real note.
      </p>

      <label className="label mt-4" htmlFor="demo-plain">
        Your text
      </label>
      <textarea
        id="demo-plain"
        className="textarea"
        rows={3}
        value={plain}
        onChange={(event) => setPlain(event.target.value)}
      />

      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="btn btn-primary" onClick={() => void handleEncrypt()}>
          Encrypt
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => void handleDecrypt()}
          disabled={status !== 'encrypted'}
        >
          Decrypt
        </button>
      </div>

      {status === 'encrypted' ? (
        <div className="mt-4 space-y-3">
          <div>
            <p className="label">AES-GCM ciphertext (base64)</p>
            <pre className="whitespace-pre-wrap break-all rounded border border-line bg-stone-100 p-3 font-mono text-xs text-ink dark:bg-stone-800">
              {`iv: ${iv}\nciphertext: ${ciphertext}`}
            </pre>
          </div>
          {roundTrip ? (
            <div>
              <p className="label">Decrypted in your browser</p>
              <p className="rounded border border-line bg-surface p-3 text-sm text-ink">{roundTrip}</p>
            </div>
          ) : null}
        </div>
      ) : null}

      {status === 'error' ? <p className="mt-2 field-error">Encryption failed in this browser.</p> : null}
    </section>
  );
}
