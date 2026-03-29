import React, { useState } from 'react';
import { Shield, Copy, Check, X } from 'lucide-react';
import { cn } from '../lib/utils';

interface Round {
  game: string;
  round_id: string;
  server_seed: string;
  server_seed_hash: string;
  client_seed: string;
  outcome_data: string;
  timestamp: string;
}

interface ProvablyFairModalProps {
  rounds: Round[];
  onClose: () => void;
}

export const ProvablyFairModal: React.FC<ProvablyFairModalProps> = ({ rounds, onClose }) => {
  const [copied, setCopied] = useState<string | null>(null);
  const [verified, setVerified] = useState<Record<string, boolean>>({});

  const copy = async (text: string, key: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  };

  const verify = async (round: Round) => {
    const enc = new TextEncoder();
    const buf = await crypto.subtle.digest('SHA-256', enc.encode(round.server_seed));
    const hash = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
    setVerified(prev => ({ ...prev, [round.round_id]: hash === round.server_seed_hash }));
  };

  return (
    <div className="bg-[#1a1c23] border border-white/10 rounded-[2rem] w-full max-h-[80vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between p-6 border-b border-white/5 shrink-0">
          <div className="flex items-center gap-3">
            <Shield className="w-5 h-5 text-emerald-400" />
            <div>
              <h2 className="text-lg font-black text-white uppercase tracking-tight">Provably Fair</h2>
              <p className="text-[10px] text-white/30 font-bold uppercase tracking-widest">Verify recent outcomes</p>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-xl bg-white/5 flex items-center justify-center text-white/40 hover:bg-white/10 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 py-3 bg-emerald-500/5 border-b border-emerald-500/10 shrink-0">
          <p className="text-[10px] text-emerald-400/80 font-bold leading-relaxed">
            Before each game we publish the SHA-256 hash of our server seed. After the game, we reveal the seed so you can verify we didn't change the outcome.
          </p>
        </div>

        <div className="overflow-y-auto flex-1 custom-scrollbar divide-y divide-white/5">
          {rounds.length === 0 ? (
            <div className="flex items-center justify-center h-48 text-white/20 text-sm font-bold">No rounds yet — play some games!</div>
          ) : rounds.map(r => {
            const outcome = (() => { try { return JSON.parse(r.outcome_data); } catch { return {}; } })();
            const v = verified[r.round_id];
            return (
              <div key={r.round_id} className="p-5 space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[9px] font-black uppercase tracking-widest bg-white/5 px-2 py-1 rounded-full text-white/50">{r.game}</span>
                    <span className="text-[9px] text-white/20 font-mono">{new Date(r.timestamp).toLocaleString()}</span>
                  </div>
                  {v !== undefined && (
                    <span className={cn("text-[9px] font-black uppercase px-2 py-1 rounded-full", v ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400")}>
                      {v ? '✓ Valid' : '✗ Failed'}
                    </span>
                  )}
                </div>

                <div className="space-y-1.5 text-[10px]">
                  {[['Hash', r.server_seed_hash, `h_${r.round_id}`], ['Seed', r.server_seed, `s_${r.round_id}`]].map(([label, val, key]) => val && (
                    <div key={key as string} className="flex items-center gap-2">
                      <span className="text-white/30 w-10 shrink-0 font-bold">{label}</span>
                      <span className="font-mono text-white/50 truncate flex-1 text-[9px]">{val as string}</span>
                      <button onClick={() => copy(val as string, key as string)} className="shrink-0 text-white/20 hover:text-white/50">
                        {copied === key ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                      </button>
                    </div>
                  ))}
                  {outcome.crashPoint !== undefined && <div className="text-white/30">Crash point: <span className="text-white/60 font-mono">{outcome.crashPoint}x</span></div>}
                  {outcome.totalWin !== undefined && <div className="text-white/30">Win: <span className={cn("font-mono", outcome.totalWin > 0 ? "text-emerald-400" : "text-white/40")}>${outcome.totalWin}</span></div>}
                </div>

                {r.server_seed && v === undefined && (
                  <button onClick={() => verify(r)} className="text-[9px] font-black uppercase tracking-widest text-emerald-400/60 hover:text-emerald-400 transition-colors flex items-center gap-1">
                    <Shield className="w-3 h-3" /> Verify
                  </button>
                )}
              </div>
            );
          })}
        </div>
    </div>
  );
};
