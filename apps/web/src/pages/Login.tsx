import { AnimatePresence, motion } from 'framer-motion';
import { ArrowRight, Eye, EyeOff, KeyRound, Lock, Mail, ShieldCheck, Sparkles } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button, Field, Input } from '../components/ui';
import { ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { pop, stagger } from '../lib/motion';

const features = ['PF, ESI, PT & LWF for every state', 'Both tax regimes with line-by-line worksheet', 'Leave ledger you can explain to the day', 'Encrypted PAN & bank data, full audit trail'];

export default function Login() {
  const { login, verifyOtp } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [challenge, setChallenge] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(0);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(''); setBusy(true);
    try {
      if (challenge) await verifyOtp(challenge, code);
      else { const r = await login(email, password); if (r.otpRequired) setChallenge(r.challenge!); }
    } catch (x) {
      setErr(x instanceof ApiError ? x.message : 'Could not reach the server');
      setShake((s) => s + 1);
    } finally { setBusy(false); }
  };

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      {/* Brand panel */}
      <div className="gradient-brand relative hidden overflow-hidden p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="absolute -left-20 -top-20 h-96 w-96 animate-blob rounded-full bg-white/10 blur-3xl" />
        <div className="absolute -bottom-24 right-0 h-96 w-96 animate-blob rounded-full bg-pink-300/20 blur-3xl [animation-delay:-6s]" />
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="relative flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-2xl bg-white/20 text-xl font-black backdrop-blur">₹</div>
          <span className="text-xl font-extrabold">PayrollPro</span>
        </motion.div>
        <motion.div variants={stagger(0.1, 0.2)} initial="hidden" animate="show" className="relative max-w-lg">
          <motion.p variants={pop} className="mb-3 inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold backdrop-blur"><Sparkles className="h-3.5 w-3.5" />Tax Year 2026-27 ready</motion.p>
          <motion.h1 variants={pop} className="text-4xl font-extrabold leading-tight xl:text-5xl">Payroll, tax & leave — done right, every month.</motion.h1>
          <motion.ul variants={stagger(0.08)} className="mt-8 space-y-3">
            {features.map((f) => (
              <motion.li key={f} variants={pop} className="flex items-center gap-3 text-white/90"><span className="grid h-6 w-6 place-items-center rounded-full bg-white/20"><ShieldCheck className="h-3.5 w-3.5" /></span>{f}</motion.li>
            ))}
          </motion.ul>
        </motion.div>
        <p className="relative text-xs text-white/60">Data stays in India · DPDP Act aligned</p>
      </div>

      {/* Form */}
      <div className="relative flex items-center justify-center p-5 sm:p-10">
        <div className="pointer-events-none absolute right-10 top-10 h-56 w-56 animate-blob rounded-full bg-brand/10 blur-3xl lg:hidden" />
        <motion.form key={shake} onSubmit={submit} animate={shake ? { x: [0, -10, 10, -6, 6, 0] } : {}} transition={{ duration: 0.4 }}
          className="relative w-full max-w-sm">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ type: 'spring', stiffness: 200, damping: 22 }}>
            <div className="mb-8 lg:hidden"><span className="text-2xl font-extrabold">Payroll<span className="text-gradient">Pro</span></span></div>
            <AnimatePresence mode="wait">
              {!challenge ? (
                <motion.div key="pw" initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -30 }} className="space-y-5">
                  <div><h2 className="text-3xl font-extrabold tracking-tight">Welcome back</h2><p className="mt-1.5 text-sm text-muted">Sign in to your workspace</p></div>
                  <Field label="Work email">
                    <div className="relative"><Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                      <Input type="email" autoComplete="username" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} className="pl-10" placeholder="you@company.com" /></div>
                  </Field>
                  <Field label="Password">
                    <div className="relative"><Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                      <Input type={show ? 'text' : 'password'} autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} className="px-10" placeholder="••••••••••" />
                      <button type="button" onClick={() => setShow(!show)} aria-label={show ? 'Hide password' : 'Show password'} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-ink">{show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button></div>
                  </Field>
                </motion.div>
              ) : (
                <motion.div key="otp" initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -30 }} className="space-y-5">
                  <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', delay: 0.1 }} className="grid h-14 w-14 place-items-center rounded-2xl bg-brand-soft text-brand"><KeyRound className="h-7 w-7" /></motion.div>
                  <div><h2 className="text-2xl font-extrabold">Two-step verification</h2><p className="mt-1 text-sm text-muted">Enter the 6-digit code from your authenticator app.</p></div>
                  <Input inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} className="text-center text-2xl tracking-[0.5em]" placeholder="000000" />
                  <button type="button" onClick={() => { setChallenge(null); setCode(''); }} className="text-xs font-semibold text-brand">← Use a different account</button>
                </motion.div>
              )}
            </AnimatePresence>
            <AnimatePresence>{err && <motion.p initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} role="alert" className="mt-4 rounded-xl bg-bad/10 px-3.5 py-2.5 text-sm font-medium text-bad">{err}</motion.p>}</AnimatePresence>
            <Button type="submit" size="lg" loading={busy} className="mt-6 w-full" icon={!busy && <ArrowRight className="h-4 w-4" />}>{challenge ? 'Verify' : 'Sign in'}</Button>
            <p className="mt-6 text-center text-xs text-muted">Protected by account lockout, encrypted sessions and audit logging.</p>
          </motion.div>
        </motion.form>
      </div>
    </div>
  );
}
