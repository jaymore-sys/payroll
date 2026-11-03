import { motion } from 'framer-motion';

const spring = { type: 'spring', stiffness: 260, damping: 16 } as const;

/** Full-screen Valencia Payroll intro while the session is restored: the wallet builds itself, the ₹ draws in, the coin pops. */
export default function Preloader() {
  return (
    <motion.div className="fixed inset-0 z-[100] grid place-items-center overflow-hidden bg-bg" exit={{ opacity: 0, scale: 1.04, filter: 'blur(6px)' }} transition={{ duration: 0.45 }}>
      <div className="pointer-events-none absolute -left-24 top-1/4 h-72 w-72 animate-blob rounded-full bg-violet-400/30 blur-3xl" />
      <div className="pointer-events-none absolute -right-20 bottom-1/4 h-72 w-72 animate-blob rounded-full bg-amber-300/25 blur-3xl [animation-delay:-5s]" />
      <div className="flex flex-col items-center">
        <div className="relative">
          {/* soft pulse behind the mark */}
          <motion.span className="absolute inset-4 rounded-[2rem] bg-violet-500/25" animate={{ scale: [1, 1.35], opacity: [0.6, 0] }} transition={{ repeat: Infinity, duration: 1.6, ease: 'easeOut', delay: 1 }} />
          <svg viewBox="0 0 300 300" className="relative h-28 w-28 overflow-visible" aria-label="Valencia Payroll">
            {/* flap drops in from above */}
            <motion.path d="M48 70 L200 26 a18 18 0 0 1 22 12 L232 70z" fill="#C4B5FD"
              initial={{ y: -60, opacity: 0, rotate: -12 }} animate={{ y: 0, opacity: 1, rotate: 0 }} transition={{ ...spring, delay: 0.35 }} style={{ originX: '140px', originY: '70px' }} />
            {/* wallet body springs up */}
            <motion.rect x="20" y="70" width="260" height="190" rx="36" fill="#7C3AED"
              initial={{ scale: 0.3, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={spring} style={{ originX: '150px', originY: '165px' }} />
            {/* card slides in from the right */}
            <motion.rect x="186" y="132" width="110" height="66" rx="22" fill="#5B21B6"
              initial={{ x: 90, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ ...spring, delay: 0.55 }} />
            {/* ₹ draws itself */}
            <g transform="translate(58,108) scale(0.68)" fill="none" stroke="#fff" strokeWidth="22" strokeLinecap="round" strokeLinejoin="round">
              {['M20 20 H140', 'M20 70 H140', 'M20 20 H62 C118 20 118 120 62 120 H28 L122 200'].map((d, i) => (
                <motion.path key={d} d={d} initial={{ pathLength: 0, opacity: 0 }} animate={{ pathLength: 1, opacity: 1 }} transition={{ duration: i === 2 ? 0.7 : 0.35, delay: 0.7 + i * 0.22, ease: 'easeInOut' }} />
              ))}
            </g>
            {/* gold coin pops last */}
            <motion.circle cx="222" cy="165" r="14" fill="#FDE68A"
              initial={{ scale: 0 }} animate={{ scale: [0, 1.6, 1] }} transition={{ duration: 0.5, delay: 1.45 }} style={{ originX: '222px', originY: '165px' }} />
          </svg>
        </div>
        <div className="mt-5 flex flex-col items-center text-3xl font-extrabold leading-[0.95] tracking-tight">
          <span className="flex overflow-hidden text-[#2E1065] dark:text-white">
            {'valencia'.split('').map((c, i) => (
              <motion.span key={i} initial={{ y: '110%' }} animate={{ y: 0 }} transition={{ ...spring, delay: 0.9 + i * 0.04 }}>{c}</motion.span>
            ))}
          </span>
          <motion.span className="text-[#7C3AED] dark:text-violet-300" initial={{ opacity: 0, letterSpacing: '0.4em' }} animate={{ opacity: 1, letterSpacing: '-0.01em' }} transition={{ duration: 0.6, delay: 1.25 }}>payroll</motion.span>
        </div>
        <div className="mt-6 flex gap-1.5">
          {[0, 1, 2].map((i) => (
            <motion.span key={i} className="h-2 w-2 rounded-full bg-violet-500" animate={{ y: [0, -8, 0], opacity: [0.4, 1, 0.4] }} transition={{ repeat: Infinity, duration: 0.9, delay: i * 0.15 }} />
          ))}
        </div>
      </div>
    </motion.div>
  );
}
