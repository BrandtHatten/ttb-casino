import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { 
  Settings, 
  User, 
  Lock, 
  Shield, 
  ChevronRight, 
  Check,
  AlertCircle,
  Eye,
  EyeOff
} from 'lucide-react';
import { cn } from '../lib/utils';

interface SettingsPageProps {
  user: any;
  onUpdateUsername: (newUsername: string, password: string) => Promise<void>;
  onUpdatePassword: (currentPassword: string, newPassword: string) => Promise<void>;
}

export const SettingsPage: React.FC<SettingsPageProps> = ({ user, onUpdateUsername, onUpdatePassword }) => {
  const [newUsername, setNewUsername] = useState('');
  const [usernamePassword, setUsernamePassword] = useState('');
  const [isUpdatingUsername, setIsUpdatingUsername] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false);
  const [showCurrentPass, setShowCurrentPass] = useState(false);
  const [showNewPass, setShowNewPass] = useState(false);

  const handleUpdateUsername = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUsername || !usernamePassword) return;
    setIsUpdatingUsername(true);
    try {
      await onUpdateUsername(newUsername, usernamePassword);
      setNewUsername('');
      setUsernamePassword('');
    } finally {
      setIsUpdatingUsername(false);
    }
  };

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentPassword || !newPassword || newPassword !== confirmPassword) return;
    setIsUpdatingPassword(true);
    try {
      await onUpdatePassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } finally {
      setIsUpdatingPassword(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-8 space-y-8 bg-[#0a0a0a] custom-scrollbar">
      <div className="max-w-3xl mx-auto space-y-8">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-amber-500 rounded-2xl flex items-center justify-center shadow-lg">
            <Settings className="w-6 h-6 text-black" />
          </div>
          <div className="space-y-1">
            <h2 className="text-3xl font-display font-black text-white uppercase italic tracking-tight">Account Settings</h2>
            <p className="text-xs text-white/40 font-bold uppercase tracking-widest">Manage your profile and security</p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-8">
          {/* Username Section */}
          <div className="bg-[#1a1c23] p-8 rounded-[2.5rem] border border-white/5 space-y-6">
            <div className="flex items-center gap-3">
              <User className="w-5 h-5 text-amber-500" />
              <h3 className="text-lg font-black text-white uppercase tracking-tight">Update Username</h3>
            </div>

            <form onSubmit={handleUpdateUsername} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-white/20 uppercase tracking-widest ml-4">New Username</label>
                  <input 
                    type="text"
                    value={newUsername}
                    onChange={(e) => setNewUsername(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-2xl px-6 py-4 text-white focus:outline-none focus:border-amber-500/50 transition-colors"
                    placeholder="New username"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-white/20 uppercase tracking-widest ml-4">Current Password</label>
                  <input 
                    type="password"
                    value={usernamePassword}
                    onChange={(e) => setUsernamePassword(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-2xl px-6 py-4 text-white focus:outline-none focus:border-amber-500/50 transition-colors"
                    placeholder="Confirm with password"
                  />
                </div>
              </div>
              <button 
                type="submit"
                disabled={isUpdatingUsername}
                className="w-full md:w-auto px-8 py-4 bg-amber-500 hover:bg-amber-400 text-black font-black rounded-2xl transition-all shadow-lg active:scale-95 uppercase tracking-wider flex items-center justify-center gap-2"
              >
                {isUpdatingUsername ? 'Updating...' : 'Save Username'}
              </button>
            </form>
          </div>

          {/* Password Section */}
          <div className="bg-[#1a1c23] p-8 rounded-[2.5rem] border border-white/5 space-y-6">
            <div className="flex items-center gap-3">
              <Lock className="w-5 h-5 text-amber-500" />
              <h3 className="text-lg font-black text-white uppercase tracking-tight">Change Password</h3>
            </div>

            <form onSubmit={handleUpdatePassword} className="space-y-4">
              <div className="space-y-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-white/20 uppercase tracking-widest ml-4">Current Password</label>
                  <div className="relative">
                    <input 
                      type={showCurrentPass ? "text" : "password"}
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      className="w-full bg-white/5 border border-white/10 rounded-2xl px-6 py-4 text-white focus:outline-none focus:border-amber-500/50 transition-colors"
                      placeholder="Enter current password"
                    />
                    <button 
                      type="button"
                      onClick={() => setShowCurrentPass(!showCurrentPass)}
                      className="absolute right-6 top-1/2 -translate-y-1/2 text-white/20 hover:text-white transition-colors"
                    >
                      {showCurrentPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-white/20 uppercase tracking-widest ml-4">New Password</label>
                    <div className="relative">
                      <input 
                        type={showNewPass ? "text" : "password"}
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        className="w-full bg-white/5 border border-white/10 rounded-2xl px-6 py-4 text-white focus:outline-none focus:border-amber-500/50 transition-colors"
                        placeholder="New password"
                      />
                      <button 
                        type="button"
                        onClick={() => setShowNewPass(!showNewPass)}
                        className="absolute right-6 top-1/2 -translate-y-1/2 text-white/20 hover:text-white transition-colors"
                      >
                        {showNewPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-white/20 uppercase tracking-widest ml-4">Confirm New Password</label>
                    <input 
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      className="w-full bg-white/5 border border-white/10 rounded-2xl px-6 py-4 text-white focus:outline-none focus:border-amber-500/50 transition-colors"
                      placeholder="Repeat new password"
                    />
                  </div>
                </div>
              </div>

              {newPassword && confirmPassword && newPassword !== confirmPassword && (
                <p className="text-red-500 text-[10px] font-bold uppercase tracking-widest ml-4 flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" />
                  Passwords do not match
                </p>
              )}

              <button 
                type="submit"
                disabled={isUpdatingPassword || (newPassword !== confirmPassword && newPassword !== '')}
                className="w-full md:w-auto px-8 py-4 bg-amber-500 hover:bg-amber-400 text-black font-black rounded-2xl transition-all shadow-lg active:scale-95 uppercase tracking-wider flex items-center justify-center gap-2"
              >
                {isUpdatingPassword ? 'Updating...' : 'Update Password'}
              </button>
            </form>
          </div>

          {/* Security Info */}
          <div className="bg-gradient-to-br from-amber-500/5 to-transparent p-8 rounded-[2.5rem] border border-white/5 flex flex-col md:flex-row gap-6 items-center">
            <div className="w-16 h-16 bg-white/5 rounded-2xl flex items-center justify-center shrink-0">
              <Shield className="w-8 h-8 text-amber-500" />
            </div>
            <div className="space-y-1 text-center md:text-left">
              <h4 className="text-sm font-black text-white uppercase tracking-tight">Security Best Practices</h4>
              <p className="text-xs text-white/40 leading-relaxed font-medium">
                Use a strong, unique password for your TTB Casino account. Never share your password with anyone. Our staff will never ask for your password.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
