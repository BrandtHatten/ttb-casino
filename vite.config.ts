import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            'vendor-react': ['react', 'react-dom', 'react-router-dom'],
            'vendor-motion': ['framer-motion'],
            'vendor-socket': ['socket.io-client'],
            'game-crash': ['./src/components/CrashGame'],
            'game-plinko': ['./src/components/PlinkoGame'],
            'game-roulette': ['./src/components/RouletteGame'],
            'game-blackjack': ['./src/components/Blackjack'],
            'game-cases': ['./src/components/CaseOpening'],
            'game-admin': ['./src/components/AdminPanel'],
            'game-mines': ['./src/components/games/Mines/MinesGame'],
            'game-war': ['./src/components/games/War/WarGame'],
            'game-wheel': ['./src/components/games/Wheel/WheelGame'],
          },
        },
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
