/** Valencia Payroll logo mark: the ₹ wallet. */
export function BrandMark({ className = 'h-9 w-9' }: { className?: string }) {
  return (
    <svg viewBox="0 0 300 300" className={className} aria-hidden="true">
      <rect x="20" y="70" width="260" height="190" rx="36" fill="#7C3AED" />
      <path d="M48 70 L200 26 a18 18 0 0 1 22 12 L232 70z" fill="#C4B5FD" />
      <rect x="186" y="132" width="110" height="66" rx="22" fill="#5B21B6" />
      <circle cx="222" cy="165" r="14" fill="#FDE68A" />
      <g transform="translate(58,108) scale(0.68)" fill="none" stroke="#fff" strokeWidth="22" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 20 H140" /><path d="M20 70 H140" /><path d="M20 20 H62 C118 20 118 120 62 120 H28 L122 200" />
      </g>
    </svg>
  );
}

/** Mark + two-line "valencia / payroll" wordmark. */
export function BrandLogo({ collapsed, light, size = 'md' }: { collapsed?: boolean; light?: boolean; size?: 'md' | 'lg' }) {
  return (
    <div className="flex items-center gap-2.5">
      <BrandMark className={size === 'lg' ? 'h-12 w-12' : 'h-9 w-9'} />
      {!collapsed && (
        <span className={`flex flex-col font-extrabold leading-[0.95] tracking-tight ${size === 'lg' ? 'text-2xl' : 'text-lg'}`}>
          <span className={light ? 'text-white' : 'text-[#2E1065] dark:text-white'}>valencia</span>
          <span className={light ? 'text-violet-200' : 'text-[#7C3AED] dark:text-violet-300'}>payroll</span>
        </span>
      )}
    </div>
  );
}
