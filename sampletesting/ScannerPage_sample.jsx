// src/pages/ScannerPage.jsx

import { Link } from 'react-router-dom';
import CameraScanner from '../components/CameraScanner';
import { motion } from 'framer-motion';

export default function ScannerPage() {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 1.05 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className="h-screen bg-emerald-50 dark:bg-black relative flex flex-col font-sans transition-colors duration-500"
    >
      {/* Minimal Top Bar */}
      <motion.div
        initial={{ y: -50, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.3, type: "spring", stiffness: 200, damping: 20 }}
        className="absolute top-0 left-0 right-0 z-50 p-6 flex justify-end"
      >
        <Link
          to="/dashboard"
        >
          <motion.div
            whileHover={{ scale: 1.05, backgroundColor: 'rgba(16,185,129,0.2)' }}
            whileTap={{ scale: 0.95 }}
            className="bg-white/60 dark:bg-white/10 backdrop-blur-xl text-emerald-950 dark:text-white px-5 py-2.5 rounded-full text-xs font-black tracking-widest border border-emerald-900/10 dark:border-white/20 shadow-lg flex items-center gap-2 uppercase group transition-colors duration-500 hover:dark:bg-white/20"
          >
            <span className="material-icons-round text-sm group-hover:rotate-90 transition-transform">close</span>
            Close
          </motion.div>
        </Link>
      </motion.div>

      {/* Full Screen Scanner */}
      <div className="flex-1 overflow-hidden relative rounded-b-[2.5rem] md:rounded-b-none">
        <CameraScanner />
      </div>
    </motion.div>
  );
}
