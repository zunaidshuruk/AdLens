import { ShieldAlert } from 'lucide-react';
import React from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AdLensLogo } from '../components/AdLensLogo';
import { MfaSetup } from '../components/MfaSetup';
import { useAuth } from '../context/AuthContext';

const TEXT: Record<string, { title: string; body: string }> = {
  SSO_REQUIRED: { title: 'Use your company sign-in', body: 'Your organisation requires single sign-on. Sign out, type your work email on the sign-in page, and choose “Continue with” your company.' },
  SSO_DOMAIN_MISMATCH: { title: 'This sign-in is not set up for your email', body: 'The company sign-in you used is not linked to your email address. Ask your administrator, or sign in another way.' },
  MFA_REQUIRED: { title: 'Two-step verification is required', body: 'Your organisation requires two-step verification. Set it up below, then sign in again.' },
};

/** Explains why a sign-in was refused. Works without the AdLens API, because the API is exactly what refused it. */
export const SignInBlockedPage: React.FC = () => {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const reason = params.get('reason') ?? '';
  const t = TEXT[reason] ?? { title: 'Sign-in is blocked', body: 'Your organisation’s sign-in rules did not allow this sign-in.' };
  const again = async () => {
    await signOut().catch(() => undefined);
    navigate('/sign-in', { replace: true });
  };
  return (
    <div className="min-h-screen flex flex-col justify-center items-center px-4 py-10 bg-page text-fg">
      <div className="w-full max-w-md space-y-5 p-6 rounded-2xl border border-line bg-surface">
        <div className="flex flex-col items-center text-center space-y-2">
          <AdLensLogo className="w-10 h-10" />
          <h1 className="text-lg font-bold flex items-center gap-2"><ShieldAlert className="w-5 h-5" /> {t.title}</h1>
          <p className="text-sm text-fg-muted">{t.body}</p>
        </div>
        {reason === 'MFA_REQUIRED' && user && <MfaSetup />}
        <button type="button" onClick={() => void again()} className="w-full py-2.5 rounded-xl text-sm font-semibold text-on-accent bg-accent">{reason === 'MFA_REQUIRED' ? 'I have set it up: sign in again' : 'Sign out and go to sign-in'}</button>
      </div>
    </div>
  );
};
