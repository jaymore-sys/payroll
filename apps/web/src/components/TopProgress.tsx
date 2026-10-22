import { useIsFetching, useIsMutating } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';

/** Thin animated bar at the top while any request is in flight. */
export default function TopProgress() {
  const busy = useIsFetching() + useIsMutating() > 0;
  return (
    <AnimatePresence>
      {busy && (
        <motion.div className="fixed inset-x-0 top-0 z-[60] h-0.5 overflow-hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { delay: 0.2 } }}>
          <motion.div className="gradient-brand h-full w-1/3" animate={{ x: ['-100%', '300%'] }} transition={{ repeat: Infinity, duration: 1.1, ease: 'easeInOut' }} />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
