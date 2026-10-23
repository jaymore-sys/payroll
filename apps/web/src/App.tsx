import { AnimatePresence } from 'framer-motion';
import { lazy, Suspense, useEffect, type ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import Preloader from './components/Preloader';
import TopProgress from './components/TopProgress';
import { Skeleton } from './components/ui';
import AppLayout from './layouts/AppLayout';
import { useAuth, type Role } from './lib/auth';

const pages = {
  Dashboard: () => import('./pages/Dashboard'), Employees: () => import('./pages/Employees'), EmployeeDetail: () => import('./pages/EmployeeDetail'),
  Attendance: () => import('./pages/Attendance'), Approvals: () => import('./pages/Approvals'), TaxCalculator: () => import('./pages/TaxCalculator'),
  CtcBuilder: () => import('./pages/CtcBuilder'), Settings: () => import('./pages/Settings'),
  Users: () => import('./pages/Users'), Payroll: () => import('./pages/Payroll'), PayrollRun: () => import('./pages/PayrollRun'), Payslips: () => import('./pages/Payslips'), Consultants: () => import('./pages/Consultants'), PayslipPrint: () => import('./pages/PayslipPrint'), Audit: () => import('./pages/Audit'), Profile: () => import('./pages/Profile'), NotFound: () => import('./pages/NotFound'),
};
const Login = lazy(() => import('./pages/Login'));
const Dashboard = lazy(pages.Dashboard);
const Employees = lazy(pages.Employees);
const EmployeeDetail = lazy(pages.EmployeeDetail);
const Attendance = lazy(pages.Attendance);
const Approvals = lazy(pages.Approvals);
const TaxCalculator = lazy(pages.TaxCalculator);
const CtcBuilder = lazy(pages.CtcBuilder);
const Settings = lazy(pages.Settings);
const Users = lazy(pages.Users);
const Audit = lazy(pages.Audit);
const Profile = lazy(pages.Profile);
const NotFound = lazy(pages.NotFound);
const Payroll = lazy(pages.Payroll);
const PayrollRun = lazy(pages.PayrollRun);
const Payslips = lazy(pages.Payslips);
const PayslipPrint = lazy(pages.PayslipPrint);
const Consultants = lazy(pages.Consultants);

const PageSkeleton = () => (
  <div className="space-y-4">
    <Skeleton className="h-9 w-56" /><Skeleton className="h-4 w-80" />
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-28" />)}</div>
    <Skeleton className="h-72" />
  </div>
);

/** UI guard only — every API route enforces roles on the server too. */
const Guard = ({ roles, children }: { roles?: Role[]; children: ReactNode }) => {
  const { can } = useAuth();
  return roles && !can(...roles) ? <Navigate to="/" replace /> : <>{children}</>;
};

export default function App() {
  const { me, ready } = useAuth();
  const ADM: Role[] = ['COMPANY_ADMIN', 'PAYROLL_MANAGER'];
  // After sign-in, warm up every page in the background so menu clicks open instantly.
  useEffect(() => {
    if (!me) return;
    const t = setTimeout(() => Object.values(pages).forEach((load) => load().catch(() => {})), 1200);
    return () => clearTimeout(t);
  }, [me]);
  return (
    <>
      <TopProgress />
      <AnimatePresence>{!ready && <Preloader key="pre" />}</AnimatePresence>
      {ready && (
        <Suspense fallback={me ? <div className="p-6"><PageSkeleton /></div> : null}>
          {!me ? (
            <Routes><Route path="*" element={<Login />} /></Routes>
          ) : (
            <Routes>
              <Route path="login" element={<Navigate to="/" replace />} />
              <Route path="payslips/:id/print" element={<PayslipPrint />} />
              <Route element={<AppLayout />}>
                <Route index element={<Suspense fallback={<PageSkeleton />}><Dashboard /></Suspense>} />
                <Route path="employees" element={<Guard roles={[...ADM, 'REPORTING_MANAGER']}><Suspense fallback={<PageSkeleton />}><Employees /></Suspense></Guard>} />
                <Route path="employees/:id" element={<Suspense fallback={<PageSkeleton />}><EmployeeDetail /></Suspense>} />
                <Route path="payroll" element={<Guard roles={ADM}><Suspense fallback={<PageSkeleton />}><Payroll /></Suspense></Guard>} />
                <Route path="payroll/:id" element={<Guard roles={ADM}><Suspense fallback={<PageSkeleton />}><PayrollRun /></Suspense></Guard>} />
                <Route path="consultants" element={<Guard roles={ADM}><Suspense fallback={<PageSkeleton />}><Consultants /></Suspense></Guard>} />
                <Route path="payslips" element={<Suspense fallback={<PageSkeleton />}><Payslips /></Suspense>} />
                <Route path="attendance" element={<Guard roles={[...ADM, 'REPORTING_MANAGER']}><Suspense fallback={<PageSkeleton />}><Attendance /></Suspense></Guard>} />
                <Route path="approvals" element={<Guard roles={['COMPANY_ADMIN']}><Suspense fallback={<PageSkeleton />}><Approvals /></Suspense></Guard>} />
                <Route path="tax" element={<Suspense fallback={<PageSkeleton />}><TaxCalculator /></Suspense>} />
                <Route path="ctc" element={<Guard roles={ADM}><Suspense fallback={<PageSkeleton />}><CtcBuilder /></Suspense></Guard>} />
                <Route path="settings" element={<Guard roles={ADM}><Suspense fallback={<PageSkeleton />}><Settings /></Suspense></Guard>} />
                <Route path="users" element={<Guard roles={['COMPANY_ADMIN']}><Suspense fallback={<PageSkeleton />}><Users /></Suspense></Guard>} />
                <Route path="audit" element={<Guard roles={ADM}><Suspense fallback={<PageSkeleton />}><Audit /></Suspense></Guard>} />
                <Route path="profile" element={<Suspense fallback={<PageSkeleton />}><Profile /></Suspense>} />
                <Route path="*" element={<NotFound />} />
              </Route>
            </Routes>
          )}
        </Suspense>
      )}
    </>
  );
}
