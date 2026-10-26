import { KeyRound } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button, Card, CardTitle, Field, Input } from '../components/ui';
import { ApiError, post } from '../lib/api';
import { useAuth } from '../lib/auth';

/** Shown instead of the app while the account still has its default password. */
export default function SetPassword() {
  const { me, logout } = useAuth();
  const [pw, setPw] = useState({ current: '', next: '', again: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const ok = pw.next.length >= 10 && /[a-z]/.test(pw.next) && /[A-Z]/.test(pw.next) && /\d/.test(pw.next);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (pw.next !== pw.again) return setErr('The two new passwords do not match');
    setErr(''); setBusy(true);
    try {
      await post('/auth/change-password', { current: pw.current, next: pw.next });
      await logout('Password set — sign in with your new password');
    } catch (x) {
      setErr(x instanceof ApiError ? x.message : 'Could not reach the server');
    } finally { setBusy(false); }
  };
  const f = (k: keyof typeof pw, label: string, auto: string, hint?: string) => (
    <Field label={label} hint={hint}><Input type="password" autoComplete={auto} value={pw[k]} onChange={(e) => setPw({ ...pw, [k]: e.target.value })} /></Field>
  );

  return (
    <div className="grid min-h-dvh place-items-center p-4">
      <Card hover={false} className="w-full max-w-md">
        <CardTitle sub={me?.email}>Set your own password</CardTitle>
        <form onSubmit={submit} className="space-y-3">
          <p className="text-sm text-muted">You signed in with the default password. Choose your own before continuing.</p>
          {f('current', 'Current (default) password', 'current-password')}
          {f('next', 'New password', 'new-password', '10+ characters with upper, lower case and a number')}
          {f('again', 'New password again', 'new-password')}
          {err && <p className="text-sm font-medium text-bad">{err}</p>}
          <div className="flex items-center justify-between gap-3 pt-1">
            <button type="button" className="text-sm text-muted hover:underline" onClick={() => logout()}>Sign out</button>
            <Button type="submit" icon={<KeyRound className="h-4 w-4" />} loading={busy} disabled={!ok || !pw.current || !pw.again}>Save password</Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
