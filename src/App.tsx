import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { io, Socket } from 'socket.io-client';
import { 
  Heart, 
  Square, 
  Pentagon, 
  RectangleHorizontal, 
  Apple, 
  Circle, 
  Citrus, 
  Grape, 
  Banana, 
  Candy, 
  Bomb,
  Play,
  RotateCcw,
  Coins,
  Settings,
  Info,
  Volume2,
  VolumeX,
  History as HistoryIcon,
  TrendingUp,
  Gamepad2,
  Trophy,
  Gift,
  Headphones,
  X,
  ChevronRight,
  Star,
  Zap,
  MessageSquare,
  Activity,
  User,
  Users,
  Clock,
  TrendingDown,
  Crown,
  Medal,
  ChevronDown,
  LogOut,
  Shield,
  Megaphone,
  ArrowLeft,
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { cn } from './lib/utils';
import { SymbolType, GameSymbol, SYMBOLS, GRID_ROWS, GRID_COLS, WinResult, GridPosition, UserAchievement } from './types';
import { Symbol } from './components/Symbol';
import { generateSymbol, generateInitialGrid, generateId } from './services/gameService';
import { getRank, getVIPBadge } from './lib/ranks';
import { ACHIEVEMENTS, Achievement } from './lib/achievements';
import { lazy, Suspense } from 'react';

const ProfilePage = lazy(() => import('./components/ProfilePage').then(m => ({ default: m.ProfilePage })));
const PublicProfilePage = lazy(() => import('./components/PublicProfilePage').then(m => ({ default: m.PublicProfilePage })));
const SettingsPage = lazy(() => import('./components/SettingsPage').then(m => ({ default: m.SettingsPage })));
const AdminPanel = lazy(() => import('./components/AdminPanel').then(m => ({ default: m.AdminPanel })));
const CrashGame = lazy(() => import('./components/CrashGame').then(m => ({ default: m.CrashGame })));
const PlinkoGame = lazy(() => import('./components/PlinkoGame').then(m => ({ default: m.PlinkoGame })));
const CaseOpening = lazy(() => import('./components/CaseOpening').then(m => ({ default: m.CaseOpening })));
const Blackjack = lazy(() => import('./components/Blackjack'));
const RouletteGame = lazy(() => import('./components/RouletteGame'));

const SYMBOL_ICONS: Record<SymbolType, any> = {
  HEART: Heart,
  SQUARE: Square,
  PENTAGON: Pentagon,
  RECTANGLE: RectangleHorizontal,
  APPLE: Apple,
  PLUM: Circle,
  WATERMELON: Citrus,
  GRAPE: Grape,
  BANANA: Banana,
  SCATTER: Candy,
  MULTIPLIER: Bomb,
};

export default function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const pathToView: Record<string, 'home' | 'game' | 'crash' | 'plinko' | 'cases' | 'blackjack' | 'roulette' | 'profile' | 'settings' | 'admin'> = {
    '/': 'home',
    '/slots': 'game',
    '/crash': 'crash',
    '/plinko': 'plinko',
    '/cases': 'cases',
    '/blackjack': 'blackjack',
    '/roulette': 'roulette',
    '/profile': 'profile',
    '/settings': 'settings',
    '/admin': 'admin',
  };
  const viewToPath: Record<string, string> = {
    home: '/', game: '/slots', crash: '/crash', plinko: '/plinko',
    cases: '/cases', blackjack: '/blackjack', roulette: '/roulette',
    profile: '/profile', settings: '/settings', admin: '/admin',
  };
  const publicProfileMatch = location.pathname.match(/^\/profile\/(.+)$/);
  const view = publicProfileMatch ? 'public_profile' : (pathToView[location.pathname] ?? 'home');
  const viewedUsername = publicProfileMatch ? decodeURIComponent(publicProfileMatch[1]) : null;
  const setView = (v: string) => navigate(viewToPath[v] ?? '/');
  const viewProfile = (username: string) => navigate(`/profile/${encodeURIComponent(username)}`);
  const [authView, setAuthView] = useState<'login' | 'register' | 'authenticated'>('login');
  const [token, setToken] = useState<string | null>(localStorage.getItem('casino_token'));
  const [isProfileDropdownOpen, setIsProfileDropdownOpen] = useState(false);
  const [isMobileChatOpen, setIsMobileChatOpen] = useState(false);
  const isMobileChatOpenRef = useRef(false);
  const serverVersionRef = useRef<string | null>(null);
  const [hasUnreadMessages, setHasUnreadMessages] = useState(false);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');

  // Real-time State
  const [socket, setSocket] = useState<Socket | null>(null);
  const [userStats, setUserStats] = useState<any>(null);
  const [jackpot, setJackpot] = useState(2000.0);
  const [jackpotWinner, setJackpotWinner] = useState<{ username: string; amount: number } | null>(null);
  const [chatMessages, setChatMessages] = useState<any[]>([]);
  const [recentActivity, setRecentActivity] = useState<any[]>([]);
  const [leaderboards, setLeaderboards] = useState<any>(null);
  const [onlineUsers, setOnlineUsers] = useState<string[]>([]);
  const [userAchievements, setUserAchievements] = useState<UserAchievement[]>([]);
  const [unlockedAchievement, setUnlockedAchievement] = useState<Achievement | null>(null);
  const [chatInput, setChatInput] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);

  const [grid, setGrid] = useState<GameSymbol[][]>(generateInitialGrid());
  const [balance, setBalance] = useState(0);
  const profileDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent | TouchEvent) => {
      if (profileDropdownRef.current && !profileDropdownRef.current.contains(event.target as Node)) {
        setIsProfileDropdownOpen(false);
      }
    };

    if (isProfileDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('touchstart', handleClickOutside);
    } else {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [isProfileDropdownOpen]);

  const handleLogin = async () => {
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();
      if (data.token) {
        setToken(data.token);
        localStorage.setItem('casino_token', data.token);
        setAuthView('authenticated');
        setAuthError('');
      } else {
        setAuthError(data.error);
      }
    } catch (err) {
      setAuthError('Server error');
    }
  };

  const handleRegister = async () => {
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();
      if (res.ok) {
        setAuthView('login');
        setAuthError('');
      } else {
        setAuthError(data.error);
      }
    } catch (err) {
      setAuthError('Server error');
    }
  };

  const handleLogout = () => {
    setToken(null);
    localStorage.removeItem('casino_token');
    setAuthView('login');
    if (socket) socket.disconnect();
  };

  useEffect(() => {
    if (!token) return;

    const newSocket = io({
      auth: { token }
    });
    setSocket(newSocket);

    newSocket.on('connect', () => {
      console.log('Connected to server');
    });

    newSocket.on('server:version', (version: string) => {
      if (serverVersionRef.current === null) {
        serverVersionRef.current = version;
      } else if (serverVersionRef.current !== version) {
        window.location.reload();
      }
    });

    newSocket.on('user_data', (data) => {
      setUserStats(data);
      setBalance(Math.round(data.credits * 100) / 100);
    });

    newSocket.on('jackpot:update', (amount) => setJackpot(amount));
    newSocket.on('chat:history', (messages) => setChatMessages(messages));
    newSocket.on('chat:new', (msg) => {
      setChatMessages(prev => [...prev.slice(-49), msg]);
      if (!isMobileChatOpenRef.current) {
        setHasUnreadMessages(true);
      }
    });
    newSocket.on('chat:online', (users) => setOnlineUsers(users));
    newSocket.on('activity:history', (activities) => setRecentActivity(activities.filter((a: any) => a.type === 'win' || a.type === 'jackpot')));
    newSocket.on('activity:new', (activity) => { if (activity.type === 'win' || activity.type === 'jackpot') setRecentActivity(prev => [activity, ...prev.slice(0, 19)]); });
    newSocket.on('leaderboards_update', (data) => setLeaderboards(data));
    newSocket.on('user_achievements', (data) => setUserAchievements(data));
    newSocket.on('achievement_unlocked', (achievement) => {
      setUnlockedAchievement(achievement);
      setTimeout(() => setUnlockedAchievement(null), 5000);
    });
    newSocket.on('jackpot:winner', ({ username, amount }) => {
      setJackpotWinner({ username, amount });
      setTimeout(() => setJackpotWinner(null), 8000);
      confetti({
        particleCount: 200,
        spread: 90,
        origin: { y: 0.6 },
        colors: ['#F59E0B', '#FFFFFF', '#FFD700']
      });
    });

    newSocket.on('session:kicked', () => {
      handleLogout();
      alert('Logged in from another location');
    });

    newSocket.on('error', (msg) => alert(msg));

    newSocket.on('broadcast', (data) => {
      setBroadcast(data);
      setTimeout(() => setBroadcast(null), 10000);
    });

    newSocket.on('site_reset', () => {
      window.location.reload();
    });

    return () => {
      newSocket.disconnect();
    };
  }, [token]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  const sendChatMessage = () => {
    if (!chatInput.trim() || !socket) return;
    socket.emit('chat:message', chatInput);
    setChatInput('');
  };
  const [bet, setBet] = useState(5);
  const [isSpinning, setIsSpinning] = useState(false);
  const [winAmount, setWinAmount] = useState(0);
  const [spinWin, setSpinWin] = useState(0);
  const [totalScatterWin, setTotalScatterWin] = useState(0);
  const [winningPositions, setWinningPositions] = useState<GridPosition[]>([]);
  const [freeSpins, setFreeSpins] = useState(0);
  const [isFreeSpinMode, setIsFreeSpinMode] = useState(false);
  const [currentMultiplier, setCurrentMultiplier] = useState(1);
  const [pendingWins, setPendingWins] = useState<WinResult[]>([]);
  const [tumbleTotalWin, setTumbleTotalWin] = useState(0);
  const [totalScattersOnGrid, setTotalScattersOnGrid] = useState(0);
  const [totalFreeSpinWin, setTotalFreeSpinWin] = useState(0);
  const [showFreeSpinSummary, setShowFreeSpinSummary] = useState(false);
  const [lastSpinTotal, setLastSpinTotal] = useState(0);
  const [showLastSpinTotal, setShowLastSpinTotal] = useState(false);
  const [sessionNet, setSessionNet] = useState(0);
  const [isMultiplying, setIsMultiplying] = useState(false);
  const [showInsufficientCredits, setShowInsufficientCredits] = useState(false);
  const [isBetError, setIsBetError] = useState(false);
  const [leaderboardTab, setLeaderboardTab] = useState<'allTime' | 'thisWeek'>('allTime');
  const dailyClaimed = userStats ? userStats.daily_reward_date === new Date().toISOString().split('T')[0] : false;
  const weeklyClaimed = userStats?.weekly_reward_date
    ? new Date(userStats.weekly_reward_date) > new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    : false;

  const claimDaily = async () => {
    if (dailyClaimed || !token) return;
    try {
      await fetch('/api/auth/claim-daily', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }
      });
    } catch (err) {
      console.error(err);
    }
  };

  const claimWeekly = async () => {
    if (weeklyClaimed || !token) return;
    try {
      await fetch('/api/stats/claim-weekly', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }
      });
    } catch (err) {
      console.error(err);
    }
  };

  const handleGift = async (targetUsername: string, amount: number) => {
    if (!token) return;
    try {
      const res = await fetch('/api/user/gift', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ targetUsername, amount })
      });
      const data = await res.json();
      if (res.ok) {
        alert('Gift sent successfully!');
      } else {
        alert(data.error);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleUpdateUsername = async (newUsername: string, password: string) => {
    if (!token) return;
    try {
      const res = await fetch('/api/user/update-username', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ newUsername, password })
      });
      const data = await res.json();
      if (res.ok) {
        alert('Username updated successfully!');
      } else {
        alert(data.error);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleUpdatePassword = async (currentPassword: string, newPassword: string) => {
    if (!token) return;
    try {
      const res = await fetch('/api/user/update-password', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ currentPassword, newPassword })
      });
      const data = await res.json();
      if (res.ok) {
        alert('Password updated successfully!');
      } else {
        alert(data.error);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const claimInterest = async () => {
    if (!token) return;
    try {
      const res = await fetch('/api/user/claim-interest', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      });
      const data = await res.json();
      if (res.ok) {
        alert(data.message);
      } else {
        alert(data.error);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const [showJackpotModal, setShowJackpotModal] = useState(false);
  const [broadcast, setBroadcast] = useState<{ message: string, type: string } | null>(null);
  const [isAutoSpinning, setIsAutoSpinning] = useState(false);
  const [isTurbo, setIsTurbo] = useState(false);
  const [showBuyConfirm, setShowBuyConfirm] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [history, setHistory] = useState<{ id: string, amount: number, type: 'normal' | 'free' }[]>([]);

  const spinRef = useRef(false);

  const checkWins = useCallback((currentGrid: GameSymbol[][]) => {
    const counts: Record<string, GridPosition[]> = {};
    let multipliers: number[] = [];
    
    currentGrid.forEach((row, rIdx) => {
      row.forEach((symbol, cIdx) => {
        if (symbol.type === 'MULTIPLIER') {
           multipliers.push(symbol.multiplier || 2);
           return;
        }
        if (!counts[symbol.type]) counts[symbol.type] = [];
        counts[symbol.type].push({ row: rIdx, col: cIdx });
      });
    });

    const wins: WinResult[] = [];
    let scatterCount = 0;
    let scatterPositions: GridPosition[] = [];

    Object.entries(counts).forEach(([type, positions]) => {
      const symbolType = type as SymbolType;
      if (symbolType === 'SCATTER') {
        scatterCount = positions.length;
        scatterPositions = positions;
        if (scatterCount >= 4 || (isFreeSpinMode && scatterCount >= 3)) {
          let scatterPayout = 0;
          if (scatterCount === 4) scatterPayout = 3 * bet;
          else if (scatterCount === 5) scatterPayout = 5 * bet;
          else if (scatterCount >= 6) scatterPayout = 100 * bet;
          
          wins.push({
            symbolType: 'SCATTER',
            count: scatterCount,
            payout: scatterPayout,
            positions: scatterPositions
          });
        }
        return;
      }

      if (positions.length >= 8) {
        const baseValue = SYMBOLS[symbolType].value;
        let multiplier = 1;
        if (positions.length >= 12) multiplier = 10;
        else if (positions.length >= 10) multiplier = 4;
        else multiplier = 1;

        wins.push({
          symbolType,
          count: positions.length,
          payout: baseValue * multiplier * bet,
          positions
        });
      }
    });

    return { wins, scatterCount, scatterPositions, multipliers };
  }, [bet, isFreeSpinMode]);

  const handleTumble = useCallback(async (currentGrid: GameSymbol[][], currentTumbleTotal: number = 0, freeSpinsTriggered: boolean = false) => {
    const { wins, scatterCount, scatterPositions, multipliers } = checkWins(currentGrid);
    setTotalScattersOnGrid(scatterCount);
    
    // Show current potential multiplier
    if (multipliers.length > 0) {
      setCurrentMultiplier(multipliers.reduce((a, b) => a + b, 0));
    }
    
    if (wins.length === 0) {
      // End of tumble sequence
      if (currentTumbleTotal > 0) {
        let finalWin = currentTumbleTotal;
        if (multipliers.length > 0) {
          const totalMult = multipliers.reduce((a, b) => a + b, 0);
          finalWin *= totalMult;
          setCurrentMultiplier(totalMult);
          
          // Visual feedback for multiplier application
          setIsMultiplying(true);
          setWinAmount(finalWin);
          setTimeout(() => setIsMultiplying(false), 1000);
        }
        
        console.log(`Tumble sequence ended. Adding ${finalWin} to balance.`);
        setSpinWin(prev => prev + finalWin);
        setBalance(prev => Math.round((prev + finalWin) * 100) / 100);
        setSessionNet(prev => Math.round((prev + finalWin) * 100) / 100);

        // Emit reveal to server to broadcast win
        if (socket) {
          socket.emit('wins:reveal', { 
            amount: finalWin,
            betAmount: isFreeSpinMode ? 0 : bet
          });
        }
        
        if (isFreeSpinMode || freeSpinsTriggered) {
          setTotalFreeSpinWin(prev => prev + finalWin);
          setLastSpinTotal(finalWin);
          setShowLastSpinTotal(true);
        }

        // Add to history
        setHistory(prev => [{ id: generateId(), amount: finalWin, type: isFreeSpinMode ? 'free' : 'normal' }, ...prev].slice(0, 5));
        
        if (finalWin >= bet * 20) {
          confetti({
            particleCount: 100,
            spread: 70,
            origin: { y: 0.6 }
          });
        }
      }

      if (freeSpinsTriggered && !isFreeSpinMode) {
        setIsFreeSpinMode(true);
      }

      // Emit reveal even for 0 wins to record the loss
      if (currentTumbleTotal === 0 && socket && !isFreeSpinMode) {
        socket.emit('wins:reveal', { 
          amount: 0,
          betAmount: bet
        });
      }

      setIsSpinning(false);
      setTumbleTotalWin(0);
      return;
    }

    // Highlight wins
    const allWinPositions = wins.flatMap(w => w.positions);
    setWinningPositions(allWinPositions);

    await new Promise(resolve => setTimeout(resolve, isTurbo ? 300 : 800));

    // Calculate payout
    const currentTumbleWin = wins.reduce((sum, w) => sum + w.payout, 0);
    const scatterWin = wins.find(w => w.symbolType === 'SCATTER');
    let triggered = freeSpinsTriggered;
    
    if (scatterWin) {
      setTotalScatterWin(prev => prev + scatterWin.payout);
      
      if (!isFreeSpinMode && scatterWin.count >= 4) {
        const initialSpins = 10 + (scatterWin.count - 4) * 5;
        setFreeSpins(prev => prev + initialSpins);
        triggered = true;
        confetti({
          particleCount: 150,
          spread: 70,
          origin: { y: 0.6 },
          colors: ['#ff00ff', '#00ffff', '#ffff00']
        });
      } else if (isFreeSpinMode && scatterWin.count >= 3) {
        const extraSpins = 5 + (scatterWin.count - 3) * 5;
        setFreeSpins(prev => prev + extraSpins);
        confetti({
          particleCount: 50,
          spread: 40,
          origin: { y: 0.6 },
          colors: ['#ff00ff', '#00ffff', '#ffff00']
        });
      }
    }

    const newTumbleTotal = currentTumbleTotal + currentTumbleWin;
    setTumbleTotalWin(newTumbleTotal);
    setWinAmount(newTumbleTotal);

    // Remove winning symbols and tumble
    const newGrid = [...currentGrid.map(row => [...row])];
    const removedPositions = new Set(allWinPositions.map(p => `${p.row}-${p.col}`));
    
    // Shift down
    for (let c = 0; c < GRID_COLS; c++) {
      let writeIdx = GRID_ROWS - 1;
      for (let r = GRID_ROWS - 1; r >= 0; r--) {
        if (!removedPositions.has(`${r}-${c}`)) {
          newGrid[writeIdx][c] = { ...newGrid[r][c], isNew: false };
          writeIdx--;
        }
      }
      // Fill from top
      for (let r = writeIdx; r >= 0; r--) {
        newGrid[r][c] = generateSymbol(undefined, isFreeSpinMode);
      }
    }

    setGrid(newGrid);
    setWinningPositions([]);
    
    setTimeout(() => handleTumble(newGrid, newTumbleTotal, triggered), isTurbo ? 200 : 500);
  }, [checkWins, bet, isFreeSpinMode, isTurbo, socket]);

  const spin = async () => {
    if (isSpinning) return;

    if (balance < bet && !isFreeSpinMode) {
      setShowInsufficientCredits(true);
      setTimeout(() => setShowInsufficientCredits(false), 3000);
      return;
    }

    setShowInsufficientCredits(false);
    setIsSpinning(true);
    setWinAmount(0);
    setSpinWin(0);
    setTumbleTotalWin(0);
    setCurrentMultiplier(1);
    setWinningPositions([]);
    setTotalScattersOnGrid(0);
    setShowLastSpinTotal(false);
    setLastSpinTotal(0);
    
    if (!isFreeSpinMode) {
      setBalance(prev => Math.round((prev - bet) * 100) / 100);
      setSessionNet(prev => Math.round((prev - bet) * 100) / 100);
      setTotalScatterWin(0);
      setTotalFreeSpinWin(0);
      setShowFreeSpinSummary(false);

      // Emit bet to server
      if (socket) {
        socket.emit('slots:spin', {
          betAmount: bet
        });
      }
    } else {
      setFreeSpins(prev => prev - 1);
    }

    const newGrid = generateInitialGrid(isFreeSpinMode);
    setGrid(newGrid);

    setTimeout(() => handleTumble(newGrid), isTurbo ? 200 : 500);
  };

  const buyFeature = () => {
    if (isSpinning || isFreeSpinMode) return;

    const cost = bet * 100;
    if (balance < cost) return;
    
    setShowBuyConfirm(true);
  };

  const confirmBuyFeature = () => {
    const cost = bet * 100;
    setShowBuyConfirm(false);
    setBalance(prev => Math.round((prev - cost) * 100) / 100);
    setSessionNet(prev => Math.round((prev - cost) * 100) / 100);
    
    // Emit bet to server
    if (socket) {
      socket.emit('slots:spin', {
        betAmount: cost
      });
    }

    setIsSpinning(true);
    setWinAmount(0);
    setSpinWin(0);
    setTumbleTotalWin(0);
    setCurrentMultiplier(1);
    setWinningPositions([]);
    setTotalScattersOnGrid(0);
    setTotalScatterWin(0);
    setTotalFreeSpinWin(0);
    setShowFreeSpinSummary(false);
    setFreeSpins(0);
    setShowLastSpinTotal(false);
    setLastSpinTotal(0);

    const newGrid = generateInitialGrid(false, 4);
    setGrid(newGrid);

    confetti({
      particleCount: 200,
      spread: 100,
      origin: { y: 0.5 }
    });

    setTimeout(() => handleTumble(newGrid), isTurbo ? 200 : 500);
  };

  useEffect(() => {
    if (freeSpins > 0 && !isSpinning) {
      const timer = setTimeout(spin, isTurbo ? 500 : 1500);
      return () => clearTimeout(timer);
    } else if (freeSpins === 0 && isFreeSpinMode && !isSpinning) {
      setIsFreeSpinMode(false);
      setShowFreeSpinSummary(true);
      confetti({
        particleCount: 300,
        spread: 120,
        origin: { y: 0.5 }
      });
    } else if (isAutoSpinning && !isSpinning && !isFreeSpinMode && !showFreeSpinSummary) {
      const timer = setTimeout(spin, isTurbo ? 500 : 1500);
      return () => clearTimeout(timer);
    }
  }, [freeSpins, isSpinning, isFreeSpinMode, isAutoSpinning, showFreeSpinSummary, isTurbo]);

  // Auto-collect free spin summary after 5s when autospin is active
  useEffect(() => {
    if (!showFreeSpinSummary || !isAutoSpinning) return;
    const timer = setTimeout(() => setShowFreeSpinSummary(false), 5000);
    return () => clearTimeout(timer);
  }, [showFreeSpinSummary, isAutoSpinning]);

  return (
    <div className="h-[100dvh] flex flex-col font-sans relative overflow-hidden bg-[#0a0a0a]">
      {/* Auth Overlay */}
      <AnimatePresence>
        {!token && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] bg-black/90 backdrop-blur-xl flex items-center justify-center p-4"
          >
            <div className="w-full max-w-md bg-[#1a1c23] border border-white/5 rounded-[2.5rem] p-8 md:p-12 shadow-2xl space-y-8">
              <div className="text-center space-y-2">
                <div className="w-16 h-16 bg-gradient-to-br from-amber-400 to-amber-600 rounded-2xl flex items-center justify-center mx-auto shadow-[0_0_20px_rgba(245,158,11,0.3)]">
                  <Trophy className="w-8 h-8 text-black" />
                </div>
                <h2 className="text-3xl font-display font-black text-white uppercase tracking-tight">
                  TTB<span className="text-amber-500">Casino</span>
                </h2>
                <p className="text-white/40 text-sm font-medium uppercase tracking-widest">
                  {authView === 'login' ? 'Welcome Back' : 'Create Account'}
                </p>
              </div>

              <div className="space-y-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-white/20 uppercase tracking-widest ml-4">Username</label>
                  <input 
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-2xl px-6 py-4 text-white focus:outline-none focus:border-amber-500/50 transition-colors"
                    placeholder="Enter username"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-white/20 uppercase tracking-widest ml-4">Password</label>
                  <input 
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-2xl px-6 py-4 text-white focus:outline-none focus:border-amber-500/50 transition-colors"
                    placeholder="Enter password"
                  />
                </div>
                {authError && <p className="text-red-500 text-xs text-center font-bold">{authError}</p>}
              </div>

              <button 
                onClick={authView === 'login' ? handleLogin : handleRegister}
                className="w-full py-5 bg-amber-500 hover:bg-amber-400 text-black font-black rounded-2xl transition-all shadow-lg active:scale-95 text-lg uppercase tracking-wider"
              >
                {authView === 'login' ? 'Sign In' : 'Sign Up'}
              </button>

              <div className="text-center">
                <button 
                  onClick={() => setAuthView(authView === 'login' ? 'register' : 'login')}
                  className="text-white/40 hover:text-white text-xs font-bold transition-colors"
                >
                  {authView === 'login' ? "Don't have an account? Sign Up" : "Already have an account? Sign In"}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Navbar */}
      <nav className="sticky top-0 z-[100] bg-black/90 backdrop-blur-md border-b border-white/5 px-4 md:px-8 py-3 md:py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div 
            className="flex items-center gap-2 cursor-pointer group"
            onClick={() => setView('home')}
          >
            <div className="w-10 h-10 bg-gradient-to-br from-amber-400 to-amber-600 rounded-xl flex items-center justify-center shadow-[0_0_15px_rgba(245,158,11,0.3)] group-hover:scale-110 transition-transform">
              <Trophy className="w-6 h-6 text-black" />
            </div>
            <span className="hidden md:block text-2xl font-display font-black tracking-normal text-white uppercase italic overflow-visible px-2">
              TTB<span className="text-amber-500 pr-2">Casino</span>
            </span>
          </div>

          {/* Jackpot Winner Banner */}
          <AnimatePresence>
            {jackpotWinner && (
              <motion.div
                initial={{ opacity: 0, y: -50 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -50 }}
                className="absolute top-full left-0 w-full bg-gradient-to-r from-amber-600 via-yellow-400 to-amber-600 p-3 text-center z-50 shadow-2xl"
              >
                <div className="flex items-center justify-center gap-3">
                  <Trophy className="w-5 h-5 text-black" />
                  <span className="text-sm font-black text-black uppercase tracking-widest">
                    🎰 JACKPOT! {jackpotWinner.username} won ${jackpotWinner.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}! 🎰
                  </span>
                  <button onClick={() => setJackpotWinner(null)} className="p-1 hover:bg-black/10 rounded-full">
                    <X className="w-4 h-4 text-black" />
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Broadcast Banner */}
          <AnimatePresence>
            {broadcast && (
              <motion.div
                initial={{ opacity: 0, y: -50 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -50 }}
                className="absolute top-full left-0 w-full bg-amber-500 p-2 text-center z-50 shadow-2xl"
              >
                <div className="flex items-center justify-center gap-3">
                  <Megaphone className="w-4 h-4 text-black" />
                  <span className="text-xs font-black text-black uppercase tracking-widest">{broadcast.message}</span>
                  <button onClick={() => setBroadcast(null)} className="p-1 hover:bg-black/10 rounded-full">
                    <X className="w-4 h-4 text-black" />
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Desktop Nav */}
          <div className="hidden md:flex items-center gap-8">
          </div>

          <div className="flex items-center gap-4">
            {userStats && (
              <div className="flex items-center gap-4 order-3 md:order-1 md:mr-4">
                <div className="hidden lg:flex flex-col items-end">
                  <span className="text-[10px] font-black text-white/40 uppercase tracking-widest">{getRank(userStats.total_wagered).name}</span>
                  <div className="flex items-center gap-1">
                    <Shield className="w-3 h-3 text-amber-500" />
                    <span className="text-xs font-black text-white uppercase tracking-tight">{getVIPBadge(userStats.total_wagered).name}</span>
                  </div>
                </div>
                <div className="relative" ref={profileDropdownRef}>
                  <button 
                    onClick={() => setIsProfileDropdownOpen(!isProfileDropdownOpen)}
                    className="flex items-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 px-2 md:px-4 py-1 md:py-2 rounded-xl md:rounded-2xl transition-all group"
                  >
                    <div className="w-6 h-6 md:w-8 md:h-8 bg-gradient-to-br from-amber-400 to-amber-600 rounded-lg flex items-center justify-center">
                      <User className="w-4 h-4 md:w-5 md:h-5 text-black" />
                    </div>
                    <span className="hidden md:block text-sm font-bold text-white max-w-[100px] truncate">{userStats.username}</span>
                    <ChevronDown className={cn("hidden md:block w-4 h-4 text-white/40 transition-transform", isProfileDropdownOpen && "rotate-180")} />
                  </button>

                  <AnimatePresence>
                    {isProfileDropdownOpen && (
                      <motion.div
                        initial={{ opacity: 0, y: 10, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 10, scale: 0.95 }}
                        className="absolute top-full right-0 mt-2 w-48 bg-[#1a1c23] border border-white/10 rounded-2xl shadow-2xl overflow-hidden py-2"
                      >
                        <div className="md:hidden px-4 py-3 border-b border-white/5 mb-2">
                          <div className="text-sm font-bold text-white truncate">{userStats.username}</div>
                          <div className="text-[10px] font-black text-amber-500 uppercase tracking-widest mt-1">{getRank(userStats.total_wagered).name}</div>
                        </div>
                        {userStats?.is_admin && (
                          <button 
                            onClick={() => { setView('admin'); setIsProfileDropdownOpen(false); }}
                            className="w-full flex items-center gap-3 px-4 py-3 text-sm font-bold text-amber-500 hover:bg-amber-500/5 transition-colors"
                          >
                            <Shield className="w-4 h-4" />
                            Admin Panel
                          </button>
                        )}
                        <button 
                          onClick={() => { setView('profile'); setIsProfileDropdownOpen(false); }}
                          className="w-full flex items-center gap-3 px-4 py-3 text-sm font-bold text-white/60 hover:text-white hover:bg-white/5 transition-colors"
                        >
                          <User className="w-4 h-4" />
                          Profile
                        </button>
                        <button 
                          onClick={() => { setView('settings'); setIsProfileDropdownOpen(false); }}
                          className="w-full flex items-center gap-3 px-4 py-3 text-sm font-bold text-white/60 hover:text-white hover:bg-white/5 transition-colors"
                        >
                          <Settings className="w-4 h-4" />
                          Settings
                        </button>
                        <div className="h-px bg-white/5 my-2" />
                        <button 
                          onClick={handleLogout}
                          className="w-full flex items-center gap-3 px-4 py-3 text-sm font-bold text-red-400 hover:bg-red-400/10 transition-colors"
                        >
                          <LogOut className="w-4 h-4" />
                          Logout
                        </button>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            )}

            <div className="flex items-center gap-1.5 md:gap-2 bg-white/5 border border-white/10 px-2 md:px-4 py-1.5 md:py-2 rounded-full order-1 md:order-2">
              <Coins className="w-3 h-3 md:w-4 md:h-4 text-amber-500" />
              <span className="font-mono font-bold text-[10px] md:text-sm text-amber-500">${balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>
            
            <button 
              className="xl:hidden p-2 text-white relative order-2 md:order-3 mr-2 md:mr-0"
              onClick={() => {
                setIsMobileChatOpen(true);
                setHasUnreadMessages(false);
              }}
            >
              <MessageSquare className="w-6 h-6 -scale-x-100" />
              {hasUnreadMessages && (
                <span className="absolute top-1.5 right-1.5 w-2.5 h-2.5 bg-red-500 rounded-full border-2 border-black animate-pulse" />
              )}
            </button>
          </div>
        </div>
      </nav>

      {/* Achievement Unlock Toast */}
      <AnimatePresence>
        {unlockedAchievement && (
          <motion.div
            initial={{ opacity: 0, x: 100, scale: 0.8 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 100, scale: 0.8 }}
            className="fixed top-24 right-4 z-[100] bg-[#1a1c23] border border-yellow-500/50 p-4 rounded-2xl shadow-2xl shadow-yellow-500/10 flex items-center gap-4 min-w-[300px]"
          >
            <div className={cn("p-3 rounded-xl bg-black/40 border border-white/10", unlockedAchievement.color)}>
              <unlockedAchievement.icon className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <Trophy className="w-3 h-3 text-yellow-500" />
                <span className="text-[10px] font-bold text-yellow-500 uppercase tracking-widest">Achievement Unlocked!</span>
              </div>
              <h4 className="font-display font-bold text-white text-lg">{unlockedAchievement.title}</h4>
              <p className="text-xs text-white/40">{unlockedAchievement.description}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Content */}
      <main className="flex-1 flex flex-row overflow-hidden">
        {/* Left Sidebar: Recent Activity */}
        <aside className="hidden lg:flex w-72 flex-col border-r border-white/5 bg-black/40 backdrop-blur-xl shrink-0">
          <div className="p-4 border-b border-white/5 flex items-center gap-2">
            <Activity className="w-4 h-4 text-amber-500" />
            <h3 className="text-xs font-black uppercase tracking-widest text-white">Recent Activity</h3>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
            <AnimatePresence initial={false}>
              {recentActivity.map((activity, i) => (
                <motion.div
                  key={`${activity.timestamp}-${i}`}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="flex flex-col gap-1 p-3 rounded-xl bg-white/5 border border-white/5"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-white/60 truncate max-w-[100px]">{activity.username}</span>
                    <div className="flex items-center gap-1.5">
                      {activity.game && <span className="text-[8px] font-bold text-white/30 uppercase tracking-widest">{activity.game}</span>}
                      <span className="text-[8px] text-white/20">{new Date(activity.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className={cn(
                      "text-xs font-black uppercase tracking-tighter",
                      activity.type === 'win' ? "text-green-400" : activity.type === 'jackpot' ? "text-amber-400" : "text-red-400"
                    )}>
                      {activity.type === 'jackpot' ? 'JACKPOT!' : activity.type.toUpperCase()}
                    </span>
                    <span className={cn(
                      "text-xs font-mono font-bold",
                      activity.type === 'win' || activity.type === 'jackpot' ? "text-green-400" : "text-red-400"
                    )}>
                      {activity.type === 'win' || activity.type === 'jackpot' ? '+' : '-'}${activity.amount.toFixed(2)}
                    </span>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </aside>
        <div className="flex-1 flex flex-col overflow-hidden">
        <Suspense fallback={<div className="flex-1 flex items-center justify-center bg-[#0a0a0a] text-white/40 text-sm font-bold uppercase tracking-widest">Loading...</div>}>
        {view === 'public_profile' && viewedUsername ? (
          <PublicProfilePage username={viewedUsername} onBack={() => navigate(-1)} />
        ) : view === 'profile' ? (
          !userStats ? (
            <div className="flex-1 flex items-center justify-center bg-[#0a0a0a] text-white/40 text-sm font-bold uppercase tracking-widest">Loading...</div>
          ) : (
          <ProfilePage
            user={userStats}
            onGift={handleGift}
            onClaimDaily={claimDaily}
            onClaimWeekly={claimWeekly}
            onClaimInterest={claimInterest}
            userAchievements={userAchievements}
          />
          )
        ) : view === 'admin' ? (
          <AdminPanel token={token || ''} />
        ) : view === 'settings' ? (
          <SettingsPage 
            user={userStats} 
            onUpdateUsername={handleUpdateUsername} 
            onUpdatePassword={handleUpdatePassword} 
          />
        ) : view === 'crash' ? (
          <div className="flex-1 flex flex-col overflow-hidden bg-[#0a0a0a]">
            <div className="flex items-center gap-3 px-6 py-3 border-b border-white/5 bg-black/40 shrink-0">
              <button onClick={() => setView('home')} className="flex items-center gap-1.5 text-white/40 hover:text-white transition-colors text-xs font-bold uppercase tracking-widest">
                <ArrowLeft className="w-4 h-4" /> Back
              </button>
              <span className="text-white/10">|</span>
              <span className="text-xs font-black uppercase tracking-widest text-white">Crash</span>
              <div onClick={() => setShowJackpotModal(true)} className="ml-auto bg-amber-500/10 border border-amber-500/30 px-2 md:px-3 py-1 rounded-full flex items-center gap-1 shrink-0 cursor-pointer hover:bg-amber-500/20 transition-colors">
                <span className="text-amber-400 text-[8px] md:text-[10px] font-black uppercase tracking-widest hidden sm:block">JP</span>
                <span className="font-mono font-bold text-[10px] md:text-sm whitespace-nowrap text-amber-300">${jackpot.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
            </div>
            <div className="flex-1 flex flex-col overflow-hidden">
              {userStats ? <CrashGame socket={socket} user={userStats} /> : null}
            </div>
          </div>
        ) : view === 'plinko' ? (
          <div className="flex-1 flex flex-col overflow-hidden bg-[#0a0a0a]">
            <div className="flex items-center gap-3 px-6 py-3 border-b border-white/5 bg-black/40 shrink-0">
              <button onClick={() => setView('home')} className="flex items-center gap-1.5 text-white/40 hover:text-white transition-colors text-xs font-bold uppercase tracking-widest">
                <ArrowLeft className="w-4 h-4" /> Back
              </button>
              <span className="text-white/10">|</span>
              <span className="text-xs font-black uppercase tracking-widest text-white">Plinko</span>
              <div onClick={() => setShowJackpotModal(true)} className="ml-auto bg-amber-500/10 border border-amber-500/30 px-2 md:px-3 py-1 rounded-full flex items-center gap-1 shrink-0 cursor-pointer hover:bg-amber-500/20 transition-colors">
                <span className="text-amber-400 text-[8px] md:text-[10px] font-black uppercase tracking-widest hidden sm:block">JP</span>
                <span className="font-mono font-bold text-[10px] md:text-sm whitespace-nowrap text-amber-300">${jackpot.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
            </div>
            <div className="flex-1 flex flex-col overflow-hidden">
              {userStats ? <PlinkoGame socket={socket} user={userStats} /> : null}
            </div>
          </div>
        ) : view === 'cases' ? (
          <div className="flex-1 flex flex-col overflow-hidden bg-[#0a0a0a]">
            <div className="flex items-center gap-3 px-6 py-3 border-b border-white/5 bg-black/40 shrink-0">
              <button onClick={() => setView('home')} className="flex items-center gap-1.5 text-white/40 hover:text-white transition-colors text-xs font-bold uppercase tracking-widest">
                <ArrowLeft className="w-4 h-4" /> Back
              </button>
              <span className="text-white/10">|</span>
              <span className="text-xs font-black uppercase tracking-widest text-white">Cases</span>
              <div onClick={() => setShowJackpotModal(true)} className="ml-auto bg-amber-500/10 border border-amber-500/30 px-2 md:px-3 py-1 rounded-full flex items-center gap-1 shrink-0 cursor-pointer hover:bg-amber-500/20 transition-colors">
                <span className="text-amber-400 text-[8px] md:text-[10px] font-black uppercase tracking-widest hidden sm:block">JP</span>
                <span className="font-mono font-bold text-[10px] md:text-sm whitespace-nowrap text-amber-300">${jackpot.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
            </div>
            <div className="flex-1 flex flex-col overflow-hidden">
              {userStats ? <CaseOpening socket={socket} user={userStats} updateCredits={(c) => {
                setUserStats(prev => prev ? { ...prev, credits: c } : null);
                setBalance(Math.round(c * 100) / 100);
              }} /> : null}
            </div>
          </div>
        ) : view === 'blackjack' ? (
          <div className="flex-1 flex flex-col overflow-hidden bg-[#0a0a0a]">
            <div className="flex items-center gap-3 px-6 py-3 border-b border-white/5 bg-black/40 shrink-0">
              <button onClick={() => setView('home')} className="flex items-center gap-1.5 text-white/40 hover:text-white transition-colors text-xs font-bold uppercase tracking-widest">
                <ArrowLeft className="w-4 h-4" /> Back
              </button>
              <span className="text-white/10">|</span>
              <span className="text-xs font-black uppercase tracking-widest text-white">Blackjack</span>
              <div onClick={() => setShowJackpotModal(true)} className="ml-auto bg-amber-500/10 border border-amber-500/30 px-2 md:px-3 py-1 rounded-full flex items-center gap-1 shrink-0 cursor-pointer hover:bg-amber-500/20 transition-colors">
                <span className="text-amber-400 text-[8px] md:text-[10px] font-black uppercase tracking-widest hidden sm:block">JP</span>
                <span className="font-mono font-bold text-[10px] md:text-sm whitespace-nowrap text-amber-300">${jackpot.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
            </div>
            <div className="flex-1 flex flex-col overflow-hidden">
              <Blackjack socket={socket} user={userStats} />
            </div>
          </div>
        ) : view === 'roulette' ? (
          <div className="flex-1 flex flex-col overflow-hidden bg-[#0a0a0a]">
            <div className="flex items-center gap-3 px-6 py-3 border-b border-white/5 bg-black/40 shrink-0">
              <button onClick={() => setView('home')} className="flex items-center gap-1.5 text-white/40 hover:text-white transition-colors text-xs font-bold uppercase tracking-widest">
                <ArrowLeft className="w-4 h-4" /> Back
              </button>
              <span className="text-white/10">|</span>
              <span className="text-xs font-black uppercase tracking-widest text-white">Roulette</span>
              <div onClick={() => setShowJackpotModal(true)} className="ml-auto bg-amber-500/10 border border-amber-500/30 px-2 md:px-3 py-1 rounded-full flex items-center gap-1 shrink-0 cursor-pointer hover:bg-amber-500/20 transition-colors">
                <span className="text-amber-400 text-[8px] md:text-[10px] font-black uppercase tracking-widest hidden sm:block">JP</span>
                <span className="font-mono font-bold text-[10px] md:text-sm whitespace-nowrap text-amber-300">${jackpot.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
            </div>
            <div className="flex-1 flex flex-col overflow-hidden">
              {userStats ? <RouletteGame socket={socket} user={userStats} /> : null}
            </div>
          </div>
        ) : view === 'home' ? (
          <div className="flex-1 overflow-y-auto custom-scrollbar bg-[#0a0a0a]">
              <div className="min-h-full max-w-5xl mx-auto p-4 md:p-8 space-y-6 md:space-y-10 flex flex-col">
                {/* Header Section */}
                <div className="text-center space-y-2 overflow-visible relative z-10 py-4">
                  <h1 className="text-5xl md:text-7xl lg:text-8xl font-display font-black tracking-normal text-white uppercase italic leading-none whitespace-nowrap overflow-visible px-4 relative z-20">
                    TTB<span className="text-transparent bg-clip-text bg-gradient-to-r from-amber-400 to-amber-600 pr-4">CASINO</span>
                  </h1>
                  <div className="flex flex-col items-center gap-1">
                    <p className="text-white/60 text-sm md:text-base font-bold">
                      Welcome back, <span className="text-white">{userStats?.username || 'Guest'}</span>
                    </p>
                  </div>
                </div>

                <div className="space-y-8 md:space-y-12">
                  {/* Rewards Section */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {/* Daily Reward */}
                    <div className="flex flex-col items-center gap-2">
                      <button 
                        onClick={claimDaily}
                        disabled={dailyClaimed}
                        className={cn(
                          "w-full py-4 md:py-5 px-8 rounded-full font-black text-base md:text-xl transition-all border-2",
                          dailyClaimed 
                            ? "bg-white/5 border-white/10 text-white/20 cursor-not-allowed" 
                            : "bg-amber-500 border-amber-400 text-black hover:bg-amber-400 hover:scale-[1.02] active:scale-95 shadow-[0_0_20px_rgba(245,158,11,0.3)]"
                        )}
                      >
                        {dailyClaimed ? "Daily Claimed" : `Daily Reward (+$${getRank(userStats?.total_wagered || 0).dailyReward.toLocaleString()})`}
                      </button>
                      {dailyClaimed && (
                        <span className="text-white/40 text-[10px] md:text-xs font-bold uppercase tracking-widest">Resets in 24h</span>
                      )}
                    </div>

                    {/* Weekly Reward */}
                    <div className="flex flex-col items-center gap-2">
                      <button 
                        onClick={claimWeekly}
                        disabled={weeklyClaimed}
                        className={cn(
                          "w-full py-4 md:py-5 px-8 rounded-full font-black text-base md:text-xl transition-all border-2",
                          weeklyClaimed
                            ? "bg-white/5 border-white/10 text-white/20 cursor-not-allowed"
                            : "bg-amber-500 border-amber-400 text-black hover:bg-amber-400 hover:scale-[1.02] active:scale-95 shadow-[0_0_20px_rgba(245,158,11,0.3)]"
                        )}
                      >
                        {weeklyClaimed ? "Weekly Claimed" : "Weekly Reward (+$10,000)"}
                      </button>
                      {weeklyClaimed && (
                        <span className="text-white/40 text-[10px] md:text-xs font-bold uppercase tracking-widest">Resets in 7d</span>
                      )}
                    </div>
                  </div>

                {/* Progressive Jackpot */}
                <div 
                  className="relative group w-full cursor-pointer"
                  onClick={() => setShowJackpotModal(true)}
                >
                  <div className="absolute -inset-1 bg-gradient-to-r from-amber-500 via-yellow-400 to-amber-600 rounded-2xl blur opacity-25 group-hover:opacity-50 transition duration-1000 group-hover:duration-200"></div>
                  <div className="relative bg-[#2a1a0a] border border-amber-500/30 p-4 md:p-6 rounded-2xl flex flex-row items-center justify-between overflow-hidden gap-4">
                    {/* Left Side: Info */}
                    <div className="flex flex-col items-start gap-0.5">
                      <span className="text-amber-500 text-[9px] md:text-[10px] font-black uppercase tracking-[0.3em]">Progressive Jackpot</span>
                      <div className="text-3xl md:text-4xl lg:text-5xl font-mono font-black text-white tracking-tighter">
                        ${jackpot.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </div>
                    </div>

                    {/* Right Side: Actions & Icon */}
                    <div className="flex items-center gap-3 md:gap-6">
                      <button 
                        onClick={(e) => { e.stopPropagation(); setShowJackpotModal(true); }}
                        className="hidden sm:block px-4 py-1.5 rounded-full bg-white/5 border border-white/10 text-white/60 text-[9px] md:text-[10px] font-black uppercase tracking-widest hover:bg-white/10 transition-all"
                      >
                        How to win?
                      </button>
                      <div className="w-12 h-12 md:w-14 md:h-14 bg-gradient-to-br from-amber-400 to-amber-600 rounded-xl flex items-center justify-center shadow-2xl rotate-12 group-hover:rotate-0 transition-transform shrink-0">
                        <Gamepad2 className="w-6 h-6 md:w-8 md:h-8 text-black" />
                      </div>
                    </div>
                  </div>
                </div>

                    {/* Games Grid */}
                    <div className="space-y-6">
                      <div className="flex items-center gap-2">
                        <Gamepad2 className="w-5 h-5 text-amber-500" />
                        <h2 className="text-2xl font-display font-black text-white uppercase italic tracking-tight">Game Lobby</h2>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                        {[
                          { id: 'crash', title: 'Crash', view: 'crash' as const },
                          { id: 'slots', title: 'Slots', view: 'game' as const },
                          { id: 'plinko', title: 'Plinko', view: 'plinko' as const },
                          { id: 'cases', title: 'Cases', view: 'cases' as const },
                          { id: 'blackjack', title: 'Blackjack', view: 'blackjack' as const },
                          { id: 'roulette', title: 'Roulette', view: 'roulette' as const },
                        ].sort((a, b) => a.title.localeCompare(b.title)).map((game) => (
                          <button 
                            key={game.id}
                            onClick={() => setView(game.view)}
                            className="group relative h-24 rounded-3xl overflow-hidden border border-white/10 bg-white/5 hover:bg-white/10 transition-all flex items-center justify-center"
                          >
                            <h3 className="text-xl font-black text-white uppercase italic group-hover:scale-110 transition-transform">{game.title}</h3>
                          </button>
                        ))}
                      </div>
                    </div>

                {/* Leaderboards */}
                <div className="space-y-6">
                  <div className="flex items-center gap-4">
                    <button 
                      onClick={() => setLeaderboardTab('allTime')}
                      className={cn(
                        "px-6 py-2 rounded-xl text-sm font-black uppercase tracking-widest transition-all",
                        leaderboardTab === 'allTime' ? "bg-amber-500 text-black shadow-lg shadow-amber-500/20" : "bg-white/5 text-white/40 hover:text-white"
                      )}
                    >
                      All-Time
                    </button>
                    <button 
                      onClick={() => setLeaderboardTab('thisWeek')}
                      className={cn(
                        "px-6 py-2 rounded-xl text-sm font-black uppercase tracking-widest transition-all",
                        leaderboardTab === 'thisWeek' ? "bg-amber-500 text-black shadow-lg shadow-amber-500/20" : "bg-white/5 text-white/40 hover:text-white"
                      )}
                    >
                      This Week
                    </button>
                  </div>
                  
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                    {[
                      { title: 'Most Credits', key: 'mostcredits', color: 'text-amber-500' },
                      { title: 'Most Wagered', key: 'mostwagered', color: 'text-red-500', suffix: ' wagered' },
                      { title: 'Biggest Single Win', key: 'biggestwin', color: 'text-green-500' }
                    ].map((col) => (
                      <div key={col.key} className="bg-[#1a1c23] border border-white/5 rounded-3xl p-6 space-y-6">
                        <h3 className="text-amber-500 font-black uppercase tracking-widest text-sm">{col.title}</h3>
                        <div className="space-y-4">
                          {(leaderboards?.[leaderboardTab]?.[col.key] || Array.from({ length: 10 }, () => ({ username: null, balance: null, totalWagered: null, biggestWin: null }))).map((user: any, i: number) => (
                            <div key={i} className="flex items-center justify-between group">
                              <div className="flex items-center gap-3">
                                <div className="w-6 flex justify-center relative">
                                  {i < 3 ? (
                                    <>
                                      <Medal className={cn(
                                        "w-5 h-5",
                                        i === 0 ? "text-amber-500" : i === 1 ? "text-slate-400" : "text-amber-700"
                                      )} />
                                      <span className={cn(
                                        "absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-[8px] font-black",
                                        i === 2 ? "text-white" : "text-black"
                                      )}>
                                        {i + 1}
                                      </span>
                                    </>
                                  ) : (
                                    <span className="text-white/20 font-mono text-xs">{i + 1}</span>
                                  )}
                                </div>
                                <span
                                  className={cn("font-bold text-sm transition-colors", user.username ? "text-white hover:text-amber-500 cursor-pointer" : "text-white/20")}
                                  onClick={() => user.username && viewProfile(user.username)}
                                >
                                  {user.username || '---'}
                                </span>
                              </div>
                              <span className={cn("font-mono font-bold text-sm", col.color)}>
                                ${((col.key === 'mostcredits' ? user.balance : col.key === 'mostwagered' ? user.totalWagered : user.biggestWin) || 0).toLocaleString()}
                                {col.suffix && <span className="text-[10px] opacity-50 ml-1">{col.suffix}</span>}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
          </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-between p-2 md:p-4 font-sans relative overflow-hidden bg-[#0a0a0a]">
            <div className="glow-bg" />
            
            <div className="flex-1 flex flex-col items-center justify-center w-full gap-2 md:gap-4 overflow-hidden">
      
      {/* Header */}
      <div className="w-full max-w-4xl flex flex-col gap-1 md:gap-2 z-10 shrink-0">
        <div className="flex items-center gap-4">
          <button onClick={() => setView('home')} className="flex items-center gap-1.5 text-white/40 hover:text-white transition-colors text-xs font-bold uppercase tracking-widest">
            <ArrowLeft className="w-4 h-4" /> Back
          </button>
          <h1 className="text-xl md:text-4xl lg:text-5xl font-display font-black italic tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-pink-400 to-purple-400 uppercase pr-4">
            Slots
          </h1>
        </div>

        <div className="flex items-center justify-between bg-black/40 backdrop-blur-md p-1 rounded-full border border-white/10 w-full overflow-hidden shadow-2xl">
          <div className="flex items-center gap-1 md:gap-2 px-2 flex-1 min-w-0 justify-start overflow-hidden">
            <div className="bg-black/60 border border-white/10 px-2 md:px-4 py-1 rounded-full flex items-center gap-1 md:gap-2 shrink-0 shadow-inner">
              <Coins className="w-3 h-3 md:w-4 md:h-4 text-yellow-400" />
              <span className="font-mono font-bold text-[10px] md:text-base whitespace-nowrap text-white">${balance.toFixed(2)}</span>
            </div>
            <div onClick={() => setShowJackpotModal(true)} className="bg-amber-500/10 border border-amber-500/30 px-2 md:px-3 py-1 rounded-full flex items-center gap-1 shrink-0 cursor-pointer hover:bg-amber-500/20 transition-colors">
              <span className="text-amber-400 text-[8px] md:text-[10px] font-black uppercase tracking-widest hidden sm:block">JP</span>
              <span className="font-mono font-bold text-[10px] md:text-sm whitespace-nowrap text-amber-300">${jackpot.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>
            <div className="bg-black/60 border border-white/10 px-2 md:px-3 py-1 rounded-full flex items-center gap-1 md:gap-2 shrink-0 shadow-inner">
              <span className="text-[8px] md:text-[10px] font-black text-white/30 uppercase tracking-widest hidden sm:block">Net</span>
              <span className={`font-mono font-bold text-[10px] md:text-base whitespace-nowrap ${sessionNet >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {sessionNet >= 0 ? '+' : ''}${sessionNet.toFixed(2)}
              </span>
            </div>

            <AnimatePresence mode="wait">
              {winAmount > 0 && (
                <motion.div
                  key="current-win"
                  initial={{ opacity: 0, scale: 0.5, x: -10 }}
                  animate={{ 
                    opacity: 1, 
                    scale: isMultiplying ? [1, 1.2, 1] : 1,
                    x: 0,
                    backgroundColor: isMultiplying ? "#fbbf24" : "#facc15"
                  }}
                  exit={{ opacity: 0, scale: 0.5, x: 10 }}
                  className={cn(
                    "px-1.5 md:px-3 py-0.5 md:py-1 rounded-full font-black text-[7px] md:text-xs shadow-lg border border-white transition-colors duration-300 shrink-0 whitespace-nowrap",
                    isMultiplying ? "bg-yellow-400 text-purple-900 scale-105 shadow-[0_0_15px_rgba(250,204,21,0.8)]" : "bg-yellow-400 text-purple-900"
                  )}
                >
                  {isMultiplying && <span className="mr-0.5">x{currentMultiplier}</span>}
                  WIN: ${winAmount.toFixed(2)}
                </motion.div>
              )}
            </AnimatePresence>

            {isFreeSpinMode && (
              <div className="flex gap-0.5 md:gap-1 shrink-0">
                <div className="bg-pink-500/80 px-1.5 md:px-3 py-0.5 md:py-1 rounded-full flex items-center gap-1">
                  <span className="font-bold text-[7px] md:text-xs uppercase tracking-tighter text-white">FS: {freeSpins}</span>
                </div>
                <div className="bg-yellow-500/80 px-1.5 md:px-3 py-0.5 md:py-1 rounded-full flex items-center gap-1 border border-yellow-400/50">
                  <span className="font-bold text-[7px] md:text-xs uppercase tracking-tighter text-purple-900">WIN: ${totalFreeSpinWin.toFixed(2)}</span>
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center gap-1 pr-1 shrink-0">
            <button 
              onClick={() => setIsMuted(!isMuted)}
              className="p-1 md:p-2 bg-white/5 hover:bg-white/10 rounded-full transition-colors"
            >
              {isMuted ? <VolumeX className="w-3 h-3 md:w-5 md:h-5 text-red-400" /> : <Volume2 className="w-3 h-3 md:w-5 md:h-5 text-white" />}
            </button>
            <button className="p-1 md:p-2 bg-white/5 hover:bg-white/10 rounded-full transition-colors">
              <Settings className="w-3 h-3 md:w-5 md:h-5" />
            </button>
            <button className="p-1 md:p-2 bg-white/5 hover:bg-white/10 rounded-full transition-colors">
              <Info className="w-3 h-3 md:w-5 md:h-5" />
            </button>
          </div>
        </div>
      </div>

      {/* Main Game Area */}
      <div className="flex-1 flex flex-col lg:flex-row gap-2 md:gap-6 lg:gap-10 items-center lg:items-center z-10 w-full max-w-6xl justify-center overflow-hidden">
        {/* Sidebar */}
        <div className="flex flex-row lg:flex-col gap-2 md:gap-4 w-full lg:w-48 justify-center lg:justify-start shrink-0">
          <button 
            onClick={buyFeature}
            disabled={isSpinning || isFreeSpinMode || balance < bet * 100 || bet < 0.2}
            className="flex-1 lg:w-full p-2 md:p-5 bg-gradient-to-b from-pink-400 to-pink-600 rounded-xl md:rounded-2xl border-2 md:border-4 border-white/30 shadow-2xl hover:scale-105 transition-transform disabled:opacity-50 disabled:scale-100 group relative overflow-hidden"
          >
            <div className="absolute inset-0 bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity" />
            <span className="block text-[8px] md:text-xs font-black uppercase tracking-widest text-white/80 mb-0.5 md:mb-1">Buy Feature</span>
            <span className="block text-sm md:text-3xl font-black italic text-white drop-shadow-md">${(bet * 100).toFixed(2)}</span>
          </button>
          
          <div className="flex-1 lg:w-full p-2 md:p-5 bg-purple-900/60 backdrop-blur-md rounded-xl md:rounded-2xl border border-white/20 flex flex-col justify-center shadow-xl">
            <span className="block text-[8px] md:text-xs font-black uppercase tracking-widest text-white/50 mb-0.5 md:mb-2 text-center lg:text-left">Last Multiplier</span>
            <span className="block text-sm md:text-4xl font-black italic text-yellow-400 text-center lg:text-left drop-shadow-[0_0_10px_rgba(250,204,21,0.3)]">x{currentMultiplier}</span>
          </div>

          {/* History Box - Now in Sidebar */}
          <div className="hidden lg:flex lg:w-full bg-black/40 backdrop-blur-md rounded-2xl border border-white/10 p-4 flex-col gap-3 max-h-[300px] shadow-xl overflow-hidden">
            <div className="flex items-center gap-2 border-b border-white/10 pb-2">
              <HistoryIcon className="w-4 h-4 text-white/40" />
              <span className="text-[10px] font-black uppercase tracking-widest text-white/40">History</span>
            </div>
            <div className="flex flex-col gap-2 overflow-y-auto pr-1 custom-scrollbar">
              <AnimatePresence initial={false}>
                {history.length === 0 ? (
                  <span className="text-[10px] text-white/20 italic text-center mt-4">No wins yet</span>
                ) : (
                  history.map((win) => (
                    <motion.div
                      key={win.id}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      className={cn(
                        "p-2 rounded-xl border flex flex-col gap-1",
                        win.type === 'free' ? "bg-pink-500/10 border-pink-500/30" : "bg-white/5 border-white/10"
                      )}
                    >
                      <div className="flex justify-between items-center">
                        <span className="text-[8px] uppercase font-bold text-white/40">{win.type === 'free' ? 'Free' : 'Normal'}</span>
                        <span className={cn("text-xs font-black", win.type === 'free' ? "text-pink-400" : "text-yellow-400")}>
                          ${win.amount.toFixed(2)}
                        </span>
                      </div>
                    </motion.div>
                  ))
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>

        <div className="relative w-full max-w-[500px] lg:max-w-[600px] flex-1 flex items-center justify-center overflow-hidden">
          <div className="relative bg-purple-900/40 backdrop-blur-2xl p-2 md:p-6 rounded-2xl md:rounded-[2.5rem] border border-white/20 shadow-[0_0_50px_rgba(0,0,0,0.5)] overflow-hidden isolation-isolate w-full max-h-full aspect-[6/5]">
            <div className="grid grid-cols-6 grid-rows-5 gap-1 md:gap-3 relative h-full w-full place-items-center">
            <AnimatePresence initial={false}>
              {grid.flatMap((row, rIdx) => 
                row.map((symbol, cIdx) => ({ ...symbol, rIdx, cIdx }))
              ).map((item) => (
                <Symbol
                  key={item.id}
                  symbol={item}
                  rIdx={item.rIdx}
                  cIdx={item.cIdx}
                  winningPositions={winningPositions}
                  totalScattersOnGrid={totalScattersOnGrid}
                  isSpinning={isSpinning}
                  Icon={SYMBOL_ICONS[item.type] || SYMBOL_ICONS.BANANA}
                />
              ))}
            </AnimatePresence>
            </div>
          </div>
        </div>
      </div>

    {/* Controls */}
      <div className="w-full max-w-4xl z-10 flex flex-col md:flex-row items-center justify-between gap-2 md:gap-8 shrink-0 pb-2">
        <div className="flex items-center gap-4 md:gap-10 bg-black/40 backdrop-blur-xl px-4 md:px-10 py-2 md:py-6 rounded-2xl md:rounded-[2.5rem] border border-white/10 shadow-2xl">
          <div className="flex flex-col items-center md:items-start">
            <div className="flex items-center gap-2 mb-1 md:mb-2">
              <span className={cn(
                "text-[8px] md:text-xs uppercase tracking-widest font-black transition-colors",
                isBetError ? "text-red-400" : "text-white/40"
              )}>
                Bet Amount
              </span>
              <AnimatePresence>
                {isBetError && (
                  <motion.span
                    initial={{ opacity: 0, x: -5 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -5 }}
                    className="text-[7px] md:text-[10px] font-black text-red-500 uppercase tracking-tighter"
                  >
                    Min $5
                  </motion.span>
                )}
              </AnimatePresence>
            </div>
            <motion.div 
              animate={isBetError ? { x: [-5, 5, -5, 5, 0] } : {}}
              transition={{ duration: 0.4 }}
              className={cn(
                "flex items-center gap-2 md:gap-4 p-0.5 md:p-1 rounded-xl md:rounded-2xl transition-colors",
                isBetError ? "bg-red-500/20 border border-red-500/50" : ""
              )}
            >
              <button 
                onClick={() => {
                  if (bet <= 5) {
                    setIsBetError(true);
                    setTimeout(() => setIsBetError(false), 500);
                  }
                  setBet(Math.max(5, Math.round((bet - 1) * 100) / 100));
                }}
                disabled={isSpinning || isFreeSpinMode}
                className="w-6 h-6 md:w-8 md:h-8 rounded-full bg-white/10 flex items-center justify-center hover:bg-white/20 transition-colors font-bold disabled:opacity-50 disabled:cursor-not-allowed text-xs md:text-base"
              >
                -
              </button>
              <div className={cn(
                "flex items-center gap-1 bg-white/5 rounded-lg md:rounded-xl px-1.5 md:px-3 py-0.5 md:py-1 border transition-colors",
                isBetError ? "border-red-500" : "border-white/10 focus-within:border-yellow-400/50"
              )}>
                <span className={cn("font-black text-xs md:text-base", isBetError ? "text-red-400" : "text-yellow-400")}>$</span>
                <input 
                  type="number"
                  value={bet === 0 ? "" : bet}
                  disabled={isSpinning || isFreeSpinMode}
                  onChange={(e) => {
                    const val = e.target.value === "" ? 0 : parseFloat(e.target.value);
                    if (!isNaN(val)) {
                      setBet(val);
                    }
                  }}
                  onBlur={() => {
                    let finalBet = bet;
                    if (bet <= 0) finalBet = 0.01;
                    if (bet > 1000) finalBet = 1000;
                    setBet(Math.round(finalBet * 100) / 100);
                  }}
                  step="0.01"
                  min="0.01"
                  className="bg-transparent font-mono text-xs md:text-xl font-bold w-12 md:w-20 text-center focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none text-white"
                />
              </div>
              <button 
                onClick={() => setBet(Math.round((bet + 1) * 100) / 100)}
                disabled={isSpinning || isFreeSpinMode}
                className="w-6 h-6 md:w-8 md:h-8 rounded-full bg-white/10 flex items-center justify-center hover:bg-white/20 transition-colors font-bold disabled:opacity-50 disabled:cursor-not-allowed text-xs md:text-base"
              >
                +
              </button>
              <button 
                onClick={() => setBet(100)}
                disabled={isSpinning || isFreeSpinMode}
                className="px-1.5 md:px-2 py-0.5 md:py-1 rounded-md md:rounded-lg bg-yellow-400/10 hover:bg-yellow-400/20 text-yellow-400 text-[7px] md:text-[10px] font-black uppercase tracking-tighter transition-colors disabled:opacity-50"
              >
                Max
              </button>
            </motion.div>
          </div>
        </div>
 
        <div className="flex items-center gap-3 md:gap-4 relative">
          <AnimatePresence>
            {showInsufficientCredits && (
              <motion.div
                initial={{ opacity: 0, y: 10, scale: 0.8 }}
                animate={{ opacity: 1, y: -50, scale: 1 }}
                exit={{ opacity: 0, y: -70, scale: 0.8 }}
                className="absolute left-1/2 -translate-x-1/2 bg-red-500 text-white px-3 py-1.5 rounded-lg font-bold text-[10px] whitespace-nowrap shadow-xl border border-red-400 z-50 pointer-events-none"
              >
                INSUFFICIENT CREDITS
                <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 w-2 h-2 bg-red-500 rotate-45 border-r border-b border-red-400" />
              </motion.div>
            )}
          </AnimatePresence>

          <button 
            onClick={() => setIsAutoSpinning(!isAutoSpinning)} 
            className={cn(
              "group flex flex-col items-center gap-0.5 md:gap-1 transition-all",
              isAutoSpinning ? "opacity-100 scale-110" : "opacity-50 hover:opacity-80"
            )}
          >
            <div className={cn(
              "w-10 h-10 md:w-12 md:h-12 rounded-full flex items-center justify-center border transition-all",
              isAutoSpinning ? "bg-yellow-400 border-yellow-300 shadow-[0_0_15px_rgba(250,204,21,0.5)]" : "bg-white/5 border-white/10"
            )}>
              <RotateCcw className={cn("w-4 h-4 md:w-5 md:h-5", isAutoSpinning ? "text-purple-900 animate-spin-slow" : "text-white")} />
            </div>
            <span className={cn("text-[8px] md:text-[10px] uppercase font-bold tracking-tighter", isAutoSpinning ? "text-yellow-400" : "text-white")}>
              {isAutoSpinning ? "Stop" : "Auto"}
            </span>
          </button>

          <button
            onClick={spin}
            disabled={isSpinning || bet < 0.2}
            className={cn(
              "w-16 h-16 md:w-24 md:h-24 rounded-full flex items-center justify-center transition-all duration-300 shadow-2xl relative group",
              isSpinning 
                ? "bg-gray-600 cursor-not-allowed" 
                : "bg-gradient-to-br from-pink-500 to-purple-600 hover:scale-110 active:scale-95"
            )}
          >
            <div className="absolute inset-0 rounded-full bg-white/20 opacity-0 group-hover:opacity-100 transition-opacity" />
            {isSpinning ? (
              <RotateCcw className="w-6 h-6 md:w-10 md:h-10 animate-spin" />
            ) : (
              <Play className="w-6 h-6 md:w-10 md:h-10 fill-current ml-1" />
            )}
          </button>

          <button 
            onClick={() => setIsTurbo(!isTurbo)} 
            className={cn(
              "group flex flex-col items-center gap-0.5 md:gap-1 transition-all",
              isTurbo ? "opacity-100 scale-110" : "opacity-50 hover:opacity-80"
            )}
          >
            <div className={cn(
              "w-10 h-10 md:w-12 md:h-12 rounded-full flex items-center justify-center border transition-all",
              isTurbo ? "bg-pink-500 border-pink-400 shadow-[0_0_15px_rgba(236,72,153,0.5)]" : "bg-white/5 border-white/10"
            )}>
              <Settings className={cn("w-4 h-4 md:w-5 md:h-5", isTurbo ? "text-white animate-pulse" : "text-white")} />
            </div>
            <span className={cn("text-[8px] md:text-[10px] uppercase font-bold tracking-tighter", isTurbo ? "text-pink-400" : "text-white")}>
              {isTurbo ? "Fast" : "Turbo"}
            </span>
          </button>
        </div>
      </div>

      {/* Decorative Candies */}
      <div className="absolute top-20 left-10 w-16 h-16 bg-pink-500/20 rounded-full blur-2xl animate-float" />
      <div className="absolute bottom-40 right-20 w-24 h-24 bg-purple-500/20 rounded-full blur-3xl animate-float" style={{ animationDelay: '1s' }} />
      <div className="absolute top-1/2 left-1/4 w-12 h-12 bg-blue-500/10 rounded-full blur-xl animate-float" style={{ animationDelay: '2s' }} />
    </div>

      {/* Free Spins Summary Popup - Global Modal */}
      <AnimatePresence>
        {showFreeSpinSummary && (
          <motion.div
            key="free-spin-summary"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 flex items-center justify-center z-[100] px-4 bg-black/80 backdrop-blur-md"
          >
            <motion.div
              initial={{ scale: 0.8, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.8, y: 20 }}
              className="bg-gradient-to-b from-yellow-300 to-yellow-500 p-1 rounded-3xl shadow-2xl max-w-xs w-full"
            >
              <div className="bg-purple-900/95 backdrop-blur-xl px-8 py-10 rounded-[22px] border border-white/20 flex flex-col items-center gap-6 text-center">
                <div className="flex flex-col items-center gap-1">
                  <span className="text-yellow-400 font-black uppercase tracking-[0.2em] text-[10px]">Session Complete</span>
                  <h2 className="text-white font-black text-2xl uppercase italic tracking-tight">Free Spins</h2>
                </div>
                
                <div className="flex flex-col items-center">
                  <span className="text-white/40 text-[10px] font-bold uppercase tracking-widest mb-1">Total Won</span>
                  <span className="text-5xl font-black italic text-white drop-shadow-[0_0_15px_rgba(255,255,255,0.5)]">
                    ${totalFreeSpinWin.toFixed(2)}
                  </span>
                </div>

                <button
                  onClick={() => setShowFreeSpinSummary(false)}
                  className="w-full py-4 bg-gradient-to-r from-yellow-400 to-yellow-500 hover:from-yellow-300 hover:to-yellow-400 text-purple-900 font-black rounded-2xl transition-all uppercase text-sm tracking-widest shadow-lg active:scale-95"
                >
                  Collect
                </button>
                {isAutoSpinning && (
                  <p className="text-white/30 text-[10px] font-bold uppercase tracking-widest">Auto-collecting in 5s...</p>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Buy Feature Confirmation Modal */}
      <AnimatePresence>
        {showBuyConfirm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 flex items-center justify-center z-[110] px-4 bg-black/60 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-purple-900 border border-white/20 p-6 rounded-3xl shadow-2xl max-w-sm w-full text-center"
            >
              <h3 className="text-xl font-black text-white uppercase italic mb-2">Buy Free Spins?</h3>
              <p className="text-white/60 text-sm mb-6">
                Are you sure you want to buy the Free Spins feature for <span className="text-yellow-400 font-bold">${(bet * 100).toFixed(2)}</span>?
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowBuyConfirm(false)}
                  className="flex-1 py-3 bg-white/10 hover:bg-white/20 text-white font-bold rounded-xl transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmBuyFeature}
                  className="flex-1 py-3 bg-gradient-to-r from-pink-500 to-purple-600 text-white font-black rounded-xl shadow-lg hover:scale-105 transition-transform"
                >
                  Buy Now
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
          </div>
        )}
        </Suspense>
        </div>
        {/* Right Sidebar: Online Players + Chat */}
        <aside className="hidden xl:flex w-80 flex-col border-l border-white/5 bg-black/40 backdrop-blur-xl shrink-0">
          {/* Online Players */}
          <div className="border-b border-white/5">
            <div className="p-4 pb-2 flex items-center gap-2">
              <Users className="w-4 h-4 text-emerald-400" />
              <h3 className="text-xs font-black uppercase tracking-widest text-white">Online</h3>
              <span className="ml-auto bg-emerald-500/20 text-emerald-400 text-[10px] font-black px-2 py-0.5 rounded-full">{onlineUsers.length}</span>
            </div>
            <div className="px-4 pb-3 flex flex-wrap gap-1.5 max-h-24 overflow-y-auto custom-scrollbar">
              {onlineUsers.map((username) => (
                <span key={username} className="flex items-center gap-1 bg-white/5 border border-white/10 rounded-full px-2.5 py-1 text-[11px] font-bold text-white/80">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                  {username}
                </span>
              ))}
            </div>
          </div>
          <div className="p-4 border-b border-white/5 flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-amber-500 -scale-x-100" />
            <h3 className="text-xs font-black uppercase tracking-widest text-white">Community Chat</h3>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
            {chatMessages.map((msg) => (
              <div key={msg.id} className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-black text-amber-500 uppercase tracking-tighter">{msg.username}</span>
                  <span className="text-[8px] text-white/20">{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
                <div className="bg-white/5 border border-white/5 p-3 rounded-2xl rounded-tl-none">
                  <p className="text-xs text-white/80 leading-relaxed">{msg.text}</p>
                </div>
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>
          <div className="p-4 border-t border-white/5 bg-black/60">
            <div className="relative">
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && sendChatMessage()}
                placeholder="Type a message..."
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-xs text-white focus:outline-none focus:border-amber-500/50 transition-colors"
              />
              <button 
                onClick={sendChatMessage}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-amber-500 hover:text-amber-400 transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </aside>
      </main>

      {/* Mobile Chat Modal */}
      <AnimatePresence>
        {isMobileChatOpen && (
          <motion.div
            initial={{ opacity: 0, x: '100%' }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: '100%' }}
            className="fixed inset-0 z-[150] bg-black flex flex-col xl:hidden"
          >
            <div className="p-4 border-b border-white/5 flex items-center justify-between bg-black/40 backdrop-blur-xl">
              <div className="flex items-center gap-2">
                <MessageSquare className="w-5 h-5 text-amber-500 -scale-x-100" />
                <h3 className="text-sm font-black uppercase tracking-widest text-white">Community Chat</h3>
              </div>
              <button 
                onClick={() => setIsMobileChatOpen(false)}
                className="p-2 text-white/60 hover:text-white transition-colors"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar bg-[#0a0a0a]">
              {chatMessages.map((msg) => (
                <div key={msg.id} className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-black text-amber-500 uppercase tracking-tighter">{msg.username}</span>
                    <span className="text-[8px] text-white/20">{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                  <div className="bg-white/5 border border-white/5 p-3 rounded-2xl rounded-tl-none">
                    <p className="text-xs text-white/80 leading-relaxed">{msg.text}</p>
                  </div>
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>

            <div className="p-4 border-t border-white/5 bg-black/60 pb-8">
              <div className="relative">
                <input
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && sendChatMessage()}
                  placeholder="Type a message..."
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-4 text-sm text-white focus:outline-none focus:border-amber-500/50 transition-colors"
                />
                <button 
                  onClick={sendChatMessage}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-amber-500 hover:text-amber-400 transition-colors"
                >
                  <ChevronRight className="w-6 h-6" />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Progressive Jackpot Info Modal */}
      <AnimatePresence>
        {showJackpotModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 flex items-center justify-center z-[120] px-4 bg-black/80 backdrop-blur-md"
            onClick={() => setShowJackpotModal(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="bg-[#0f172a] border border-amber-500/30 p-6 md:p-8 rounded-[2rem] shadow-2xl max-w-md w-full relative overflow-y-auto max-h-[90dvh] custom-scrollbar"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Close Button */}
              <button 
                onClick={() => setShowJackpotModal(false)}
                className="absolute top-4 right-4 md:top-6 md:right-6 text-white/40 hover:text-white transition-colors"
              >
                <X className="w-6 h-6" />
              </button>

              <div className="text-center space-y-6 md:space-y-8">
                <div className="space-y-2">
                  <h2 className="text-2xl md:text-3xl font-black text-amber-500 uppercase tracking-tight">Progressive Jackpot</h2>
                  <div className="flex flex-col items-center">
                    <span className="text-white/40 text-[10px] font-black uppercase tracking-[0.2em] mb-1">Current Pot</span>
                    <div className="text-4xl md:text-6xl font-mono font-black text-white tracking-tighter">
                      ${jackpot.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                  </div>
                </div>

                <div className="text-left space-y-4 text-white/80 leading-relaxed">
                  <p className="text-sm">
                    The progressive jackpot is a shared prize pool that <span className="text-white font-bold">grows with every bet</span> placed across all games. Every time anyone bets, 1% of that bet is added to the pot.
                  </p>
                  <p className="text-sm">
                    On each bet you place, there's a random chance you'll <span className="text-amber-500 font-bold">win the entire jackpot</span> on top of your normal game result. The jackpot resets to $2,000 after being won.
                  </p>
                </div>

                <div className="bg-white/5 border border-white/10 rounded-2xl p-6 text-left space-y-4">
                  <h4 className="text-white/40 text-[10px] font-black uppercase tracking-[0.2em]">How to maximise your chances</h4>
                  <ul className="space-y-3">
                    <li className="flex items-start gap-3 text-sm text-white/90">
                      <ChevronRight className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
                      <span>Play any game — every single bet is eligible</span>
                    </li>
                    <li className="flex items-start gap-3 text-sm text-white/90">
                      <ChevronRight className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
                      <span>The more bets you place, the more chances you get</span>
                    </li>
                    <li className="flex items-start gap-3 text-sm text-white/90">
                      <ChevronRight className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
                      <span>You'll see a big announcement if someone wins it</span>
                    </li>
                  </ul>
                </div>

                <button
                  onClick={() => setShowJackpotModal(false)}
                  className="w-full py-4 bg-amber-500 hover:bg-amber-400 text-black font-black rounded-2xl transition-all shadow-lg active:scale-95 text-lg uppercase tracking-wider"
                >
                  Got it
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
