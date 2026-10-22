import { motion } from 'framer-motion';

/** Full-screen brand preloader shown while the session is restored. */
export default function Preloader() {
  return (
    <motion.div className="fixed inset-0 z-[100] grid place-items-center overflow-hidden bg-bg" exit={{ opacity: 0, scale: 1.04, filter: 'blur(6px)' }} transition={{ duration: 0.45 }}>
      <div className="pointer-events-none absolute -left-24 top-1/4 h-72 w-72 animate-blob rounded-full bg-indigo-400/30 blur-3xl" />
      <div className="pointer-events-none absolute -right-20 bottom-1/4 h-72 w-72 animate-blob rounded-full bg-pink-400/25 blur-3xl [animation-delay:-5s]" />
      <div className="flex flex-col items-center">
        <motion.div initial={{ scale: 0.4, rotate: -30, opacity: 0 }} animate={{ scale: 1, rotate: 0, opacity: 1 }} transition={{ type: 'spring', stiffness: 200, damping: 14 }}
          className="gradient-brand relative grid h-20 w-20 place-items-center rounded-3xl shadow-lift">
          <motion.span className="absolute inset-0 rounded-3xl border-2 border-white/40" animate={{ scale: [1, 1.35], opacity: [0.8, 0] }} transition={{ repeat: Infinity, duration: 1.4, ease: 'easeOut' }} />
          <svg viewBox="0 0 40 40" className="h-11 w-11" fill="none" stroke="white" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
            <motion.path d="M12 10h16M12 17h16M12 10c9 0 9 14 0 14l12 10" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1, ease: 'easeInOut', delay: 0.2 }} />
          </svg>
        </motion.div>
        <motion.p initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }} className="mt-6 text-2xl font-extrabold tracking-tight">
          Payroll<span className="text-gradient">Pro</span>
        </motion.p>
        <div className="mt-5 flex gap-1.5">
          {[0, 1, 2].map((i) => (
            <motion.span key={i} className="h-2 w-2 rounded-full bg-brand" animate={{ y: [0, -8, 0], opacity: [0.4, 1, 0.4] }} transition={{ repeat: Infinity, duration: 0.9, delay: i * 0.15 }} />
          ))}
        </div>
      </div>
    </motion.div>
  );
}
