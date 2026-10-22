import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { Button } from '../components/ui';

export default function NotFound() {
  return (
    <div className="grid min-h-[60vh] place-items-center text-center">
      <div>
        <motion.p initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring' }} className="text-gradient text-8xl font-black">404</motion.p>
        <p className="mt-2 text-muted">This page doesn't exist.</p>
        <Link to="/"><Button className="mt-6">Back to dashboard</Button></Link>
      </div>
    </div>
  );
}
