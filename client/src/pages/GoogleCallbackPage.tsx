import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import { Spinner } from '../components/Spinner';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { Button } from '../components/Button';
import { isGoogleSignupRequired } from '../lib/types';

export function GoogleCallbackPage(): JSX.Element {
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
      <div className="relative flex min-h-screen overflow-hidden bg-stone-50 dark:bg-[#0B0F19]">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute -left-40 -top-40 h-[32rem] w-[32rem] rounded-full bg-brand/15 blur-3xl dark:bg-brand/20" />
          <div className="absolute -right-32 top-10 h-[26rem] w-[26rem] rounded-full bg-violet-400/15 blur-3xl dark:bg-violet-400/15" />
          <div className="absolute -bottom-32 left-1/3 h-[32rem] w-[32rem] rounded-full bg-pink-400/10 blur-3xl dark:bg-pink-400/10" />
        </div>
        <div className="relative z-10 mx-auto w-full max-w-xl px-5 py-10">
          {authCard(
            <div className="flex items-center justify-center gap-3">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 via-violet-500 to-pink-500 text-white shadow-[0_12px_30px_-10px_rgba(122,88,247,0.9)]">
                <ShieldCheck className="h-6 w-6" />
              </span>
              <span className="text-2xl font-bold tracking-tight text-stone-900 dark:text-white">
                <span className="brand-wordmark-cipher">Cipher</span>
                <span className="brand-wordmark-note">Note</span>
              </span>
            </div>
          )}
          <h1 className="mt-5 text-2xl font-bold tracking-tight text-stone-900 dark:text-white">Create your account</h1>
          <p className="mt-1 text-sm leading-6 text-stone-500 dark:text-stone-400">
            Google verified your identity — complete sign-up with your vault password.
          </p>
          <Button variant="primary" className="w-full" onClick={() => navigate('/register/google', { replace: true })}>
            Continue with Google
          </Button>
          <p className="mt-4 text-center text-xs leading-5 text-stone-400 dark:text-stone-500">
            {displayName ?? email ?? 'Google-verified identity'}
          </p>
        </div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="relative flex min-h-screen overflow-hidden bg-stone-50 dark:bg-[#0B0F19]">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute -left-40 -top-40 h-[32rem] w-[32rem] rounded-full bg-brand/15 blur-3xl dark:bg-brand/20" />
          <div className="absolute -right-32 top-10 h-[26rem] w-[26rem] rounded-full bg-violet-400/15 blur-3xl dark:bg-violet-400/15" />
          <div className="absolute -bottom-32 left-1/3 h-[32rem] w-[32rem] rounded-full bg-pink-400/10 blur-3xl dark:bg-pink-400/10" />
        </div>
        <div className="relative z-10 mx-auto w-full max-w-md px-5 py-16 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-500/10 text-rose-500">
            <ShieldCheck className="h-7 w-7" />
          </div>
          <h1 className="mt-5 text-2xl font-bold tracking-tight text-stone-900 dark:text-white">Something went wrong</h1>
          <p className="mt-2 text-sm leading-6 text-stone-500 dark:text-stone-400">No Google code was found in the URL. Please try again.</p>
          <Button variant="primary" className="mt-5" onClick={() => window.history.back()}>
            Go back
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-screen overflow-hidden bg-stone-50 dark:bg-[#0B0F19]">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-40 -top-40 h-[32rem] w-[32rem] rounded-full bg-brand/15 blur-3xl dark:bg-brand/20" />
        <div className="absolute -right-32 top-10 h-[26rem] w-[26rem] rounded-full bg-violet-400/15 blur-3xl dark:bg-violet-400/15" />
        <div className="absolute -bottom-32 left-1/3 h-[32rem] w-[32rem] rounded-full bg-pink-400/10 blur-3xl dark:bg-pink-400/10" />
        <svg className="absolute bottom-0 left-0 h-64 w-full opacity-[0.07] dark:opacity-[0.06]" viewBox="0 0 1440 320" preserveAspectRatio="none">
          <path fill="url(#auth-wave-1)" d="M0,224L60,213.3C120,203,240,181,360,181.3C480,181,600,203,720,213.3C840,224,960,224,1080,208C1200,192,1320,160,1380,144L1440,128L1440,320L0,320Z" />
        </svg>
        <defs>
          <linearGradient id="auth-wave-1" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#4A6CF7" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#D946EF" stopOpacity="0.25" />
          </linearGradient>
        </defs>
      </div>
      <div className="relative z-10 mx-auto w-full max-w-md px-5 py-16 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand/10 text-brand-600 dark:bg-brand/15 dark:text-brand-300">
          <Spinner className="h-7 w-7" />
        </div>
        <h1 className="mt-5 text-lg font-bold tracking-tight text-stone-900 dark:text-white">Google sign-in</h1>
        <p className="mt-1 text-sm leading-6 text-stone-500 dark:text-stone-400">
          Verifying your identity — this usually takes a moment.
        </p>
      </div>
    </div>
  );
}
