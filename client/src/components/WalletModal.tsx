import React, { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@shared/routes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  X,
  ArrowDownToLine,
  ArrowUpFromLine,
  Loader2,
  Smartphone,
  CheckCircle2,
  XCircle,
  Clock,
  Wallet as WalletIcon,
  TrendingUp,
  TrendingDown,
  Shield,
  Zap,
} from "lucide-react";

const PHONE_KEY = "crash_wallet_phone";

function formatKsh(cents: number) {
  return Math.floor(cents / 100).toLocaleString("en-KE");
}

function formatPhoneInput(input: string) {
  const digits = input.replace(/\D/g, "").slice(0, 12);
  return digits;
}

interface WalletModalProps {
  open: boolean;
  onClose: () => void;
  initialTab?: Tab;
}

type Tab = "deposit" | "withdraw" | "history";

export function WalletModal({ open, onClose, initialTab = "deposit" }: WalletModalProps) {
  const [tab, setTab] = useState<Tab>(initialTab);

  useEffect(() => {
    if (open) setTab(initialTab);
  }, [open, initialTab]);

  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [amount, setAmount] = useState<string>("");
  const [phone, setPhone] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    return localStorage.getItem(PHONE_KEY) || "";
  });
  const [pendingTxId, setPendingTxId] = useState<number | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined" && phone)
      localStorage.setItem(PHONE_KEY, phone);
  }, [phone]);

  useEffect(() => {
    setAmount("");
  }, [tab]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const { data: wallet, refetch: refetchWallet } = useQuery({
    queryKey: [api.wallet.summary.path],
    queryFn: async () => {
      const res = await fetch(api.wallet.summary.path, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load wallet");
      return res.json();
    },
    enabled: open,
    refetchInterval: open ? 4000 : false,
  });

  const { data: txs = [], refetch: refetchTxs } = useQuery({
    queryKey: [api.wallet.transactions.path],
    queryFn: async () => {
      const res = await fetch(api.wallet.transactions.path, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: open,
    refetchInterval: open ? (pendingTxId ? 2500 : 6000) : false,
  });

  useEffect(() => {
    if (!pendingTxId) return;
    const tx = txs.find((t: any) => t.id === pendingTxId);
    if (!tx) return;
    if (tx.status === "success") {
      toast({ title: "Imeland 🔥", description: `KES ${formatKsh(tx.amount)} added to your wallet.` });
      setPendingTxId(null);
      refetchWallet();
    } else if (tx.status === "failed") {
      toast({ title: "Imebounce 😅", description: tx.failureReason || "Deposit didn't go through.", variant: "destructive" });
      setPendingTxId(null);
    }
  }, [txs, pendingTxId, toast, refetchWallet]);

  const depositMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(api.wallet.deposit.path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ amount: parseInt(amount, 10), phone: phone || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || "Deposit failed");
      return data;
    },
    onSuccess: (data: any) => {
      toast({
        title: "Inaleta push 📲",
        description: data.message || "Check your phone — enter your M-Pesa PIN to complete.",
      });
      setAmount("");
      if (data.transactionId) setPendingTxId(data.transactionId);
      refetchWallet();
      queryClient.invalidateQueries({ queryKey: [api.wallet.transactions.path] });
    },
    onError: (err: Error) => {
      toast({ title: "Imebounce 😅", description: err.message, variant: "destructive" });
    },
  });

  const withdrawMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(api.wallet.withdraw.path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ amount: parseInt(amount, 10), phone: phone || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || "Withdrawal failed");
      return data;
    },
    onSuccess: (data: any) => {
      toast({ title: "Withdrawal queued 💸", description: data.message || "You'll get the M-Pesa SMS shortly." });
      setAmount("");
      refetchWallet();
      queryClient.invalidateQueries({ queryKey: [api.wallet.transactions.path] });
    },
    onError: (err: Error) => {
      toast({ title: "Withdrawal failed", description: err.message, variant: "destructive" });
    },
  });

  const depositPresets = [50, 100, 200, 500, 1000, 2500];
  const withdrawPresets = [100, 500, 1000, 2000, 5000, 10000];
  const presets = tab === "deposit" ? depositPresets : withdrawPresets;

  if (!open) return null;

  const numericAmount = parseInt(amount, 10);
  const submitDisabled =
    !numericAmount ||
    numericAmount <= 0 ||
    (tab === "deposit" && depositMutation.isPending) ||
    (tab === "withdraw" && (withdrawMutation.isPending || (wallet && !wallet.canWithdraw)));

  return (
    <div
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-end sm:items-center justify-center sm:p-4"
      onClick={onClose}
      data-testid="wallet-overlay"
    >
      <div
        className="w-full sm:max-w-md bg-[#0d0f1a] border-t sm:border border-white/10 sm:rounded-3xl rounded-t-3xl shadow-2xl flex flex-col max-h-[92vh] sm:max-h-[90vh] animate-in slide-in-from-bottom-4 sm:zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Drag handle (mobile) */}
        <div className="sm:hidden flex justify-center pt-2 pb-1">
          <div className="w-10 h-1 rounded-full bg-white/20" />
        </div>

        {/* Header */}
        <div className="flex justify-between items-center px-5 pt-4 pb-2">
          <div className="flex items-center gap-2">
            <WalletIcon className="w-5 h-5 text-emerald-400" />
            <h2 className="text-xl font-black">Wallet</h2>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-2 -m-2" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-5 pb-6 overscroll-contain space-y-4">

          {/* ── Big balance card ── */}
          {wallet && (
            <div className="rounded-2xl overflow-hidden">
              <div className="bg-gradient-to-br from-emerald-500/25 via-emerald-500/10 to-blue-900/20 border border-emerald-500/20 p-5">
                <div className="text-[11px] uppercase tracking-wider text-emerald-400/70 font-bold">Available Balance</div>
                <div className="text-4xl font-black text-emerald-400 mt-1 font-mono">
                  KES {formatKsh(wallet.totalBalance)}
                </div>
                <div className="grid grid-cols-3 gap-3 mt-5">
                  <div className="bg-white/5 rounded-xl p-2.5 text-center">
                    <TrendingDown className="w-3.5 h-3.5 text-emerald-400 mx-auto mb-1" />
                    <div className="text-[9px] uppercase text-muted-foreground font-bold">Deposited</div>
                    <div className="text-xs font-bold font-mono mt-0.5">{formatKsh(wallet.totalDeposited)}</div>
                  </div>
                  <div className="bg-white/5 rounded-xl p-2.5 text-center">
                    <Zap className="w-3.5 h-3.5 text-yellow-400 mx-auto mb-1" />
                    <div className="text-[9px] uppercase text-muted-foreground font-bold">Wagered</div>
                    <div className="text-xs font-bold font-mono mt-0.5">{formatKsh(wallet.totalWagered)}</div>
                  </div>
                  <div className="bg-white/5 rounded-xl p-2.5 text-center">
                    <TrendingUp className="w-3.5 h-3.5 text-primary mx-auto mb-1" />
                    <div className="text-[9px] uppercase text-muted-foreground font-bold">Withdrawn</div>
                    <div className="text-xs font-bold font-mono mt-0.5">{formatKsh(wallet.totalWithdrawn)}</div>
                  </div>
                </div>
                {!wallet.wageringMet && wallet.wageringRemaining > 0 && (
                  <div className="mt-3 bg-yellow-500/10 border border-yellow-500/30 px-3 py-2 rounded-xl text-[11px] text-yellow-300">
                    Wager <b>KES {formatKsh(wallet.wageringRemaining)}</b> more to unlock withdrawals
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Pending banner */}
          {pendingTxId && (
            <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-3 flex items-center gap-3">
              <Loader2 className="w-4 h-4 animate-spin text-yellow-400 shrink-0" />
              <div className="text-xs text-yellow-200">
                <b>Inaleta push 📲</b> — finish the M-Pesa prompt on your phone. We'll auto-update when it lands.
              </div>
            </div>
          )}

          {/* ── Tab switcher ── */}
          <div className="flex gap-1 bg-white/5 p-1 rounded-2xl">
            {(["deposit", "withdraw", "history"] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                data-testid={`tab-${t}`}
                className={`flex-1 py-2.5 px-2 rounded-xl text-[11px] font-bold uppercase tracking-wide transition-all ${
                  tab === t
                    ? t === "deposit"
                      ? "bg-emerald-500 text-black shadow"
                      : t === "withdraw"
                      ? "bg-red-500 text-white shadow"
                      : "bg-primary text-primary-foreground shadow"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {t}
              </button>
            ))}
          </div>

          {/* ── DEPOSIT CARD ── */}
          {tab === "deposit" && (
            <div className="rounded-2xl border border-emerald-500/20 bg-gradient-to-b from-emerald-500/5 to-transparent overflow-hidden">
              <div className="px-4 py-3 border-b border-emerald-500/10 flex items-center gap-2">
                <ArrowDownToLine className="w-4 h-4 text-emerald-400" />
                <span className="font-bold text-sm text-emerald-400">Deposit via M-Pesa</span>
                <span className="ml-auto flex items-center gap-1 text-[10px] text-emerald-400/60">
                  <Zap className="w-3 h-3" /> Instant
                </span>
              </div>
              <div className="p-4 space-y-4">
                {/* Amount */}
                <div>
                  <Label className="text-[11px] uppercase text-muted-foreground font-bold">Amount (KES)</Label>
                  <div className="relative mt-1">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground font-bold text-lg">KES</span>
                    <Input
                      type="number"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder="0"
                      className="bg-background/60 h-14 text-2xl font-mono font-bold pl-16 border-emerald-500/20 focus:border-emerald-500/60"
                      data-testid="input-deposit-amount"
                    />
                  </div>
                  <div className="grid grid-cols-3 gap-2 mt-3">
                    {depositPresets.map((p) => (
                      <button
                        key={p}
                        onClick={() => setAmount(String(p))}
                        className={`text-sm font-bold py-2.5 rounded-xl transition-all border ${
                          amount === String(p)
                            ? "bg-emerald-500/20 border-emerald-500/50 text-emerald-400"
                            : "bg-white/5 border-white/5 hover:bg-emerald-500/10 hover:border-emerald-500/20"
                        }`}
                        data-testid={`preset-${p}`}
                      >
                        +{p.toLocaleString()}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Phone */}
                <div>
                  <Label className="text-[11px] uppercase text-muted-foreground font-bold flex items-center gap-1">
                    <Smartphone className="w-3 h-3" /> M-Pesa Number
                  </Label>
                  <Input
                    type="tel"
                    inputMode="numeric"
                    value={phone}
                    onChange={(e) => setPhone(formatPhoneInput(e.target.value))}
                    placeholder="0712345678"
                    className="bg-background/60 h-12 mt-1 font-mono border-emerald-500/20"
                    data-testid="input-deposit-phone"
                  />
                  <div className="text-[10px] text-muted-foreground mt-1">Leave blank to use your registered number.</div>
                </div>

                {/* Trust indicators */}
                <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                  <span className="flex items-center gap-1"><Shield className="w-3 h-3 text-emerald-400" /> Secure</span>
                  <span className="flex items-center gap-1">🇰🇪 M-Pesa</span>
                  <span className="flex items-center gap-1"><Zap className="w-3 h-3 text-yellow-400" /> Instant credit</span>
                </div>

                <button
                  onClick={() => depositMutation.mutate()}
                  disabled={!numericAmount || depositMutation.isPending}
                  className="w-full h-14 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed text-black font-black uppercase tracking-wide text-base rounded-2xl flex items-center justify-center gap-2 transition-all active:scale-[0.98] shadow-lg shadow-emerald-500/25"
                  data-testid="button-deposit"
                >
                  {depositMutation.isPending ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <>
                      <ArrowDownToLine className="w-5 h-5" />
                      Deposit {numericAmount ? `KES ${numericAmount.toLocaleString()}` : ""}
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* ── WITHDRAW CARD ── */}
          {tab === "withdraw" && (
            <div className="rounded-2xl border border-red-500/20 bg-gradient-to-b from-red-500/5 to-transparent overflow-hidden">
              <div className="px-4 py-3 border-b border-red-500/10 flex items-center gap-2">
                <ArrowUpFromLine className="w-4 h-4 text-red-400" />
                <span className="font-bold text-sm text-red-400">Withdraw to M-Pesa</span>
                <span className="ml-auto flex items-center gap-1 text-[10px] text-red-400/60">
                  <Clock className="w-3 h-3" /> Up to 24h
                </span>
              </div>
              <div className="p-4 space-y-4">
                {wallet?.withdrawBlockedReason && (
                  <div className="bg-yellow-500/10 border border-yellow-500/30 p-3 rounded-xl text-xs text-yellow-300">
                    {wallet.withdrawBlockedReason}
                  </div>
                )}

                {/* Amount */}
                <div>
                  <Label className="text-[11px] uppercase text-muted-foreground font-bold">Amount (KES)</Label>
                  <div className="relative mt-1">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground font-bold text-lg">KES</span>
                    <Input
                      type="number"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder="0"
                      className="bg-background/60 h-14 text-2xl font-mono font-bold pl-16 border-red-500/20 focus:border-red-500/60"
                      data-testid="input-withdraw-amount"
                    />
                  </div>
                  <div className="grid grid-cols-3 gap-2 mt-3">
                    {withdrawPresets.map((p) => (
                      <button
                        key={p}
                        onClick={() => setAmount(String(p))}
                        className={`text-sm font-bold py-2.5 rounded-xl transition-all border ${
                          amount === String(p)
                            ? "bg-red-500/20 border-red-500/50 text-red-400"
                            : "bg-white/5 border-white/5 hover:bg-red-500/10 hover:border-red-500/20"
                        }`}
                      >
                        {p.toLocaleString()}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Phone */}
                <div>
                  <Label className="text-[11px] uppercase text-muted-foreground font-bold flex items-center gap-1">
                    <Smartphone className="w-3 h-3" /> Send to
                  </Label>
                  <Input
                    type="tel"
                    inputMode="numeric"
                    value={phone}
                    onChange={(e) => setPhone(formatPhoneInput(e.target.value))}
                    placeholder="0712345678"
                    className="bg-background/60 h-12 mt-1 font-mono border-red-500/20"
                    data-testid="input-withdraw-phone"
                  />
                </div>

                {/* Limits */}
                {wallet && (
                  <div className="bg-white/5 rounded-xl p-3 space-y-1.5 text-[11px]">
                    <div className="flex justify-between text-muted-foreground">
                      <span>Daily limit remaining</span>
                      <span className="font-mono font-bold text-foreground">
                        KES {formatKsh(wallet.dailyRemaining)} / {formatKsh(wallet.dailyLimit)}
                      </span>
                    </div>
                    <div className="flex justify-between text-muted-foreground">
                      <span>Minimum withdrawal</span>
                      <span className="font-mono font-bold text-foreground">KES {formatKsh(wallet.minWithdrawal)}</span>
                    </div>
                    <div className="flex justify-between text-muted-foreground">
                      <span>Processing time</span>
                      <span className="font-bold text-foreground">Up to 24 hours</span>
                    </div>
                  </div>
                )}

                <button
                  onClick={() => withdrawMutation.mutate()}
                  disabled={submitDisabled}
                  className="w-full h-14 bg-red-500 hover:bg-red-400 disabled:opacity-50 disabled:cursor-not-allowed text-white font-black uppercase tracking-wide text-base rounded-2xl flex items-center justify-center gap-2 transition-all active:scale-[0.98] shadow-lg shadow-red-500/20"
                  data-testid="button-withdraw"
                >
                  {withdrawMutation.isPending ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <>
                      <ArrowUpFromLine className="w-5 h-5" />
                      Withdraw {numericAmount ? `KES ${numericAmount.toLocaleString()}` : ""}
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* ── HISTORY ── */}
          {tab === "history" && (
            <div className="space-y-2">
              {txs.length === 0 && (
                <div className="text-center text-muted-foreground text-sm py-12">
                  <Clock className="w-8 h-8 mx-auto mb-2 opacity-40" />
                  No transactions yet
                </div>
              )}
              {txs.map((tx: any) => {
                const isDeposit = tx.type === "deposit";
                const StatusIcon =
                  tx.status === "success" ? CheckCircle2 : tx.status === "failed" ? XCircle : Clock;
                const statusColor =
                  tx.status === "success" ? "text-emerald-400" : tx.status === "failed" ? "text-destructive" : "text-yellow-400";
                return (
                  <div
                    key={tx.id}
                    className="bg-white/5 p-3 rounded-xl border border-white/5 flex items-center justify-between gap-3"
                    data-testid={`tx-row-${tx.id}`}
                  >
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${isDeposit ? "bg-emerald-500/15" : "bg-red-500/15"}`}>
                      {isDeposit
                        ? <ArrowDownToLine className="w-4 h-4 text-emerald-400" />
                        : <ArrowUpFromLine className="w-4 h-4 text-red-400" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs uppercase font-bold capitalize">{tx.type}</div>
                      <div className="text-[10px] text-muted-foreground truncate">
                        {new Date(tx.createdAt).toLocaleString("en-KE", { dateStyle: "short", timeStyle: "short" })}
                        {tx.mpesaReceipt ? ` · ${tx.mpesaReceipt}` : ""}
                      </div>
                      {tx.failureReason && (
                        <div className="text-[10px] text-destructive truncate">{tx.failureReason}</div>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <div className={`font-mono font-bold text-sm ${isDeposit ? "text-emerald-400" : "text-red-400"}`}>
                        {isDeposit ? "+" : "−"}{formatKsh(tx.amount)}
                      </div>
                      <div className={`text-[10px] uppercase font-bold flex items-center justify-end gap-1 ${statusColor}`}>
                        <StatusIcon className="w-3 h-3" />
                        {tx.status}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
