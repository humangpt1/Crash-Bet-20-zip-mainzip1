import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { User, Bet, Transaction } from "@shared/schema";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import {
  Card, CardContent, CardHeader, CardTitle,
} from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2, Activity, Users, Receipt, ShieldAlert,
  Settings, TrendingUp, Zap, BarChart3, ChevronRight,
} from "lucide-react";
import { GameCanvas } from "@/components/GameCanvas";
import { useGame } from "@/hooks/use-game";

const formatKsh = (cents: number) => `KES ${(cents / 100).toLocaleString("en-KE", { minimumFractionDigits: 0 })}`;
const toCents = (ksh: number) => Math.round(ksh * 100);

type AdminTab = "live" | "players" | "transactions" | "settings";

interface GameSettingsData {
  houseLevel: number;
  instantBustChance: number;
  consecutiveHighLimit: number;
  fakeMin: number;
  fakeMax: number;
}

export default function AdminPage() {
  const { toast } = useToast();
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [activeTab, setActiveTab] = useState<AdminTab>("live");
  const { gameState } = useGame();

  const { data: users, isLoading: usersLoading } = useQuery<User[]>({
    queryKey: ["/api/admin/users"],
    refetchInterval: 5000,
  });

  const { data: currentBets } = useQuery<{ bet: Bet; user: User; playerIndex: number }[]>({
    queryKey: ["/api/bets/current"],
    refetchInterval: 1000,
  });

  const { data: transactions = [] } = useQuery<Transaction[]>({
    queryKey: ["/api/admin/transactions"],
    refetchInterval: 5000,
  });

  const { data: pendingWithdrawals = [] } = useQuery<Transaction[]>({
    queryKey: ["/api/admin/withdrawals"],
    refetchInterval: 5000,
  });

  const { data: serverSettings, isLoading: settingsLoading } = useQuery<GameSettingsData>({
    queryKey: ["/api/admin/game-settings"],
    refetchInterval: 10000,
  });

  const [localSettings, setLocalSettings] = useState<GameSettingsData | null>(null);
  const activeSettings: GameSettingsData = localSettings ?? serverSettings ?? {
    houseLevel: 5,
    instantBustChance: 0.10,
    consecutiveHighLimit: 3,
    fakeMin: 70,
    fakeMax: 130,
  };

  const saveSettingsMutation = useMutation({
    mutationFn: async (settings: GameSettingsData) => {
      await apiRequest("POST", "/api/admin/game-settings", settings);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/game-settings"] });
      setLocalSettings(null);
      toast({ title: "Settings saved", description: "Game engine updated live." });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const setBalanceMutation = useMutation({
    mutationFn: async ({ userId, balance }: { userId: number; balance: number }) => {
      await apiRequest("POST", "/api/admin/set-balance", { userId, balance });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({ title: "Wallet updated" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const grantMutation = useMutation({
    mutationFn: async ({ userId, amount }: { userId: number; amount: number }) => {
      await apiRequest("POST", "/api/admin/grant-coins", { userId, amount });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({ title: "Wallet credited" });
    },
  });

  const blockMutation = useMutation({
    mutationFn: async ({ userId, blocked }: { userId: number; blocked: boolean }) => {
      await apiRequest("POST", `/api/admin/users/${userId}/block`, {
        blocked,
        reason: blocked ? "Blocked by admin" : undefined,
      });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] }),
  });

  const settleWithdrawal = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("POST", `/api/admin/withdrawals/${id}/complete`, {
        receipt: `MANUAL-${Date.now()}`,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/withdrawals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/transactions"] });
    },
  });

  const rejectWithdrawal = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("POST", `/api/admin/withdrawals/${id}/reject`, { reason: "Rejected by admin" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/withdrawals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/transactions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
    },
  });

  const totalBetsCents = useMemo(() => currentBets?.reduce((s, b) => s + b.bet.amount, 0) ?? 0, [currentBets]);
  const totalPayoutCents = useMemo(() => currentBets?.reduce((s, b) => s + (b.bet.winAmount || 0), 0) ?? 0, [currentBets]);
  const platformDeposits = useMemo(
    () => transactions.filter((t) => t.type === "deposit" && t.status === "success").reduce((s, t) => s + t.amount, 0),
    [transactions],
  );
  const platformWithdrawals = useMemo(
    () => transactions.filter((t) => t.type === "withdrawal" && t.status === "success").reduce((s, t) => s + t.amount, 0),
    [transactions],
  );
  const netRevenue = platformDeposits - platformWithdrawals;

  const houseLevelLabel = (l: number) => {
    if (l <= 2) return "Generous";
    if (l <= 4) return "Balanced";
    if (l <= 6) return "Standard";
    if (l <= 8) return "Aggressive";
    return "Maximum";
  };
  const houseLevelColor = (l: number) => {
    if (l <= 3) return "text-emerald-400";
    if (l <= 6) return "text-yellow-400";
    return "text-rose-400";
  };

  const tabs: { key: AdminTab; label: string; icon: any; badge?: number }[] = [
    { key: "live", label: "Live", icon: Activity },
    { key: "players", label: "Players", icon: Users, badge: users?.length },
    { key: "transactions", label: "Txns", icon: Receipt, badge: pendingWithdrawals.length || undefined },
    { key: "settings", label: "Settings", icon: Settings },
  ];

  if (usersLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-black">
        <Loader2 className="animate-spin text-primary w-8 h-8" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-black/95 border-b border-zinc-800 px-4 py-3 flex items-center justify-between">
        <h1 className="text-lg sm:text-2xl font-black tracking-tighter">
          CRASH<span className="text-primary">.BET</span>{" "}
          <span className="text-zinc-500 font-normal text-sm">ADMIN</span>
        </h1>
        <div className="flex items-center gap-2">
          <span className={`text-xs font-bold px-2 py-1 rounded-full ${
            gameState.status === "active"
              ? "bg-emerald-500/20 text-emerald-400"
              : gameState.status === "betting"
              ? "bg-blue-500/20 text-blue-400"
              : "bg-red-500/20 text-red-400"
          }`}>
            {gameState.status === "active"
              ? `🚀 ${gameState.multiplier.toFixed(2)}x`
              : gameState.status === "betting"
              ? "⏳ BETTING"
              : "💥 CRASHED"}
          </span>
          <span className="text-xs text-zinc-500">{gameState.onlineCount} online</span>
        </div>
      </header>

      {/* Revenue bar */}
      <div className="grid grid-cols-4 border-b border-zinc-800">
        {[
          { label: "Deposits", value: formatKsh(platformDeposits), color: "text-emerald-400" },
          { label: "Withdrawals", value: formatKsh(platformWithdrawals), color: "text-rose-400" },
          { label: "Net Revenue", value: formatKsh(netRevenue), color: netRevenue >= 0 ? "text-emerald-400" : "text-rose-400" },
          { label: "Round Bets", value: formatKsh(totalBetsCents), color: "text-blue-400" },
        ].map((s) => (
          <div key={s.label} className="px-2 py-2 text-center border-r border-zinc-800 last:border-r-0">
            <div className="text-[9px] text-zinc-500 uppercase">{s.label}</div>
            <div className={`text-xs font-black ${s.color} truncate`}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Mobile Tab Nav */}
      <nav className="flex border-b border-zinc-800 bg-zinc-950">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex-1 flex flex-col items-center gap-0.5 py-2.5 text-[10px] font-bold uppercase relative transition-colors ${
                activeTab === tab.key ? "text-primary border-b-2 border-primary" : "text-zinc-500"
              }`}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
              {tab.badge ? (
                <span className="absolute top-1 right-2 bg-rose-500 text-white text-[8px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
                  {tab.badge > 9 ? "9+" : tab.badge}
                </span>
              ) : null}
            </button>
          );
        })}
      </nav>

      {/* Tab Content */}
      <div className="p-3 sm:p-5 pb-20">

        {/* ─── LIVE TAB ─── */}
        {activeTab === "live" && (
          <div className="space-y-4">
            <Card className="bg-zinc-900 border-zinc-800 overflow-hidden">
              <CardHeader className="border-b border-zinc-800 p-3">
                <CardTitle className="text-xs font-bold flex items-center gap-2">
                  <Activity className="w-3.5 h-3.5 text-primary" /> LIVE CANVAS
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <GameCanvas gameState={gameState} />
              </CardContent>
            </Card>

            {/* Current round bets — scrollable table */}
            <Card className="bg-zinc-900 border-zinc-800">
              <CardHeader className="border-b border-zinc-800 p-3 flex flex-row items-center justify-between">
                <CardTitle className="text-xs font-bold flex items-center gap-2">
                  <TrendingUp className="w-3.5 h-3.5 text-primary" /> CURRENT BETS
                </CardTitle>
                <span className="text-xs text-zinc-500">{currentBets?.length ?? 0} bets • {formatKsh(totalBetsCents)}</span>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto max-h-[300px] overflow-y-auto">
                  <table className="w-full text-xs min-w-[360px]">
                    <thead className="sticky top-0 bg-zinc-900 border-b border-zinc-800">
                      <tr>
                        <th className="text-left px-3 py-2 text-zinc-500 font-medium">Player</th>
                        <th className="text-right px-3 py-2 text-zinc-500 font-medium">Bet</th>
                        <th className="text-right px-3 py-2 text-zinc-500 font-medium">Auto</th>
                        <th className="text-right px-3 py-2 text-zinc-500 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {currentBets?.length === 0 && (
                        <tr><td colSpan={4} className="text-center py-6 text-zinc-600">No bets this round</td></tr>
                      )}
                      {currentBets?.map((b, i) => (
                        <tr key={b.bet.id} className={`border-b border-zinc-800/50 ${i % 2 === 0 ? "bg-black/20" : ""}`}>
                          <td className="px-3 py-2 font-mono text-zinc-300">
                            {(b.user as any)?.username || `U#${b.bet.userId}`}
                          </td>
                          <td className="px-3 py-2 text-right font-bold text-white">
                            {formatKsh(b.bet.amount)}
                          </td>
                          <td className="px-3 py-2 text-right text-zinc-400">
                            {b.bet.autoCashout ? `${b.bet.autoCashout}x` : "—"}
                          </td>
                          <td className="px-3 py-2 text-right">
                            <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${
                              b.bet.status === "won"
                                ? "bg-emerald-700/40 text-emerald-300"
                                : b.bet.status === "lost"
                                ? "bg-rose-700/40 text-rose-300"
                                : "bg-blue-700/40 text-blue-300"
                            }`}>
                              {b.bet.status === "won" ? `${b.bet.cashoutMultiplier}x` : b.bet.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            {/* Pending withdrawals */}
            <Card className="bg-zinc-900 border-zinc-800">
              <CardHeader className="border-b border-zinc-800 p-3 flex flex-row items-center justify-between">
                <CardTitle className="text-xs font-bold flex items-center gap-2">
                  <ShieldAlert className="w-3.5 h-3.5 text-yellow-400" /> PENDING WITHDRAWALS
                </CardTitle>
                {pendingWithdrawals.length > 0 && (
                  <span className="text-[10px] bg-yellow-500/20 text-yellow-400 font-bold px-2 py-0.5 rounded-full">
                    {pendingWithdrawals.length}
                  </span>
                )}
              </CardHeader>
              <CardContent className="p-0 max-h-[300px] overflow-y-auto">
                {pendingWithdrawals.length === 0 && (
                  <div className="py-6 text-center text-xs text-zinc-600">No pending withdrawals</div>
                )}
                {pendingWithdrawals.map((w) => (
                  <div key={w.id} className="flex items-center justify-between px-3 py-3 border-b border-zinc-800 last:border-0">
                    <div>
                      <div className="text-sm font-bold">{formatKsh(w.amount)}</div>
                      <div className="text-[10px] text-zinc-500">{w.phone} • U#{w.userId}</div>
                    </div>
                    <div className="flex gap-1.5">
                      <Button size="sm" className="h-7 text-[9px] px-2 bg-emerald-600 hover:bg-emerald-700"
                        onClick={() => settleWithdrawal.mutate(w.id)}>
                        PAID
                      </Button>
                      <Button size="sm" variant="outline" className="h-7 text-[9px] px-2 border-red-700 text-red-400"
                        onClick={() => rejectWithdrawal.mutate(w.id)}>
                        REJECT
                      </Button>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        )}

        {/* ─── PLAYERS TAB ─── */}
        {activeTab === "players" && (
          <div className="space-y-3">
            <div className="text-xs text-zinc-500 font-bold uppercase tracking-wider mb-1">
              {users?.length ?? 0} registered players
            </div>
            <div className="max-h-[calc(100vh-200px)] overflow-y-auto space-y-2 pr-1">
              {users?.map((u: any) => (
                <div key={u.id} className="bg-zinc-900 border border-zinc-800 rounded-xl p-3 space-y-3">
                  {/* Header row */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-bold text-sm text-white flex items-center gap-1.5 flex-wrap">
                        <span className="truncate">{u.username || u.phone || `Player #${u.id}`}</span>
                        {u.isAdmin && <span className="text-[9px] bg-yellow-500/20 text-yellow-400 px-1.5 py-0.5 rounded font-bold">ADMIN</span>}
                        {u.isBlocked && <span className="text-[9px] bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded font-bold">BLOCKED</span>}
                      </div>
                      <div className="text-[10px] text-zinc-500 mt-0.5">
                        {u.phone} • ID #{u.id}
                      </div>
                    </div>
                    <Button size="sm" variant="outline"
                      className={`h-6 px-2 text-[9px] shrink-0 ${u.isBlocked ? "border-emerald-700 text-emerald-400" : "border-red-700 text-red-400"}`}
                      onClick={() => blockMutation.mutate({ userId: u.id, blocked: !u.isBlocked })}>
                      {u.isBlocked ? "UNBLOCK" : "BLOCK"}
                    </Button>
                  </div>

                  {/* Stats row */}
                  <div className="grid grid-cols-3 gap-1.5">
                    <MiniStat label="Wallet" value={formatKsh(u.walletBalance ?? 0)} color="text-emerald-400" />
                    <MiniStat label="Deposited" value={formatKsh(u.totalDeposited ?? 0)} color="text-blue-400" />
                    <MiniStat label="Wagered" value={formatKsh(u.totalWagered ?? 0)} color="text-zinc-300" />
                  </div>

                  {/* Quick grant buttons */}
                  <div className="grid grid-cols-5 gap-1">
                    {[10, 50, 100, 500, 1000].map((amt) => (
                      <Button key={amt} variant="outline" size="sm"
                        className="h-6 text-[9px] p-0 border-zinc-700 hover:bg-emerald-900/40 hover:border-emerald-700 hover:text-emerald-300"
                        onClick={() => grantMutation.mutate({ userId: u.id, amount: amt })}>
                        +{amt}
                      </Button>
                    ))}
                  </div>

                  {/* Set wallet */}
                  <div className="flex gap-2">
                    <Input type="number" placeholder="Set wallet (KES)" className="h-7 text-xs bg-black border-zinc-700 flex-1"
                      value={inputs[`${u.id}`] || ""}
                      onChange={(e) => setInputs({ ...inputs, [`${u.id}`]: e.target.value })} />
                    <Button size="sm" className="h-7 px-3 text-[10px] font-bold"
                      onClick={() => {
                        const val = parseFloat(inputs[`${u.id}`]);
                        if (!isNaN(val) && val >= 0) {
                          setBalanceMutation.mutate({ userId: u.id, balance: toCents(val) });
                          setInputs((p) => ({ ...p, [`${u.id}`]: "" }));
                        }
                      }}>
                      SET
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ─── TRANSACTIONS TAB ─── */}
        {activeTab === "transactions" && (
          <div className="space-y-4">
            {pendingWithdrawals.length > 0 && (
              <Card className="bg-zinc-900 border-yellow-500/40 border">
                <CardHeader className="border-b border-zinc-800 p-3">
                  <CardTitle className="text-xs font-bold flex items-center gap-2">
                    <ShieldAlert className="w-3.5 h-3.5 text-yellow-400" /> NEEDS ACTION
                    <span className="ml-auto text-[10px] bg-yellow-500/20 text-yellow-400 px-2 py-0.5 rounded-full font-bold">
                      {pendingWithdrawals.length}
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0 max-h-[250px] overflow-y-auto">
                  {pendingWithdrawals.map((w) => (
                    <div key={w.id} className="flex items-center justify-between px-3 py-3 border-b border-zinc-800 last:border-0">
                      <div>
                        <div className="text-sm font-bold">{formatKsh(w.amount)}</div>
                        <div className="text-[10px] text-zinc-500">{w.phone} • U#{w.userId}</div>
                      </div>
                      <div className="flex gap-1.5">
                        <Button size="sm" className="h-7 text-[9px] px-2 bg-emerald-600 hover:bg-emerald-700"
                          onClick={() => settleWithdrawal.mutate(w.id)}>PAID</Button>
                        <Button size="sm" variant="outline" className="h-7 text-[9px] px-2 border-red-700 text-red-400"
                          onClick={() => rejectWithdrawal.mutate(w.id)}>REJECT</Button>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            <Card className="bg-zinc-900 border-zinc-800">
              <CardHeader className="border-b border-zinc-800 p-3">
                <CardTitle className="text-xs font-bold flex items-center gap-2">
                  <Receipt className="w-3.5 h-3.5 text-primary" /> ALL TRANSACTIONS
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto max-h-[calc(100vh-280px)] overflow-y-auto">
                  <table className="w-full text-xs min-w-[360px]">
                    <thead className="sticky top-0 bg-zinc-900 border-b border-zinc-800">
                      <tr>
                        <th className="text-left px-3 py-2 text-zinc-500 font-medium">Type</th>
                        <th className="text-right px-3 py-2 text-zinc-500 font-medium">Amount</th>
                        <th className="text-left px-3 py-2 text-zinc-500 font-medium">User</th>
                        <th className="text-right px-3 py-2 text-zinc-500 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {transactions.slice(0, 100).map((t, i) => (
                        <tr key={t.id} className={`border-b border-zinc-800/50 ${i % 2 === 0 ? "bg-black/20" : ""}`}>
                          <td className="px-3 py-2">
                            <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${
                              t.type === "deposit"
                                ? "bg-emerald-700/40 text-emerald-300"
                                : "bg-rose-700/40 text-rose-300"
                            }`}>
                              {t.type}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right font-bold">{formatKsh(t.amount)}</td>
                          <td className="px-3 py-2 text-zinc-400 font-mono">{t.phone || `U#${t.userId}`}</td>
                          <td className="px-3 py-2 text-right">
                            <span className={`text-[9px] uppercase font-bold ${
                              t.status === "success" ? "text-emerald-400"
                                : t.status === "failed" ? "text-rose-400"
                                : "text-yellow-400"
                            }`}>
                              {t.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* ─── SETTINGS TAB ─── */}
        {activeTab === "settings" && (
          <div className="space-y-4 max-w-xl mx-auto">
            {settingsLoading ? (
              <div className="flex justify-center py-12"><Loader2 className="animate-spin text-primary" /></div>
            ) : (
              <>
                {/* House Profit Level */}
                <Card className="bg-zinc-900 border-zinc-800">
                  <CardHeader className="border-b border-zinc-800 p-4">
                    <CardTitle className="text-sm font-bold flex items-center gap-2">
                      <BarChart3 className="w-4 h-4 text-primary" /> HOUSE PROFIT LEVEL
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-4 space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className={`text-2xl font-black ${houseLevelColor(activeSettings.houseLevel)}`}>
                          Level {activeSettings.houseLevel}
                        </div>
                        <div className={`text-sm font-bold ${houseLevelColor(activeSettings.houseLevel)}`}>
                          {houseLevelLabel(activeSettings.houseLevel)}
                        </div>
                      </div>
                      <div className="text-right text-xs text-zinc-500">
                        <div>House edge</div>
                        <div className="text-white font-bold text-base">
                          {(5 + ((activeSettings.houseLevel - 1) / 9) * 60).toFixed(0)}%
                        </div>
                      </div>
                    </div>
                    <Slider
                      min={1} max={10} step={1}
                      value={[activeSettings.houseLevel]}
                      onValueChange={([v]) => setLocalSettings({ ...activeSettings, houseLevel: v })}
                      className="mt-2"
                    />
                    <div className="flex justify-between text-[10px] text-zinc-600">
                      <span>1 — Generous</span>
                      <span>5 — Standard</span>
                      <span>10 — Max Profit</span>
                    </div>
                    <div className="bg-zinc-800/60 rounded-lg p-3 text-xs text-zinc-400 space-y-1">
                      <div className="font-bold text-zinc-300 mb-1">What this controls:</div>
                      <div>• <span className="text-white">Lower levels</span>: more 2x–10x rounds, players win more often → more fun, more engagement</div>
                      <div>• <span className="text-white">Higher levels</span>: more 1.0x–1.5x busts, house makes more money per round</div>
                      <div>• <span className="text-yellow-400">Level 5–6</span> recommended for best player retention + profit balance</div>
                    </div>
                  </CardContent>
                </Card>

                {/* Instant Bust Chance */}
                <Card className="bg-zinc-900 border-zinc-800">
                  <CardHeader className="border-b border-zinc-800 p-4">
                    <CardTitle className="text-sm font-bold flex items-center gap-2">
                      <Zap className="w-4 h-4 text-rose-400" /> INSTANT BUST CHANCE
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-4 space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-2xl font-black text-rose-400">
                          {(activeSettings.instantBustChance * 100).toFixed(0)}%
                        </div>
                        <div className="text-xs text-zinc-500">of rounds crash at exactly 1.00x</div>
                      </div>
                      <div className="text-right text-xs text-zinc-500">
                        <div>~1 in every</div>
                        <div className="text-white font-bold text-lg">
                          {(1 / activeSettings.instantBustChance).toFixed(0)} rounds
                        </div>
                      </div>
                    </div>
                    <Slider
                      min={2} max={30} step={1}
                      value={[Math.round(activeSettings.instantBustChance * 100)]}
                      onValueChange={([v]) => setLocalSettings({ ...activeSettings, instantBustChance: v / 100 })}
                    />
                    <div className="flex justify-between text-[10px] text-zinc-600">
                      <span>2% — Rare</span>
                      <span>10% — Standard</span>
                      <span>30% — Frequent</span>
                    </div>
                  </CardContent>
                </Card>

                {/* Consecutive High Limit */}
                <Card className="bg-zinc-900 border-zinc-800">
                  <CardHeader className="border-b border-zinc-800 p-4">
                    <CardTitle className="text-sm font-bold flex items-center gap-2">
                      <TrendingUp className="w-4 h-4 text-yellow-400" /> WIN STREAK LIMIT
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-4 space-y-4">
                    <div>
                      <div className="text-2xl font-black text-yellow-400">
                        {activeSettings.consecutiveHighLimit} rounds
                      </div>
                      <div className="text-xs text-zinc-500">max consecutive ≥2x rounds before forced low</div>
                    </div>
                    <Slider
                      min={1} max={8} step={1}
                      value={[activeSettings.consecutiveHighLimit]}
                      onValueChange={([v]) => setLocalSettings({ ...activeSettings, consecutiveHighLimit: v })}
                    />
                    <div className="flex justify-between text-[10px] text-zinc-600">
                      <span>1 — Very strict</span>
                      <span>3 — Standard</span>
                      <span>8 — Loose</span>
                    </div>
                  </CardContent>
                </Card>

                {/* Fake Players */}
                <Card className="bg-zinc-900 border-zinc-800">
                  <CardHeader className="border-b border-zinc-800 p-4">
                    <CardTitle className="text-sm font-bold flex items-center gap-2">
                      <Users className="w-4 h-4 text-blue-400" /> FAKE PLAYERS PER ROUND
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-4 space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-2xl font-black text-blue-400">
                          {activeSettings.fakeMin}–{activeSettings.fakeMax}
                        </div>
                        <div className="text-xs text-zinc-500">fake bettors shown per round</div>
                      </div>
                    </div>
                    <div className="space-y-3">
                      <div>
                        <div className="text-xs text-zinc-400 mb-1.5">Minimum: {activeSettings.fakeMin}</div>
                        <Slider min={10} max={100} step={5}
                          value={[activeSettings.fakeMin]}
                          onValueChange={([v]) => setLocalSettings({ ...activeSettings, fakeMin: Math.min(v, activeSettings.fakeMax - 5) })}
                        />
                      </div>
                      <div>
                        <div className="text-xs text-zinc-400 mb-1.5">Maximum: {activeSettings.fakeMax}</div>
                        <Slider min={20} max={200} step={5}
                          value={[activeSettings.fakeMax]}
                          onValueChange={([v]) => setLocalSettings({ ...activeSettings, fakeMax: Math.max(v, activeSettings.fakeMin + 5) })}
                        />
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Save button */}
                {localSettings && (
                  <div className="sticky bottom-4">
                    <Button
                      className="w-full h-12 text-sm font-black bg-primary hover:bg-primary/90"
                      onClick={() => saveSettingsMutation.mutate(localSettings)}
                      disabled={saveSettingsMutation.isPending}
                    >
                      {saveSettingsMutation.isPending ? (
                        <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Applying...</>
                      ) : (
                        <><ChevronRight className="w-4 h-4 mr-2" /> APPLY SETTINGS LIVE</>
                      )}
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function MiniStat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="bg-black/40 rounded-lg p-2 border border-zinc-800/60">
      <div className="text-[8px] text-zinc-600 uppercase">{label}</div>
      <div className={`text-[11px] font-bold ${color ?? "text-white"} truncate`}>{value}</div>
    </div>
  );
}
