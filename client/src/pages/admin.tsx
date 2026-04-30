import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { User, Bet, Transaction } from "@shared/schema";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Activity, Users, Receipt, ShieldAlert } from "lucide-react";
import { GameCanvas } from "@/components/GameCanvas";
import { useGame } from "@/hooks/use-game";

const formatKsh = (cents: number) => `KSH ${(cents / 100).toFixed(2)}`;
const toCents = (ksh: number) => Math.round(ksh * 100);

export default function AdminPage() {
  const { toast } = useToast();
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const { gameState } = useGame();

  const { data: users, isLoading: usersLoading } = useQuery<User[]>({
    queryKey: ["/api/admin/users"],
    refetchInterval: 5000,
  });

  const { data: currentBets } = useQuery<
    { bet: Bet; user: User; playerIndex: number }[]
  >({
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

  const setBalanceMutation = useMutation({
    mutationFn: async ({
      userId,
      balance,
    }: {
      userId: number;
      balance: number; // cents
    }) => {
      await apiRequest("POST", "/api/admin/set-balance", { userId, balance });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({ title: "Wallet updated" });
    },
    onError: (e: Error) =>
      toast({
        title: "Error",
        description: e.message,
        variant: "destructive",
      }),
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
    mutationFn: async ({
      userId,
      blocked,
    }: {
      userId: number;
      blocked: boolean;
    }) => {
      await apiRequest("POST", `/api/admin/users/${userId}/block`, {
        blocked,
        reason: blocked ? "Blocked by admin" : undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
    },
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
      await apiRequest("POST", `/api/admin/withdrawals/${id}/reject`, {
        reason: "Rejected by admin",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/withdrawals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/transactions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
    },
  });

  const totalBetsCents = useMemo(
    () => currentBets?.reduce((sum, b) => sum + b.bet.amount, 0) ?? 0,
    [currentBets],
  );

  const totalPayoutCents = useMemo(
    () =>
      currentBets?.reduce((sum, b) => sum + (b.bet.winAmount || 0), 0) ?? 0,
    [currentBets],
  );

  const platformDeposits = useMemo(
    () =>
      transactions
        .filter((t) => t.type === "deposit" && t.status === "success")
        .reduce((s, t) => s + t.amount, 0),
    [transactions],
  );
  const platformWithdrawals = useMemo(
    () =>
      transactions
        .filter((t) => t.type === "withdrawal" && t.status === "success")
        .reduce((s, t) => s + t.amount, 0),
    [transactions],
  );

  if (usersLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white p-4 sm:p-6">
      <div className="max-w-[1600px] mx-auto space-y-6">
        <header className="flex flex-wrap gap-3 justify-between items-center border-b border-zinc-800 pb-4">
          <h1 className="text-2xl sm:text-3xl font-black tracking-tighter">
            ADMIN <span className="text-primary">CONTROL</span>
          </h1>
          <div className="flex flex-wrap gap-3">
            <div className="px-4 py-2 bg-zinc-900 rounded-lg border border-zinc-800">
              <span className="text-xs text-zinc-500 block">STATUS</span>
              <span className="font-bold uppercase text-primary">
                {gameState.status}
              </span>
            </div>
            <div className="px-4 py-2 bg-zinc-900 rounded-lg border border-zinc-800">
              <span className="text-xs text-zinc-500 block">MULTIPLIER</span>
              <span className="font-bold font-mono text-primary">
                {gameState.multiplier.toFixed(2)}x
              </span>
            </div>
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Live Canvas & Stats */}
          <div className="lg:col-span-8 space-y-6">
            <Card className="bg-zinc-900 border-zinc-800 overflow-hidden">
              <CardHeader className="border-b border-zinc-800 bg-zinc-900/50 p-4">
                <CardTitle className="text-sm font-bold flex items-center gap-2">
                  <Activity className="w-4 h-4 text-primary" /> LIVE CANVAS VIEW
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <GameCanvas gameState={gameState} />
              </CardContent>
            </Card>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatCard label="Round Bets" value={formatKsh(totalBetsCents)} />
              <StatCard
                label="Round Payout"
                value={formatKsh(totalPayoutCents)}
                tone="primary"
              />
              <StatCard
                label="Total Deposits"
                value={formatKsh(platformDeposits)}
                tone="success"
              />
              <StatCard
                label="Total Withdrawals"
                value={formatKsh(platformWithdrawals)}
                tone="danger"
              />
            </div>

            {/* Pending withdrawals */}
            <Card className="bg-zinc-900 border-zinc-800">
              <CardHeader className="border-b border-zinc-800 bg-zinc-900/50 p-4 flex flex-row items-center justify-between">
                <CardTitle className="text-sm font-bold flex items-center gap-2">
                  <ShieldAlert className="w-4 h-4 text-yellow-400" /> PENDING WITHDRAWALS
                </CardTitle>
                <span className="text-xs text-zinc-500">
                  {pendingWithdrawals.length}
                </span>
              </CardHeader>
              <CardContent className="p-0 max-h-[300px] overflow-y-auto">
                {pendingWithdrawals.length === 0 && (
                  <div className="p-4 text-xs text-zinc-500">
                    No pending withdrawals.
                  </div>
                )}
                {pendingWithdrawals.map((w) => (
                  <div
                    key={w.id}
                    className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 last:border-b-0"
                  >
                    <div>
                      <div className="text-sm font-bold">
                        {formatKsh(w.amount)}
                      </div>
                      <div className="text-[11px] text-zinc-500">
                        User #{w.userId} • {w.phone}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        className="h-7 text-[10px] bg-emerald-600 hover:bg-emerald-700"
                        onClick={() => settleWithdrawal.mutate(w.id)}
                      >
                        MARK PAID
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-[10px] border-red-700 text-red-400"
                        onClick={() => rejectWithdrawal.mutate(w.id)}
                      >
                        REJECT
                      </Button>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* Recent transactions */}
            <Card className="bg-zinc-900 border-zinc-800">
              <CardHeader className="border-b border-zinc-800 bg-zinc-900/50 p-4">
                <CardTitle className="text-sm font-bold flex items-center gap-2">
                  <Receipt className="w-4 h-4 text-primary" /> RECENT TRANSACTIONS
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0 max-h-[400px] overflow-y-auto">
                {transactions.slice(0, 50).map((t) => (
                  <div
                    key={t.id}
                    className="flex items-center justify-between px-4 py-2 border-b border-zinc-800/60 last:border-b-0 text-xs"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={`uppercase px-1.5 py-0.5 rounded text-[9px] font-bold ${
                          t.type === "deposit"
                            ? "bg-emerald-700/40 text-emerald-300"
                            : "bg-rose-700/40 text-rose-300"
                        }`}
                      >
                        {t.type}
                      </span>
                      <span className="font-bold">{formatKsh(t.amount)}</span>
                      <span className="text-zinc-500">U#{t.userId}</span>
                    </div>
                    <span
                      className={`text-[10px] uppercase font-bold ${
                        t.status === "success"
                          ? "text-emerald-400"
                          : t.status === "failed"
                            ? "text-rose-400"
                            : "text-yellow-400"
                      }`}
                    >
                      {t.status}
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          {/* Player Management */}
          <div className="lg:col-span-4 space-y-6">
            <Card className="bg-zinc-900 border-zinc-800 h-fit">
              <CardHeader className="border-b border-zinc-800 bg-zinc-900/50 p-4">
                <CardTitle className="text-sm font-bold flex items-center gap-2">
                  <Users className="w-4 h-4 text-primary" /> PLAYERS
                </CardTitle>
              </CardHeader>

              <CardContent className="p-3 space-y-3 max-h-[800px] overflow-y-auto">
                {users?.map((u: any) => (
                  <div
                    key={u.id}
                    className="p-3 rounded-lg bg-black/40 border border-zinc-800 space-y-3"
                  >
                    <div className="flex justify-between items-start">
                      <div>
                        <div className="font-bold text-white text-sm">
                          {u.username || u.phone || `Player #${u.id}`}
                          {u.isAdmin ? (
                            <span className="ml-2 text-[9px] uppercase text-yellow-400">
                              admin
                            </span>
                          ) : null}
                        </div>
                        <div className="text-[10px] text-zinc-500">
                          {u.phone || "no-phone"} • ID {u.id}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className={`h-6 px-2 text-[9px] ${
                          u.isBlocked
                            ? "border-emerald-700 text-emerald-400"
                            : "border-red-700 text-red-400"
                        }`}
                        onClick={() =>
                          blockMutation.mutate({
                            userId: u.id,
                            blocked: !u.isBlocked,
                          })
                        }
                      >
                        {u.isBlocked ? "UNBLOCK" : "BLOCK"}
                      </Button>
                    </div>

                    <div className="grid grid-cols-3 gap-2 text-[10px]">
                      <Stat label="Wallet" value={formatKsh(u.walletBalance ?? 0)} />
                      <Stat
                        label="Deposited"
                        value={formatKsh(u.totalDeposited ?? 0)}
                      />
                      <Stat
                        label="Wagered"
                        value={formatKsh(u.totalWagered ?? 0)}
                      />
                    </div>

                    <div className="grid grid-cols-5 gap-1">
                      {[10, 50, 100, 500, 1000].map((kshAmount) => (
                        <Button
                          key={kshAmount}
                          variant="outline"
                          className="h-6 text-[9px] p-0 border-zinc-700 hover:bg-zinc-800"
                          onClick={() =>
                            grantMutation.mutate({
                              userId: u.id,
                              amount: kshAmount,
                            })
                          }
                        >
                          +{kshAmount}
                        </Button>
                      ))}
                    </div>

                    <div className="flex gap-2">
                      <Input
                        type="number"
                        placeholder="Set wallet (KSH)"
                        className="h-7 text-xs bg-black border-zinc-700"
                        value={inputs[`${u.id}`] || ""}
                        onChange={(e) =>
                          setInputs({ ...inputs, [`${u.id}`]: e.target.value })
                        }
                      />
                      <Button
                        size="sm"
                        className="h-7 px-4 text-[10px] font-bold"
                        onClick={() => {
                          const val = parseFloat(inputs[`${u.id}`]);
                          if (!isNaN(val) && val >= 0) {
                            setBalanceMutation.mutate({
                              userId: u.id,
                              balance: toCents(val),
                            });
                            setInputs((prev) => ({ ...prev, [`${u.id}`]: "" }));
                          }
                        }}
                      >
                        SET
                      </Button>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "primary" | "success" | "danger";
}) {
  const color =
    tone === "primary"
      ? "text-primary"
      : tone === "success"
        ? "text-emerald-400"
        : tone === "danger"
          ? "text-rose-400"
          : "text-white";
  return (
    <Card className="bg-zinc-900 border-zinc-800">
      <CardHeader className="p-3">
        <CardTitle className="text-[10px] text-zinc-500 uppercase">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent className={`p-3 pt-0 text-lg sm:text-xl font-black ${color}`}>
        {value}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-zinc-900/60 rounded p-1.5 border border-zinc-800/50">
      <div className="text-[8px] text-zinc-500 uppercase">{label}</div>
      <div className="font-bold text-white text-[10px]">{value}</div>
    </div>
  );
}
