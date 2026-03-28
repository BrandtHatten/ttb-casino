import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Users, 
  History, 
  Settings, 
  Megaphone, 
  TrendingUp, 
  Trash2, 
  Ban, 
  RotateCcw, 
  Plus, 
  Minus,
  Search,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  CheckCircle2,
  X
} from 'lucide-react';
import { cn } from '../lib/utils';

interface AdminPanelProps {
  token: string;
}

export const AdminPanel: React.FC<AdminPanelProps> = ({ token }) => {
  const [activeTab, setActiveTab] = useState<'users' | 'transactions' | 'site'>('users');
  const [users, setUsers] = useState<any[]>([]);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [txPage, setTxPage] = useState(1);
  const [txPages, setTxPages] = useState(1);
  const [txSearch, setTxSearch] = useState('');
  const [txType, setTxType] = useState<'all' | 'win' | 'loss'>('all');
  const [broadcastMsg, setBroadcastMsg] = useState('');
  const [jackpotAmount, setJackpotAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ text: string, type: 'success' | 'error' } | null>(null);
  const [confirmAction, setConfirmAction] = useState<{ type: 'delete' | 'reset', id?: string, username?: string } | null>(null);
  const [customCredits, setCustomCredits] = useState<Record<string, string>>({});

  useEffect(() => {
    if (activeTab === 'users') fetchUsers();
    if (activeTab === 'transactions') fetchTransactions();
  }, [activeTab, txPage, txSearch, txType]);

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/users', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      setUsers(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const fetchTransactions = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/transactions?page=${txPage}&search=${txSearch}&type=${txType}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      setTransactions(data.transactions);
      setTxPages(data.pages);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleAction = async (endpoint: string, method: string, body?: any) => {
    console.log("Handling action:", endpoint, method, body);
    try {
      const res = await fetch(endpoint, {
        method,
        headers: { 
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: body ? JSON.stringify(body) : undefined
      });
      const data = await res.json();
      console.log("Action response:", data);
      if (res.ok) {
        setMessage({ text: data.message, type: 'success' });
        if (activeTab === 'users') fetchUsers();
      } else {
        setMessage({ text: data.error, type: 'error' });
      }
    } catch (err) {
      setMessage({ text: 'Action failed', type: 'error' });
    }
    setTimeout(() => setMessage(null), 3000);
  };

  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-8 space-y-8 bg-[#0a0a0a] custom-scrollbar">
      <div className="max-w-7xl mx-auto space-y-8">
        {/* Header */}
        <div className="flex flex-col lg:flex-row justify-between items-stretch lg:items-center gap-6 bg-[#1a1c23] p-6 md:p-8 rounded-[2rem] md:rounded-[2.5rem] border border-white/5">
          <div className="space-y-1">
            <h2 className="text-3xl md:text-4xl font-display font-black text-white uppercase italic tracking-tight">Admin Control</h2>
            <p className="text-[10px] md:text-xs text-white/40 font-bold uppercase tracking-widest">Manage users, transactions, and site settings</p>
          </div>
          
          <div className="bg-white/5 p-1 rounded-2xl border border-white/10 w-full lg:w-auto overflow-x-auto no-scrollbar">
            <div className="flex min-w-max px-2 gap-1 pr-4">
              {[
                { id: 'users', label: 'Users', icon: Users },
                { id: 'transactions', label: 'Transactions', icon: History },
                { id: 'site', label: 'Site', icon: Settings },
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as any)}
                  className={cn(
                    "flex-shrink-0 flex items-center justify-center gap-1.5 md:gap-2 px-3 md:px-6 py-2 md:py-3 rounded-xl text-[10px] md:text-xs font-black uppercase tracking-widest transition-all whitespace-nowrap",
                    activeTab === tab.id 
                      ? "bg-amber-500 text-black shadow-lg" 
                      : "text-white/40 hover:text-white hover:bg-white/5"
                  )}
                >
                  <tab.icon className="w-3.5 h-3.5 md:w-4 md:h-4" />
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Feedback Message */}
        <AnimatePresence>
          {message && (
            <motion.div
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className={cn(
                "p-4 rounded-2xl flex items-center gap-3 border",
                message.type === 'success' ? "bg-green-500/10 border-green-500/20 text-green-500" : "bg-red-500/10 border-red-500/20 text-red-500"
              )}
            >
              {message.type === 'success' ? <CheckCircle2 className="w-5 h-5" /> : <AlertTriangle className="w-5 h-5" />}
              <span className="text-sm font-bold uppercase tracking-widest">{message.text}</span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Content Area */}
        <div className="bg-[#1a1c23] rounded-[2rem] md:rounded-[2.5rem] border border-white/5 overflow-hidden">
          {activeTab === 'users' && (
            <div className="w-full">
              {/* Desktop Table */}
              <div className="hidden xl:block overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-white/5">
                      <th className="p-6 text-[10px] font-black text-white/20 uppercase tracking-widest">User</th>
                      <th className="p-6 text-[10px] font-black text-white/20 uppercase tracking-widest">Credits</th>
                      <th className="p-6 text-[10px] font-black text-white/20 uppercase tracking-widest">Wagered</th>
                      <th className="p-6 text-[10px] font-black text-white/20 uppercase tracking-widest">Stats</th>
                      <th className="p-6 text-[10px] font-black text-white/20 uppercase tracking-widest text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {users.map((user) => (
                      <tr key={user.id} className="hover:bg-white/[0.02] transition-colors">
                        <td className="p-6">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-white/5 rounded-xl flex items-center justify-center">
                              <Users className="w-5 h-5 text-white/40" />
                            </div>
                            <div>
                              <div className="text-sm font-black text-white uppercase tracking-tight">{user.username}</div>
                              <div className="text-[10px] font-bold text-white/20 uppercase tracking-widest">ID: {user.id.substring(0, 8)}...</div>
                            </div>
                          </div>
                        </td>
                        <td className="p-6">
                          <div className="text-sm font-mono font-black text-amber-500">${user.credits.toLocaleString()}</div>
                        </td>
                        <td className="p-6">
                          <div className="text-sm font-mono font-black text-white/60">${user.total_wagered.toLocaleString()}</div>
                        </td>
                        <td className="p-6">
                          <div className="flex flex-col gap-1">
                            <div className="text-[10px] font-bold text-white/40 uppercase tracking-widest">Bets: {user.total_bets}</div>
                            <div className="text-[10px] font-bold text-white/40 uppercase tracking-widest">Wins: {user.total_wins}</div>
                          </div>
                        </td>
                        <td className="p-6">
                          <div className="flex items-center justify-end gap-2">
                            <div className="flex items-center gap-1 bg-black/40 p-1 rounded-lg border border-white/5 mr-2">
                              <input
                                type="number"
                                placeholder="Amount"
                                value={customCredits[user.id] || ''}
                                onChange={(e) => setCustomCredits({ ...customCredits, [user.id]: e.target.value })}
                                className="w-20 bg-transparent text-xs text-white px-2 py-1 focus:outline-none font-mono"
                              />
                              <button
                                onClick={() => {
                                  const val = parseFloat(customCredits[user.id]);
                                  if (!isNaN(val) && val >= 0) {
                                    handleAction('/api/admin/set-credits', 'POST', { userId: user.id, amount: val, description: "Admin set balance" });
                                    setCustomCredits({ ...customCredits, [user.id]: '' });
                                  }
                                }}
                                className="px-2 py-1 bg-amber-500/20 text-amber-500 rounded hover:bg-amber-500 hover:text-black transition-all text-[10px] font-bold uppercase tracking-wider"
                                title="Set Exact Balance"
                              >
                                Set
                              </button>
                            </div>
                            <button 
                              onClick={() => handleAction('/api/admin/credits', 'POST', { userId: user.id, amount: 1000, description: "Admin gift" })}
                              className="p-2 bg-green-500/10 text-green-500 rounded-lg hover:bg-green-500 hover:text-black transition-all"
                              title="Add $1000"
                            >
                              <Plus className="w-4 h-4" />
                            </button>
                            <button 
                              onClick={() => handleAction('/api/admin/credits', 'POST', { userId: user.id, amount: -1000, description: "Admin removal" })}
                              className="p-2 bg-red-500/10 text-red-500 rounded-lg hover:bg-red-500 hover:text-black transition-all"
                              title="Remove $1000"
                            >
                              <Minus className="w-4 h-4" />
                            </button>
                            <button 
                              onClick={() => handleAction('/api/admin/reset-stats', 'POST', { userId: user.id })}
                              className="p-2 bg-blue-500/10 text-blue-500 rounded-lg hover:bg-blue-500 hover:text-black transition-all"
                              title="Reset Stats"
                            >
                              <RotateCcw className="w-4 h-4" />
                            </button>
                            <button 
                              onClick={() => handleAction('/api/admin/reset-achievements', 'POST', { userId: user.id })}
                              className="p-2 bg-purple-500/10 text-purple-500 rounded-lg hover:bg-purple-500 hover:text-black transition-all"
                              title="Reset Achievements"
                            >
                              <TrendingUp className="w-4 h-4" />
                            </button>
                            <button 
                              onClick={() => handleAction('/api/admin/ban', 'POST', { userId: user.id, isBanned: !user.is_banned })}
                              className={cn(
                                "p-2 rounded-lg transition-all",
                                user.is_banned ? "bg-amber-500 text-black" : "bg-white/5 text-white/40 hover:bg-amber-500 hover:text-black"
                              )}
                              title={user.is_banned ? "Unban User" : "Ban User"}
                            >
                              <Ban className="w-4 h-4" />
                            </button>
                            <button 
                              onClick={() => setConfirmAction({ type: 'delete', id: user.id, username: user.username })}
                              className="p-2 bg-red-500/10 text-red-500 rounded-lg hover:bg-red-500 hover:text-black transition-all"
                              title="Delete User"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile Card View */}
              <div className="xl:hidden divide-y divide-white/5">
                {users.map((user) => (
                  <div key={user.id} className="p-6 space-y-6">
                    <div className="flex justify-between items-start">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-white/5 rounded-xl flex items-center justify-center">
                          <Users className="w-5 h-5 text-white/40" />
                        </div>
                        <div>
                          <div className="text-sm font-black text-white uppercase tracking-tight">{user.username}</div>
                          <div className="text-[10px] font-bold text-white/20 uppercase tracking-widest">ID: {user.id.substring(0, 8)}...</div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-mono font-black text-amber-500">${user.credits.toLocaleString()}</div>
                        <div className="text-[10px] font-bold text-white/20 uppercase tracking-widest">Credits</div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="bg-white/5 p-3 rounded-xl border border-white/5">
                        <div className="text-[10px] font-bold text-white/20 uppercase tracking-widest mb-1">Wagered</div>
                        <div className="text-xs font-mono font-black text-white/60">${user.total_wagered.toLocaleString()}</div>
                      </div>
                      <div className="bg-white/5 p-3 rounded-xl border border-white/5">
                        <div className="text-[10px] font-bold text-white/20 uppercase tracking-widest mb-1">Win Rate</div>
                        <div className="text-xs font-mono font-black text-white/60">
                          {user.total_bets > 0 ? `${((user.total_wins / user.total_bets) * 100).toFixed(1)}%` : '0%'}
                        </div>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <div className="text-[10px] font-black text-white/20 uppercase tracking-widest">Quick Actions</div>
                      <div className="flex flex-wrap gap-2">
                        <div className="flex items-center gap-1 bg-black/40 p-1 rounded-lg border border-white/5 w-full sm:w-auto">
                          <input
                            type="number"
                            placeholder="Amount"
                            value={customCredits[user.id] || ''}
                            onChange={(e) => setCustomCredits({ ...customCredits, [user.id]: e.target.value })}
                            className="flex-1 sm:w-20 bg-transparent text-xs text-white px-2 py-1 focus:outline-none font-mono"
                          />
                          <button
                            onClick={() => {
                              const val = parseFloat(customCredits[user.id]);
                              if (!isNaN(val) && val >= 0) {
                                handleAction('/api/admin/set-credits', 'POST', { userId: user.id, amount: val, description: "Admin set balance" });
                                setCustomCredits({ ...customCredits, [user.id]: '' });
                              }
                            }}
                            className="px-3 py-1 bg-amber-500 text-black rounded font-bold text-[10px] uppercase tracking-wider"
                          >
                            Set
                          </button>
                        </div>
                        <div className="flex gap-2 w-full sm:w-auto">
                          <button 
                            onClick={() => handleAction('/api/admin/credits', 'POST', { userId: user.id, amount: 1000, description: "Admin gift" })}
                            className="flex-1 sm:flex-none p-2.5 bg-green-500/10 text-green-500 rounded-lg"
                          >
                            <Plus className="w-4 h-4 mx-auto" />
                          </button>
                          <button 
                            onClick={() => handleAction('/api/admin/credits', 'POST', { userId: user.id, amount: -1000, description: "Admin removal" })}
                            className="flex-1 sm:flex-none p-2.5 bg-red-500/10 text-red-500 rounded-lg"
                          >
                            <Minus className="w-4 h-4 mx-auto" />
                          </button>
                          <button 
                            onClick={() => handleAction('/api/admin/reset-stats', 'POST', { userId: user.id })}
                            className="flex-1 sm:flex-none p-2.5 bg-blue-500/10 text-blue-500 rounded-lg"
                          >
                            <RotateCcw className="w-4 h-4 mx-auto" />
                          </button>
                          <button 
                            onClick={() => handleAction('/api/admin/reset-achievements', 'POST', { userId: user.id })}
                            className="flex-1 sm:flex-none p-2.5 bg-purple-500/10 text-purple-500 rounded-lg"
                          >
                            <TrendingUp className="w-4 h-4 mx-auto" />
                          </button>
                          <button 
                            onClick={() => handleAction('/api/admin/ban', 'POST', { userId: user.id, isBanned: !user.is_banned })}
                            className={cn(
                              "flex-1 sm:flex-none p-2.5 rounded-lg",
                              user.is_banned ? "bg-amber-500 text-black" : "bg-white/5 text-white/40"
                            )}
                          >
                            <Ban className="w-4 h-4 mx-auto" />
                          </button>
                          <button 
                            onClick={() => setConfirmAction({ type: 'delete', id: user.id, username: user.username })}
                            className="flex-1 sm:flex-none p-2.5 bg-red-500/10 text-red-500 rounded-lg"
                          >
                            <Trash2 className="w-4 h-4 mx-auto" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'transactions' && (
            <div className="space-y-6 p-4 md:p-8">
              <div className="flex flex-col lg:flex-row gap-4">
                <div className="flex-1 relative">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/20" />
                  <input 
                    type="text"
                    value={txSearch}
                    onChange={(e) => { setTxSearch(e.target.value); setTxPage(1); }}
                    placeholder="Search by username..."
                    className="w-full bg-white/5 border border-white/10 rounded-2xl pl-12 pr-6 py-3 text-sm text-white focus:outline-none focus:border-amber-500/50 transition-colors"
                  />
                </div>
                <div className="flex bg-white/5 p-1 rounded-2xl border border-white/10 overflow-x-auto no-scrollbar">
                  <div className="flex min-w-max">
                    {['all', 'win', 'loss'].map((type) => (
                      <button
                        key={type}
                        onClick={() => { setTxType(type as any); setTxPage(1); }}
                        className={cn(
                          "px-6 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all",
                          txType === type ? "bg-white/10 text-white" : "text-white/40 hover:text-white"
                        )}
                      >
                        {type}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Desktop Table */}
              <div className="hidden lg:block overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-white/5">
                      <th className="pb-4 text-[10px] font-black text-white/20 uppercase tracking-widest">User</th>
                      <th className="pb-4 text-[10px] font-black text-white/20 uppercase tracking-widest">Amount</th>
                      <th className="pb-4 text-[10px] font-black text-white/20 uppercase tracking-widest">Description</th>
                      <th className="pb-4 text-[10px] font-black text-white/20 uppercase tracking-widest">Balance After</th>
                      <th className="pb-4 text-[10px] font-black text-white/20 uppercase tracking-widest text-right">Time</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {transactions.map((tx) => (
                      <tr key={tx.id} className="hover:bg-white/[0.02] transition-colors">
                        <td className="py-4 text-sm font-bold text-white">{tx.username}</td>
                        <td className={cn("py-4 text-sm font-mono font-black", tx.amount >= 0 ? "text-green-500" : "text-red-500")}>
                          {tx.amount >= 0 ? '+' : ''}${tx.amount.toLocaleString()}
                        </td>
                        <td className="py-4 text-xs text-white/40 font-medium">{tx.description}</td>
                        <td className="py-4 text-sm font-mono font-bold text-white/60">${tx.balance_after.toLocaleString()}</td>
                        <td className="py-4 text-[10px] text-white/20 font-bold text-right">{new Date(tx.timestamp).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile Card View */}
              <div className="lg:hidden space-y-4">
                {transactions.map((tx) => (
                  <div key={tx.id} className="bg-white/5 p-4 rounded-2xl border border-white/5 space-y-3">
                    <div className="flex justify-between items-start">
                      <div className="text-sm font-bold text-white">{tx.username}</div>
                      <div className={cn("text-sm font-mono font-black", tx.amount >= 0 ? "text-green-500" : "text-red-500")}>
                        {tx.amount >= 0 ? '+' : ''}${tx.amount.toLocaleString()}
                      </div>
                    </div>
                    <div className="flex justify-between items-end">
                      <div className="space-y-1">
                        <div className="text-[10px] text-white/40 font-medium uppercase tracking-widest">{tx.description}</div>
                        <div className="text-xs font-mono font-bold text-white/60">Bal: ${tx.balance_after.toLocaleString()}</div>
                      </div>
                      <div className="text-[9px] text-white/20 font-bold uppercase tracking-widest">
                        {new Date(tx.timestamp).toLocaleDateString()} {new Date(tx.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-between pt-4 border-t border-white/5">
                <div className="text-[10px] font-bold text-white/20 uppercase tracking-widest">
                  Page {txPage} of {txPages}
                </div>
                <div className="flex gap-2">
                  <button 
                    disabled={txPage === 1}
                    onClick={() => setTxPage(p => p - 1)}
                    className="p-2 bg-white/5 rounded-lg text-white disabled:opacity-20 hover:bg-white/10 transition-all"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button 
                    disabled={txPage === txPages}
                    onClick={() => setTxPage(p => p + 1)}
                    className="p-2 bg-white/5 rounded-lg text-white disabled:opacity-20 hover:bg-white/10 transition-all"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'site' && (
            <div className="p-4 md:p-8 space-y-8 md:space-y-12">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 md:gap-8">
                {/* Broadcast */}
                <div className="space-y-4">
                  <div className="space-y-1">
                    <h4 className="text-sm font-black text-white uppercase tracking-tight flex items-center gap-2">
                      <Megaphone className="w-4 h-4 text-amber-500" />
                      Broadcast Message
                    </h4>
                    <p className="text-[10px] text-white/40 font-bold uppercase tracking-widest">Send a global notification to all users</p>
                  </div>
                  <textarea 
                    value={broadcastMsg}
                    onChange={(e) => setBroadcastMsg(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-2xl p-4 md:p-6 text-sm text-white focus:outline-none focus:border-amber-500/50 transition-colors h-32 resize-none"
                    placeholder="Enter message..."
                  />
                  <button 
                    onClick={() => {
                      handleAction('/api/admin/broadcast', 'POST', { message: broadcastMsg });
                      setBroadcastMsg('');
                    }}
                    className="w-full py-3 md:py-4 bg-amber-500 text-black font-black rounded-2xl uppercase tracking-widest hover:bg-amber-400 transition-all text-xs md:text-sm"
                  >
                    Send Broadcast
                  </button>
                </div>

                {/* Jackpot Control */}
                <div className="space-y-4">
                  <div className="space-y-1">
                    <h4 className="text-sm font-black text-white uppercase tracking-tight flex items-center gap-2">
                      <TrendingUp className="w-4 h-4 text-amber-500" />
                      Jackpot Control
                    </h4>
                    <p className="text-[10px] text-white/40 font-bold uppercase tracking-widest">Manually set the progressive jackpot</p>
                  </div>
                  <div className="relative">
                    <TrendingUp className="absolute left-6 top-1/2 -translate-y-1/2 w-5 h-5 text-amber-500" />
                    <input 
                      type="number"
                      value={jackpotAmount}
                      onChange={(e) => setJackpotAmount(e.target.value)}
                      className="w-full bg-white/5 border border-white/10 rounded-2xl pl-14 pr-6 py-3 md:py-4 text-white focus:outline-none focus:border-amber-500/50 transition-colors font-mono text-sm"
                      placeholder="Enter amount..."
                    />
                  </div>
                  <button 
                    onClick={() => {
                      handleAction('/api/admin/jackpot', 'POST', { amount: parseFloat(jackpotAmount) });
                      setJackpotAmount('');
                    }}
                    className="w-full py-3 md:py-4 bg-white/5 border border-white/10 text-white font-black rounded-2xl uppercase tracking-widest hover:bg-white/10 transition-all text-xs md:text-sm"
                  >
                    Update Jackpot
                  </button>
                </div>
              </div>

              {/* Danger Zone */}
              <div className="pt-8 md:pt-12 border-t border-white/5 space-y-6">
                <div className="space-y-1">
                  <h4 className="text-sm font-black text-red-500 uppercase tracking-tight flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4" />
                    Danger Zone
                  </h4>
                  <p className="text-[10px] text-white/40 font-bold uppercase tracking-widest">Destructive actions that cannot be undone</p>
                </div>
                
                <div className="bg-red-500/5 border border-red-500/20 p-6 md:p-8 rounded-[2rem] flex flex-col lg:flex-row items-center justify-between gap-6">
                  <div className="space-y-1 text-center lg:text-left">
                    <h5 className="text-white font-black uppercase tracking-tight">Site-Wide Reset</h5>
                    <p className="text-xs text-white/40 font-medium max-w-md">Resets all user credits to $1,000, clears all stats, achievements, and transaction history.</p>
                  </div>
                  <button 
                    onClick={() => setConfirmAction({ type: 'reset' })}
                    className="w-full lg:w-auto px-8 py-4 bg-red-500 text-white font-black rounded-2xl uppercase tracking-widest hover:bg-red-600 transition-all shadow-lg shadow-red-500/20 text-xs md:text-sm"
                  >
                    Reset Entire Site
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Confirmation Modal */}
        <AnimatePresence>
          {confirmAction && (
            <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className="w-full max-w-md bg-[#1a1c23] border border-white/10 rounded-[2.5rem] p-8 space-y-6 shadow-2xl"
              >
                <div className="flex items-center gap-4 text-red-500">
                  <div className="w-12 h-12 bg-red-500/10 rounded-2xl flex items-center justify-center">
                    <AlertTriangle className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="text-xl font-black uppercase tracking-tight">Confirm Action</h3>
                    <p className="text-[10px] font-bold uppercase tracking-widest opacity-40">This action is irreversible</p>
                  </div>
                </div>

                <p className="text-sm text-white/60 font-medium leading-relaxed">
                  {confirmAction.type === 'delete' 
                    ? `Are you sure you want to permanently delete user "${confirmAction.username}"? All their data will be lost.`
                    : "Are you sure you want to reset the entire site? This will reset all user credits, stats, and clear all history."}
                </p>

                <div className="flex gap-3">
                  <button 
                    onClick={() => setConfirmAction(null)}
                    className="flex-1 py-4 bg-white/5 border border-white/10 text-white font-black rounded-2xl uppercase tracking-widest hover:bg-white/10 transition-all"
                  >
                    Cancel
                  </button>
                  <button 
                    onClick={() => {
                      if (confirmAction.type === 'delete') {
                        handleAction(`/api/admin/user/${confirmAction.id}`, 'DELETE');
                      } else {
                        handleAction('/api/admin/site-reset', 'POST');
                      }
                      setConfirmAction(null);
                    }}
                    className="flex-1 py-4 bg-red-500 text-white font-black rounded-2xl uppercase tracking-widest hover:bg-red-600 transition-all shadow-lg shadow-red-500/20"
                  >
                    Confirm
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};
