import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldCheck } from '@phosphor-icons/react';
import { Spinner } from '../components/Spinner';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { Button } from '../components/Button';
import { isGoogleSignupRequired } from '../lib/types';

export function GoogleCallbackPage(): React.ReactElement {
  const { adoptSession } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  const [status, setStatus] = useState<'signup' | 'login' | 'error'>('signup');
  const [code, setCode] = useState('');
  const [state, setState] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const codeParam = params.get('code');
    const stateParam = params.get('state');
    if (!codeParam) {
      setStatus('error');
      return;
    }
    setCode(codeParam);
    setState(stateParam ?? '');
  }, []);

  useEffect(() => {
    if (!code || !state) return;
    (async () => {
      setBusy(true);
      try {
        const { api } = await import('../lib/api');
        const result = await api.googleSignIn(code, state);
        if (isGoogleSignupRequired(result)) {
          sessionStorage.setItem('ciphernote.google.email', result.email);
          sessionStorage.setItem('ciphernote.google.displayName', result.displayName);
          sessionStorage.setItem('ciphernote.google.signupToken', result.signupToken);
          setStatus('signup');
        } else {
          adoptSession(result);
          toast.success('Signed in', 'Your vault is unlocked after Google sign-in.');
          navigate('/unlock', { replace: true });
        }
      } catch (err) {
        toast.error('Google sign-in failed', err instanceof Error ? err.message : 'Please try again.');
        setStatus('error');
      } finally {
        setBusy(false);
      }
    })();
  }, [code, state, adoptSession, navigate, toast]);

  const authCard = (children: React.ReactNode) => (
    <div className="card-glass p-8">{children}</div>
  );

  if (status === 'signup') {
    const email = sessionStorage.getItem('ciphernote.google.email');
    const displayName = sessionStorage.getItem('ciphernote.google.displayName');
    return (
      <div className="relative flex min-h-screen flex-col bg-surface">
        <div className="flex flex-1 flex-col">
          {authCard(
            <div className="flex items-center justify-center gap-3">
              <span className="flex h-12 w-12 items-center justify-center rounded-md bg-accent text-paper">
                <ShieldCheck className="h-6 w-6" />
              </span>
              <span className="text-2xl font-bold tracking-tight text-ink">
                <span className="brand-wordmark-cipher">Cipher</span>
                <span className="brand-wordmark-note">Note</span>
              </span>
            </div>
          )}
          <h1 className="mt-5 text-2xl font-bold tracking-tight text-ink">Create your account</h1>
          <p className="mt-1 text-sm leading-6 text-muted">
            Google verified your identity, complete sign-up with your vault password.
          </p>
          <Button variant="primary" className="w-full" onClick={() => navigate('/register/google', { replace: true })}>
            Continue with Google
          </Button>
          <p className="mt-4 text-center text-xs leading-5 text-muted">
            {displayName ?? email ?? 'Google-verified identity'}
          </p>
        </div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="relative flex min-h-screen flex-col bg-surface">
        <div className="flex flex-1 flex-col">
          <div className="mx-auto w-full max-w-md px-5 py-16 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-md bg-danger/10 text-danger">
              <ShieldCheck className="h-7 w-7" />
            </div>
            <h1 className="mt-5 text-2xl font-bold tracking-tight text-ink">Something went wrong</h1>
            <p className="mt-2 text-sm leading-6 text-muted">No Google code was found in the URL. Please try again.</p>
            <Button variant="primary" className="mt-5" onClick={() => window.history.back()}>
              Go back
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
      <div className="relative flex min-h-screen flex-col bg-surface">
        <div className="flex flex-1 flex-col">
          <div className="mx-auto w-full max-w-md px-5 py-16 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-md bg-accent/10 text-accent">
              <Spinner className="h-7 w-7" />
            </div>
            <h1 className="mt-5 text-lg font-bold tracking-tight text-ink">Google sign-in</h1>
            <p className="mt-1 text-sm leading-6 text-muted">
              Verifying your identity, this usually takes a moment.
            </p>
          </div>
        </div>
      </div>
  );
}
