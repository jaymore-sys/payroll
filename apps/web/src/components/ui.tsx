import clsx from 'clsx';
import { AnimatePresence, animate, motion, useInView, type HTMLMotionProps } from 'framer-motion';
import { Loader2, X } from 'lucide-react';
import { forwardRef, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { pop, spring, stagger } from '../lib/motion';
import { initials } from '../lib/format';

/* ---------- Button ---------- */
type BtnProps = HTMLMotionProps<'button'> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'success'; size?: 'sm' | 'md' | 'lg'; loading?: boolean; icon?: ReactNode };
export const Button = forwardRef<HTMLButtonElement, BtnProps>(({ variant = 'primary', size = 'md', loading, icon, className, children, disabled, ...p }, ref) => (
  <motion.button
    ref={ref}
    whileHover={disabled || loading ? undefined : { y: -1 }}
    whileTap={disabled || loading ? undefined : { scale: 0.96 }}
    transition={spring}
    disabled={disabled || loading}
    className={clsx(
      'relative inline-flex select-none items-center justify-center gap-2 overflow-hidden rounded-xl font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-55',
      { sm: 'h-8 px-3 text-xs', md: 'h-10 px-4 text-sm', lg: 'h-12 px-6 text-base' }[size],
      {
        primary: 'gradient-brand text-white shadow-lift hover:brightness-110',
        secondary: 'border border-line bg-surface text-ink hover:border-brand/40 hover:bg-brand-soft',
        ghost: 'text-muted hover:bg-surface-2 hover:text-ink',
        danger: 'bg-bad text-white hover:brightness-110',
        success: 'bg-ok text-white hover:brightness-110',
      }[variant],
      className,
    )}
    {...p}
  >
    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
    {children as ReactNode}
  </motion.button>
));

/* ---------- Card ---------- */
export function Card({ className, children, hover = true, ...p }: HTMLMotionProps<'div'> & { hover?: boolean }) {
  return (
    <motion.div variants={pop} whileHover={hover ? { y: -3, transition: spring } : undefined} className={clsx('card p-5', className)} {...p}>
      {children}
    </motion.div>
  );
}
export const CardTitle = ({ children, action, sub }: { children: ReactNode; action?: ReactNode; sub?: ReactNode }) => (
  <div className="mb-4 flex items-start justify-between gap-3">
    <div><h3 className="text-sm font-bold text-ink">{children}</h3>{sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}</div>
    {action}
  </div>
);

/** Staggers children (use Card or motion items with `pop` variants inside). */
export const Stagger = ({ className, children, gap = 0.06 }: { className?: string; children: ReactNode; gap?: number }) => (
  <motion.div variants={stagger(gap)} initial="hidden" animate="show" className={className}>{children}</motion.div>
);
export const Item = ({ className, children, ...p }: HTMLMotionProps<'div'>) => <motion.div variants={pop} className={className} {...p}>{children}</motion.div>;

/* ---------- Badge ---------- */
const tones = {
  gray: 'bg-surface-2 text-muted', brand: 'bg-brand-soft text-brand-ink', green: 'bg-ok/12 text-ok', amber: 'bg-warn/15 text-warn', red: 'bg-bad/12 text-bad', blue: 'bg-info/12 text-info',
};
export type Tone = keyof typeof tones;
export const Badge = ({ tone = 'gray', children, dot, className }: { tone?: Tone; children: ReactNode; dot?: boolean; className?: string }) => (
  <span className={clsx('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-semibold', tones[tone], className)}>
    {dot && <span className="relative flex h-1.5 w-1.5"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-60" /><span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-current" /></span>}
    {children}
  </span>
);
export const statusTone: Record<string, Tone> = { ACTIVE: 'green', NOTICE: 'amber', EXITED: 'red', SETTLED: 'gray', DRAFT: 'gray', ONBOARDING: 'blue', PENDING: 'amber', APPROVED: 'green', REJECTED: 'red', CANCELLED: 'gray' };

/* ---------- Skeleton ---------- */
export const Skeleton = ({ className }: { className?: string }) => (
  <div className={clsx('relative overflow-hidden rounded-lg bg-surface-2', className)}>
    <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-white/40 to-transparent dark:via-white/5" />
  </div>
);
export const SkeletonCards = ({ n = 4, className = 'h-28' }: { n?: number; className?: string }) => (
  <>{Array.from({ length: n }).map((_, i) => <Skeleton key={i} className={className} />)}</>
);

/* ---------- Count-up number ---------- */
export function CountUp({ value, format = (v) => Math.round(v).toLocaleString('en-IN'), duration = 1.1 }: { value: number; format?: (v: number) => string; duration?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const prev = useRef(0);
  useEffect(() => {
    if (!inView || !ref.current) return;
    const ctl = animate(prev.current, value, { duration, ease: [0.22, 1, 0.36, 1], onUpdate: (v) => { if (ref.current) ref.current.textContent = format(v); } });
    prev.current = value;
    return () => ctl.stop();
  }, [value, inView, duration, format]);
  return <span ref={ref} className="tabular-nums">{format(0)}</span>;
}

/* ---------- Stat card ---------- */
export function Stat({ label, value, format, icon, tone = 'brand', hint }: { label: string; value: number; format?: (v: number) => string; icon: ReactNode; tone?: 'brand' | 'ok' | 'warn' | 'info' | 'bad'; hint?: ReactNode }) {
  const bg = { brand: 'from-indigo-500 to-violet-500', ok: 'from-emerald-500 to-teal-500', warn: 'from-amber-500 to-orange-500', info: 'from-sky-500 to-cyan-500', bad: 'from-rose-500 to-pink-500' }[tone];
  return (
    <Card className="group relative overflow-hidden">
      <div className={clsx('pointer-events-none absolute -right-8 -top-8 h-28 w-28 rounded-full bg-gradient-to-br opacity-10 blur-xl transition-all duration-500 group-hover:scale-150 group-hover:opacity-20', bg)} />
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</p>
          <p className="mt-2 truncate text-2xl font-extrabold text-ink sm:text-[28px]"><CountUp value={value} format={format} /></p>
          {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
        </div>
        <motion.div whileHover={{ rotate: -8, scale: 1.08 }} className={clsx('grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br text-white shadow-lg', bg)}>{icon}</motion.div>
      </div>
    </Card>
  );
}

/* ---------- Form fields ---------- */
export const Field = ({ label, error, hint, children, className }: { label: string; error?: string; hint?: string; children: ReactNode; className?: string }) => (
  <label className={clsx('block', className)}>
    <span className="label">{label}</span>
    {children}
    <AnimatePresence>
      {error ? <motion.span initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-1 block text-xs font-medium text-bad">{error}</motion.span>
        : hint ? <span className="mt-1 block text-xs text-muted">{hint}</span> : null}
    </AnimatePresence>
  </label>
);
export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...p }, ref) => <input ref={ref} className={clsx('input', className)} {...p} />);
export const Select = forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(({ className, children, ...p }, ref) => (
  <select ref={ref} className={clsx('input appearance-none bg-[length:16px] bg-[right_12px_center] bg-no-repeat pr-9', className)}
    style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")" }} {...p}>{children}</select>
));
export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className="inline-flex items-center gap-2.5 text-sm text-ink">
      <span className={clsx('relative h-6 w-11 rounded-full transition-colors duration-300', checked ? 'bg-brand' : 'bg-line')}>
        <motion.span layout transition={spring} className={clsx('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow', checked ? 'right-0.5' : 'left-0.5')} />
      </span>
      {label}
    </button>
  );
}

/* ---------- Modal & Drawer ---------- */
export function Modal({ open, onClose, title, children, wide, footer }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; wide?: boolean; footer?: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', k); document.body.style.overflow = ''; };
  }, [open, onClose]);
  const id = useId();
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.div className="absolute inset-0 bg-slate-950/50 backdrop-blur-sm" onClick={onClose} />
          <motion.div role="dialog" aria-modal="true" aria-labelledby={id}
            initial={{ opacity: 0, y: 60, scale: 0.94 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 40, scale: 0.96 }} transition={{ type: 'spring', stiffness: 320, damping: 28 }}
            className={clsx('relative flex max-h-[92dvh] w-full flex-col rounded-t-3xl border border-line bg-surface shadow-2xl sm:rounded-3xl', wide ? 'sm:max-w-3xl' : 'sm:max-w-lg')}>
            <div className="flex items-center justify-between border-b border-line px-5 py-4">
              <h2 id={id} className="text-base font-bold">{title}</h2>
              <motion.button whileHover={{ rotate: 90 }} transition={spring} onClick={onClose} className="rounded-lg p-1.5 text-muted hover:bg-surface-2" aria-label="Close"><X className="h-5 w-5" /></motion.button>
            </div>
            <div className="scrollbar-thin overflow-y-auto px-5 py-5">{children}</div>
            {footer && <div className="flex justify-end gap-2 border-t border-line px-5 py-3.5">{footer}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/* ---------- Tabs with sliding indicator ---------- */
export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string; icon?: ReactNode }[]; value: T; onChange: (v: T) => void }) {
  const layout = useId();
  return (
    <div className="scrollbar-thin -mx-1 flex gap-1 overflow-x-auto rounded-2xl bg-surface-2 p-1">
      {tabs.map((t) => (
        <button key={t.id} onClick={() => onChange(t.id)} className={clsx('relative flex shrink-0 items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-semibold transition-colors', value === t.id ? 'text-ink' : 'text-muted hover:text-ink')}>
          {value === t.id && <motion.span layoutId={layout} transition={spring} className="absolute inset-0 rounded-xl bg-surface shadow-card" />}
          <span className="relative flex items-center gap-2">{t.icon}{t.label}</span>
        </button>
      ))}
    </div>
  );
}

/* ---------- Misc ---------- */
export const PageHeader = ({ title, sub, actions }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode }) => (
  <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
    <div className="min-w-0"><h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">{title}</h1>{sub && <p className="mt-1 text-sm text-muted">{sub}</p>}</div>
    {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
  </motion.div>
);

export const EmptyState = ({ icon, title, sub, action }: { icon: ReactNode; title: string; sub?: string; action?: ReactNode }) => (
  <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="flex flex-col items-center px-6 py-12 text-center">
    <motion.div animate={{ y: [0, -6, 0] }} transition={{ repeat: Infinity, duration: 3, ease: 'easeInOut' }} className="mb-4 grid h-16 w-16 place-items-center rounded-2xl bg-brand-soft text-brand">{icon}</motion.div>
    <p className="font-bold">{title}</p>{sub && <p className="mt-1 max-w-sm text-sm text-muted">{sub}</p>}{action && <div className="mt-4">{action}</div>}
  </motion.div>
);

const avatarBg = ['from-indigo-500 to-violet-500', 'from-pink-500 to-rose-500', 'from-emerald-500 to-teal-500', 'from-amber-500 to-orange-500', 'from-sky-500 to-blue-500', 'from-fuchsia-500 to-purple-500'];
export const Avatar = ({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' | 'lg' }) => (
  <span className={clsx('grid shrink-0 place-items-center rounded-full bg-gradient-to-br font-bold text-white', avatarBg[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % avatarBg.length], { sm: 'h-8 w-8 text-[11px]', md: 'h-10 w-10 text-sm', lg: 'h-16 w-16 text-xl' }[size])}>{initials(name)}</span>
);

export function Ring({ value, max, size = 76, stroke = 8, color = 'rgb(var(--brand))', children }: { value: number; max: number; size?: number; stroke?: number; color?: string; children?: ReactNode }) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r, pct = max > 0 ? Math.min(Math.max(value / max, 0), 1) : 0;
  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="rgb(var(--surface-2))" strokeWidth={stroke} fill="none" />
        <motion.circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={stroke} fill="none" strokeLinecap="round" strokeDasharray={c}
          initial={{ strokeDashoffset: c }} animate={{ strokeDashoffset: c * (1 - pct) }} transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1], delay: 0.2 }} />
      </svg>
      <div className="absolute inset-0 grid place-items-center">{children}</div>
    </div>
  );
}

/** Table on desktop, stacked cards on phones. Rows animate in. */
export function DataTable<T>({ rows, cols, onRow, keyOf, empty }: {
  rows: T[]; keyOf: (r: T) => string; onRow?: (r: T) => void; empty?: ReactNode;
  cols: { h: string; cell: (r: T) => ReactNode; className?: string; hideOnMobile?: boolean }[];
}) {
  if (!rows.length) return <>{empty}</>;
  return (
    <>
      <div className="scrollbar-thin hidden overflow-x-auto md:block">
        <table className="w-full text-left text-sm">
          <thead><tr className="border-b border-line text-xs uppercase tracking-wide text-muted">{cols.map((c) => <th key={c.h} className={clsx('whitespace-nowrap px-4 py-3 font-semibold', c.className)}>{c.h}</th>)}</tr></thead>
          <motion.tbody variants={stagger(0.03)} initial="hidden" animate="show">
            {rows.map((r) => (
              <motion.tr key={keyOf(r)} variants={{ hidden: { opacity: 0, x: -10 }, show: { opacity: 1, x: 0 } }} onClick={() => onRow?.(r)}
                className={clsx('border-b border-line/60 transition-colors last:border-0', onRow && 'cursor-pointer hover:bg-brand-soft/60')}>
                {cols.map((c) => <td key={c.h} className={clsx('px-4 py-3', c.className)}>{c.cell(r)}</td>)}
              </motion.tr>
            ))}
          </motion.tbody>
        </table>
      </div>
      <motion.div variants={stagger(0.04)} initial="hidden" animate="show" className="space-y-2.5 md:hidden">
        {rows.map((r) => (
          <motion.div key={keyOf(r)} variants={pop} onClick={() => onRow?.(r)} whileTap={onRow ? { scale: 0.98 } : undefined} className="rounded-xl border border-line bg-surface p-3.5">
            {cols.filter((c) => !c.hideOnMobile).map((c, i) => (
              <div key={c.h} className={clsx('flex items-center justify-between gap-3 py-1 text-sm', i === 0 && 'pb-2')}>
                {i > 0 && <span className="text-xs text-muted">{c.h}</span>}<div className={clsx(i === 0 ? 'w-full' : 'text-right')}>{c.cell(r)}</div>
              </div>
            ))}
          </motion.div>
        ))}
      </motion.div>
    </>
  );
}

export function useDebounced<T>(v: T, ms = 350) {
  const [d, setD] = useState(v);
  useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]);
  return d;
}
