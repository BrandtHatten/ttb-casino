import React, { useState, useEffect } from 'react';
import { History, ChevronLeft, ChevronRight, TrendingUp, TrendingDown } from 'lucide-react';
import { cn } from '../lib/utils';

interface HistoryPageProps {
  token: string;
}

export const HistoryPage: React.FC<HistoryPageProps> = ({ token }) => {
  const [transactions, setTransactions] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<'all' | 'wins' | 'losses'>('all');
  const [loading, setLoading] = useState(true);

  const fetchHistory = async (p: number, f: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/user/history?page=${p}&filter=${f}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      setTransactions(data.transactions || []);
      setTotal(data.total || 0);
      setPages(data.pages || 1);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { setPage(1); fetchHistory(1, filter); }, [filter]);
  useEffect(() => { fetchHistory(page, filter); }, [page]);

  const formatDesc = (desc: string) => desc.replace(':', ' → ').replace(/_/g, ' ');

  const gameColor = (desc: string) => {
    if (desc.includes('crash')) return 'text-red-400';
    if (desc.includes('slots') || desc.includes('freespin')) return 'text-purple-400';
    if (desc.includes('plinko')) return 'text-blue-400';
    if (desc.includes('roulette')) return 'text-green-400';
    if (desc.includes('blackjack') || desc.includes('bj')) return 'text-yellow-400';
    if (desc.includes('case')) return 'text-orange-400';
    if (desc.includes('mines')) return 'text-emerald-400';
    if (desc.includes('war')) return 'text-rose-400';
    if (desc.includes('wheel')) return 'text-cyan-400';
    if (desc.includes('jackpot') || desc.includes('challenge') || desc.includes('daily') || desc.includes('weekly') || desc.includes('interest') || desc.includes('reward') || desc.includes('bonus')) return 'text-amber-400';
    return 'text-white/40';
  };

  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-8 bg-[#0a0a0a] custom-scrollbar">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-display font-black text-white uppercase italic tracking-tight">Transaction History</h1>
            <p className="text-white/30 text-xs font-bold uppercase tracking-widest mt-1">{total.toLocaleString()} total records</p>
          </div>
          <History className="w-8 h-8 text-white/10" />
        </div>

        <div className="flex gap-2">
          {(['all', 'wins', 'losses'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={cn("px-4 py-2 rounded-full text-[10px] font-black uppercase tracking-widest transition-all",
                filter === f ? "bg-amber-500 text-black" : "bg-white/5 text-white/40 hover:bg-white/10")}>
              {f}
            </button>
          ))}
        </div>

        <div className="bg-[#1a1c23] rounded-[2rem] border border-white/5 overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center h-48 text-white/20 text-sm font-bold">Loading...</div>
          ) : transactions.length === 0 ? (
            <div className="flex items-center justify-center h-48 text-white/20 text-sm font-bold">No transactions found</div>
          ) : (
            <div className="divide-y divide-white/5">
              {transactions.map((tx: any) => (
                <div key={tx.id} className="flex items-center justify-between px-5 py-4 hover:bg-white/[0.02] transition-colors">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={cn("w-8 h-8 rounded-xl flex items-center justify-center shrink-0", tx.amount > 0 ? "bg-emerald-500/10" : "bg-red-500/10")}>
                      {tx.amount > 0 ? <TrendingUp className="w-4 h-4 text-emerald-400" /> : <TrendingDown className="w-4 h-4 text-red-400" />}
                    </div>
                    <div className="min-w-0">
                      <p className={cn("text-[10px] font-black uppercase tracking-widest truncate", gameColor(tx.description))}>{formatDesc(tx.description)}</p>
                      <p className="text-[9px] text-white/20 font-bold mt-0.5">{new Date(tx.timestamp).toLocaleString()}</p>
                    </div>
                  </div>
                  <div className="text-right shrink-0 ml-4">
                    <p className={cn("font-mono font-black text-sm", tx.amount > 0 ? "text-emerald-400" : "text-red-400")}>
                      {tx.amount > 0 ? '+' : ''}{tx.amount.toFixed(2)}
                    </p>
                    <p className="text-[9px] text-white/20 font-mono mt-0.5">${tx.balance_after.toFixed(2)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {pages > 1 && (
          <div className="flex items-center justify-center gap-3">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
              className="w-9 h-9 rounded-xl bg-white/5 flex items-center justify-center text-white/40 hover:bg-white/10 disabled:opacity-30 transition-all">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-xs font-black text-white/40 uppercase tracking-widest">{page} / {pages}</span>
            <button onClick={() => setPage(p => Math.min(pages, p + 1))} disabled={page === pages}
              className="w-9 h-9 rounded-xl bg-white/5 flex items-center justify-center text-white/40 hover:bg-white/10 disabled:opacity-30 transition-all">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
