const inrFmt = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const numFmt = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 });
export const inr = (v: number | string | null | undefined) => inrFmt.format(Number(v ?? 0));
export const num = (v: number | string | null | undefined) => numFmt.format(Number(v ?? 0));
/** ₹1.2L / ₹3.4Cr for big figures. */
export const inrShort = (v: number) => {
  const a = Math.abs(v);
  if (a >= 1e7) return `₹${(v / 1e7).toFixed(2)}Cr`;
  if (a >= 1e5) return `₹${(v / 1e5).toFixed(2)}L`;
  if (a >= 1e3) return `₹${(v / 1e3).toFixed(1)}K`;
  return inr(v);
};
export const date = (d?: string | null) => (d ? new Date(d.length === 10 ? d + 'T00:00:00' : d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
export const dateShort = (d?: string | null) => (d ? new Date(d.length === 10 ? d + 'T00:00:00' : d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '—');
export const dateTime = (d?: string | null) => (d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
export const daysUntil = (d: string) => Math.ceil((new Date(d + 'T00:00:00').getTime() - new Date(new Date().toDateString()).getTime()) / 864e5);
export const initials = (name = '') => name.split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
export const roleLabel: Record<string, string> = { SUPER_ADMIN: 'Super Admin', COMPANY_ADMIN: 'Company Admin', PAYROLL_MANAGER: 'Payroll Manager', REPORTING_MANAGER: 'Manager', EMPLOYEE: 'Employee' };
export const today = () => new Date().toISOString().slice(0, 10);
