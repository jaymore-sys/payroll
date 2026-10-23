import { useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Banknote, Bell, Building2, Calculator, CalendarCheck2, CheckCheck, ChevronsLeft, ClipboardCheck, FileClock, LayoutDashboard, LogOut, Menu, Moon, ReceiptText, ShieldCheck, Sun, UserCircle2, Users, Wallet, X,
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { Avatar, Badge } from '../components/ui';
import { get, put } from '../lib/api';
import { useAuth, type Role } from '../lib/auth';
import { dateTime, roleLabel } from '../lib/format';
import { page, spring } from '../lib/motion';
import { useTheme } from '../lib/theme';

type Nav = { to: string; label: string; icon: ReactNode; roles?: Role[]; needsEmployee?: boolean; section: 'main' | 'admin' | 'me' };
const NAV: Nav[] = [
  { to: '/', label: 'Dashboard', icon: <LayoutDashboard className="h-[18px] w-[18px]" />, section: 'main' },
  { to: '/employees', label: 'People', icon: <Users className="h-[18px] w-[18px]" />, roles: ['COMPANY_ADMIN', 'PAYROLL_MANAGER', 'REPORTING_MANAGER'], section: 'main' },
  { to: '/payroll', label: 'Run payroll', icon: <Banknote className="h-[18px] w-[18px]" />, roles: ['COMPANY_ADMIN', 'PAYROLL_MANAGER'], section: 'main' },
  { to: '/attendance', label: 'Attendance', icon: <CalendarCheck2 className="h-[18px] w-[18px]" />, roles: ['COMPANY_ADMIN', 'PAYROLL_MANAGER', 'REPORTING_MANAGER'], section: 'main' },
  { to: '/payslips', label: 'My payslips', icon: <ReceiptText className="h-[18px] w-[18px]" />, needsEmployee: true, section: 'main' },
  { to: '/approvals', label: 'Profile requests', icon: <ClipboardCheck className="h-[18px] w-[18px]" />, roles: ['COMPANY_ADMIN'], section: 'admin' },
  { to: '/tax', label: 'Tax deductions', icon: <Calculator className="h-[18px] w-[18px]" />, section: 'main' },
  { to: '/ctc', label: 'CTC builder', icon: <Wallet className="h-[18px] w-[18px]" />, roles: ['COMPANY_ADMIN', 'PAYROLL_MANAGER'], section: 'main' },
  { to: '/settings', label: 'Company setup', icon: <Building2 className="h-[18px] w-[18px]" />, roles: ['COMPANY_ADMIN', 'PAYROLL_MANAGER'], section: 'admin' },
  { to: '/users', label: 'Users & roles', icon: <ShieldCheck className="h-[18px] w-[18px]" />, roles: ['COMPANY_ADMIN'], section: 'admin' },
  { to: '/audit', label: 'Audit log', icon: <FileClock className="h-[18px] w-[18px]" />, roles: ['COMPANY_ADMIN', 'PAYROLL_MANAGER'], section: 'admin' },
  { to: '/profile', label: 'My profile', icon: <UserCircle2 className="h-[18px] w-[18px]" />, section: 'me' },
];

function useCollapsed() {
  const [c, setC] = useState(() => { try { return localStorage.getItem('pp-sidebar') === '1'; } catch { return false; } });
  const set = (v: boolean) => { setC(v); try { localStorage.setItem('pp-sidebar', v ? '1' : '0'); } catch { /* ignore */ } };
  return [c, set] as const;
}

function SideNav({ collapsed, onNavigate, animatePill = true }: { collapsed: boolean; onNavigate?: () => void; animatePill?: boolean }) {
  const { me, can } = useAuth();
  const items = NAV.filter((n) => (!n.roles || can(...n.roles)) && (!n.needsEmployee || me?.employeeId));
  const section = (s: Nav['section'], title: string) => {
    const list = items.filter((i) => i.section === s);
    if (!list.length) return null;
    return (
      <div className="mb-4">
        {!collapsed && <p className="mb-1.5 px-3 text-[10px] font-bold uppercase tracking-[0.14em] text-muted/80">{title}</p>}
        <motion.ul initial="hidden" animate="show" variants={{ hidden: {}, show: { transition: { staggerChildren: 0.04 } } }} className="space-y-0.5">
          {list.map((n) => (
            <motion.li key={n.to} variants={{ hidden: { opacity: 0, x: -12 }, show: { opacity: 1, x: 0 } }}>
              <NavLink to={n.to} end={n.to === '/'} onClick={onNavigate} title={collapsed ? n.label : undefined}
                className={({ isActive }) => clsx('group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors', isActive ? 'text-brand-ink' : 'text-muted hover:text-ink', collapsed && 'justify-center')}>
                {({ isActive }) => (<>
                  {/* Sliding highlight on the desktop sidebar only. In the mobile drawer a layoutId element appearing while the
                      drawer exits (on navigation) blocks AnimatePresence from unmounting it, leaving an invisible overlay. */}
                  {isActive && (animatePill
                    ? <><motion.span layoutId="nav-pill" transition={spring} className="absolute inset-0 rounded-xl bg-brand-soft" /><motion.span layoutId="nav-bar" transition={spring} className="absolute -left-3 top-2 bottom-2 w-1 rounded-r-full bg-brand" /></>
                    : <><span className="absolute inset-0 rounded-xl bg-brand-soft" /><span className="absolute -left-3 top-2 bottom-2 w-1 rounded-r-full bg-brand" /></>)}
                  <span className="relative transition-transform duration-200 group-hover:scale-110">{n.icon}</span>
                  {!collapsed && <span className="relative truncate">{n.label}</span>}
                </>)}
              </NavLink>
            </motion.li>
          ))}
        </motion.ul>
      </div>
    );
  };
  return <nav className="scrollbar-thin flex-1 overflow-y-auto px-3">{section('main', 'Workspace')}{section('admin', 'Admin')}{section('me', 'You')}</nav>;
}

const Logo = ({ collapsed }: { collapsed?: boolean }) => (
  <div className={clsx('flex items-center gap-2.5', collapsed && 'justify-center')}>
    <motion.div whileHover={{ rotate: 12, scale: 1.05 }} className="gradient-brand grid h-9 w-9 place-items-center rounded-xl text-lg font-black text-white shadow-lift">₹</motion.div>
    {!collapsed && <span className="text-lg font-extrabold tracking-tight">Payroll<span className="text-gradient">Pro</span></span>}
  </div>
);

function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <motion.button whileTap={{ scale: 0.85 }} onClick={toggle} aria-label="Toggle dark mode" className="relative grid h-10 w-10 place-items-center overflow-hidden rounded-xl border border-line bg-surface text-muted hover:text-ink">
      <AnimatePresence mode="wait" initial={false}>
        <motion.span key={theme} initial={{ rotate: -90, y: 20, opacity: 0 }} animate={{ rotate: 0, y: 0, opacity: 1 }} exit={{ rotate: 90, y: -20, opacity: 0 }} transition={{ duration: 0.25 }}>
          {theme === 'dark' ? <Moon className="h-[18px] w-[18px]" /> : <Sun className="h-[18px] w-[18px]" />}
        </motion.span>
      </AnimatePresence>
    </motion.button>
  );
}

function useClickAway(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const f = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) close(); };
    document.addEventListener('mousedown', f);
    return () => document.removeEventListener('mousedown', f);
  }, [open, close]);
  return ref;
}

function Notifications() {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const { data = [] } = useQuery<any[]>({ queryKey: ['notifications'], queryFn: () => get('/notifications'), refetchInterval: 60_000 });
  const unread = data.filter((n) => !n.readAt).length;
  const ref = useClickAway(open, () => setOpen(false));
  return (
    <div ref={ref} className="relative">
      <motion.button whileTap={{ scale: 0.88 }} onClick={() => setOpen(!open)} aria-label="Notifications" className="relative grid h-10 w-10 place-items-center rounded-xl border border-line bg-surface text-muted hover:text-ink">
        <motion.span animate={unread ? { rotate: [0, -16, 14, -10, 6, 0] } : {}} transition={{ duration: 0.8, repeat: unread ? Infinity : 0, repeatDelay: 4 }}><Bell className="h-[18px] w-[18px]" /></motion.span>
        <AnimatePresence>{unread > 0 && <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-bad px-1 text-[10px] font-bold text-white">{unread}</motion.span>}</AnimatePresence>
      </motion.button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0, y: 8, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: 0.95 }} transition={spring}
            className="fixed inset-x-3 top-16 z-40 origin-top-right rounded-2xl border border-line bg-surface shadow-2xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-12 sm:w-96">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <p className="text-sm font-bold">Notifications</p>
              {unread > 0 && <button onClick={async () => { await put('/notifications/read-all'); qc.invalidateQueries({ queryKey: ['notifications'] }); }} className="flex items-center gap-1 text-xs font-semibold text-brand"><CheckCheck className="h-3.5 w-3.5" />Mark all read</button>}
            </div>
            <div className="scrollbar-thin max-h-96 overflow-y-auto p-2">
              {!data.length && <p className="px-3 py-8 text-center text-sm text-muted">You're all caught up ✨</p>}
              {data.map((n, i) => (
                <motion.div key={n.id} initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.03 }} className={clsx('rounded-xl px-3 py-2.5', !n.readAt && 'bg-brand-soft/60')}>
                  <p className="text-sm font-semibold">{n.title}</p>{n.body && <p className="text-xs text-muted">{n.body}</p>}<p className="mt-0.5 text-[11px] text-muted">{dateTime(n.createdAt)}</p>
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function UserMenu() {
  const { me, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useClickAway(open, () => setOpen(false));
  const name = me?.employee ? `${me.employee.firstName} ${me.employee.lastName}` : me?.email ?? '';
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(!open)} className="flex items-center gap-2.5 rounded-xl p-1 pr-2 hover:bg-surface-2">
        <Avatar name={name} size="sm" />
        <span className="hidden text-left lg:block"><span className="block max-w-[140px] truncate text-sm font-bold leading-tight">{name}</span><span className="block text-[11px] text-muted">{roleLabel[me?.roles[0] ?? 'EMPLOYEE']}</span></span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0, y: 8, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: 0.95 }} transition={spring}
            className="absolute right-0 top-12 z-40 w-64 origin-top-right rounded-2xl border border-line bg-surface p-2 shadow-2xl">
            <div className="px-3 py-2"><p className="truncate text-sm font-bold">{name}</p><p className="truncate text-xs text-muted">{me?.email}</p>
              <div className="mt-2 flex flex-wrap gap-1">{me?.roles.map((r) => <Badge key={r} tone="brand">{roleLabel[r]}</Badge>)}</div></div>
            <div className="my-1 h-px bg-line" />
            <NavLink to="/profile" onClick={() => setOpen(false)} className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm hover:bg-surface-2"><UserCircle2 className="h-4 w-4" />Profile & security</NavLink>
            <button onClick={() => logout()} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-bad hover:bg-bad/10"><LogOut className="h-4 w-4" />Sign out</button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function AppLayout() {
  const [collapsed, setCollapsed] = useCollapsed();
  const [mobile, setMobile] = useState(false);
  const { me } = useAuth();
  const loc = useLocation();
  useEffect(() => { setMobile(false); window.scrollTo({ top: 0 }); }, [loc.pathname]);

  return (
    <div className="min-h-dvh">
      {/* Desktop sidebar */}
      <motion.aside animate={{ width: collapsed ? 84 : 260 }} transition={spring} className="fixed inset-y-0 left-0 z-30 hidden flex-col border-r border-line bg-surface/80 backdrop-blur-xl lg:flex">
        <div className="flex h-16 items-center px-5"><Logo collapsed={collapsed} /></div>
        <div className="px-4 pb-3">{!collapsed && <div className="truncate rounded-xl bg-surface-2 px-3 py-2 text-xs font-semibold text-muted">{me?.company.name}</div>}</div>
        <SideNav collapsed={collapsed} />
        <button onClick={() => setCollapsed(!collapsed)} className="m-3 flex items-center justify-center gap-2 rounded-xl py-2 text-xs font-semibold text-muted hover:bg-surface-2 hover:text-ink">
          <motion.span animate={{ rotate: collapsed ? 180 : 0 }}><ChevronsLeft className="h-4 w-4" /></motion.span>{!collapsed && 'Collapse'}
        </button>
      </motion.aside>

      {/* Mobile drawer */}
      {/* Keyed direct children (not a Fragment) so AnimatePresence can finish their exit and unmount them. */}
      <AnimatePresence>
        {mobile && <motion.div key="backdrop" className="fixed inset-0 z-40 bg-slate-950/50 backdrop-blur-sm lg:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setMobile(false)} />}
        {mobile && (
          <motion.aside key="drawer" initial={{ x: '-100%' }} animate={{ x: 0 }} exit={{ x: '-100%' }} transition={{ type: 'spring', stiffness: 320, damping: 32 }}
            className="fixed inset-y-0 left-0 z-50 flex w-[82vw] max-w-[300px] flex-col bg-surface shadow-2xl lg:hidden">
            <div className="flex h-16 items-center justify-between px-5"><Logo /><button onClick={() => setMobile(false)} aria-label="Close menu" className="rounded-lg p-2 text-muted hover:bg-surface-2"><X className="h-5 w-5" /></button></div>
            <SideNav animatePill={false} collapsed={false} onNavigate={() => setMobile(false)} />
          </motion.aside>
        )}
      </AnimatePresence>

      <div className="transition-[padding] duration-300 ease-out lg:pl-[var(--sb)]" style={{ ['--sb' as string]: collapsed ? '84px' : '260px' }}>
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-line bg-bg/75 px-4 backdrop-blur-xl sm:px-6">
          <button onClick={() => setMobile(true)} aria-label="Open menu" className="grid h-10 w-10 place-items-center rounded-xl border border-line bg-surface lg:hidden"><Menu className="h-5 w-5" /></button>
          <div className="lg:hidden"><Logo collapsed /></div>
          <div className="flex-1" />
          <ThemeToggle /><Notifications /><UserMenu />
        </header>
        <main className="mx-auto w-full max-w-[1400px] px-4 pb-24 pt-6 sm:px-6 lg:pb-10">
          {/* Enter-only transition. An exit animation (AnimatePresence mode="wait") deadlocks with lazy-loaded routes:
              the new page suspends while the old one is exiting and the outlet stays blank. */}
          <motion.div key={loc.pathname} variants={page} initial="initial" animate="enter"><Outlet /></motion.div>
        </main>
      </div>

      {/* Mobile bottom bar */}
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden">
        <div className="grid grid-cols-4">
          {['/', '/payslips', '/tax', '/profile'].map((to) => NAV.find((x) => x.to === to)!).map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === '/'} className={({ isActive }) => clsx('relative flex flex-col items-center gap-0.5 py-2.5 text-[10px] font-semibold', isActive ? 'text-brand' : 'text-muted')}>
              {({ isActive }) => (<>{isActive && <motion.span layoutId="bottom-pill" className="absolute top-0 h-0.5 w-10 rounded-full bg-brand" />}<motion.span animate={{ scale: isActive ? 1.15 : 1 }}>{n.icon}</motion.span>{n.label.split(' ')[0]}</>)}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
