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

  // Sync the active tab whenever the parent re-opens the modal with a
  // different default tab (e.g. clicking Deposit vs Withdraw button).
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

  // Persist phone for next time
  useEffect(() => {
    if (typeof window !== "undefined" && phone)
      localStorage.setItem(PHONE_KEY, phone);
  }, [phone]);

  // Reset amount when changing tabs
  useEffect(() => {
    setAmount("");
  }, [tab]);

  // Lock body scroll when open (mobile)
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
      const res = await fetch(api.wallet.transactions.path, {
        credentials: "include",
      });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: open,
    // Poll faster while a transaction is pending so users see updates fast
    refetchInterval: open ? (pendingTxId ? 2500 : 6000) : false,
  });

  // Track resolution of the most recent deposit so we can toast when it lands
  useEffect(() => {
    if (!pendingTxId) return;
    const tx = txs.find((t: any) => t.id === pendingTxId);
    if (!tx) return;
    if (tx.status === "success") {
      toast({
        title: "Imeland 🔥",
        description: `KES ${formatKsh(tx.amount)} added to your wallet.`,
      });
      setPendingTxId(null);
      refetchWallet();
    } else if (tx.status === "failed") {
      toast({
        title: "Imebounce 😅",
        description: tx.failureReason || "Deposit didn't go through.",
        variant: "destructive",
      });
      setPendingTxId(null);
    }
  }, [txs, pendingTxId, toast, refetchWallet]);

  const depositMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(api.wallet.deposit.path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          amount: parseInt(amount, 10),
          phone: phone || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || "Deposit failed");
      return data;
    },
    onSuccess: (data: any) => {
      toast({
        title: "Inaleta push 📲",
        description:
          data.message ||
          "Check your phone — enter your M-Pesa PIN to complete the deposit.",
      });
      setAmount("");
      if (data.transactionId) setPendingTxId(data.transactionId);
      refetchWallet();
      queryClient.invalidateQueries({ queryKey: [api.wallet.transactions.path] });
    },
    onError: (err: Error) => {
      toast({
        title: "Imebounce 😅",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const withdrawMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(api.wallet.withdraw.path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          amount: parseInt(amount, 10),
          phone: phone || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || "Withdrawal failed");
      return data;
    },
    onSuccess: (data: any) => {
      toast({
        title: "Withdrawal queued 💸",
        description: data.message || "You'll get the M-Pesa SMS shortly.",
      });
      setAmount("");
      refetchWallet();
      queryClient.invalidateQueries({ queryKey: [api.wallet.transactions.path] });
    },
    onError: (err: Error) => {
      toast({
        title: "Withdrawal failed",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const presets = useMemo(
    () =>
      tab === "deposit"
        ? [50, 100, 500, 1000, 2500, 5000]
        : [100, 500, 1000, 5000, 10000, 20000],
    [tab],
  );

  if (!open) return null;

  const numericAmount = parseInt(amount, 10);
  const submitDisabled =
    !numericAmount ||
    numericAmount <= 0 ||
    (tab === "deposit" && depositMutation.isPending) ||
    (tab === "withdraw" &&
      (withdrawMutation.isPending || (wallet && !wallet.canWithdraw)));

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center sm:p-4"
      onClick={onClose}
      data-testid="wallet-overlay"
    >
      <div
        className="w-full sm:max-w-md bg-card border-t sm:border border-white/10 sm:rounded-3xl rounded-t-3xl shadow-2xl flex flex-col max-h-[92vh] sm:max-h-[90vh] animate-in slide-in-from-bottom-4 sm:zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Drag handle (mobile) */}
        <div className="sm:hidden flex justify-center pt-2 pb-1">
          <div className="w-10 h-1 rounded-full bg-white/20" />
        </div>

        {/* Header */}
        <div className="flex justify-between items-center px-5 pt-3 pb-3 sm:pt-5">
          <div className="flex items-center gap-2">
            <WalletIcon className="w-5 h-5 text-success" />
            <h2 className="text-xl font-black text-glow">Wallet</h2>
          </div>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground p-2 -m-2"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-5 pb-5 overscroll-contain">
          {/* Big balance card */}
          {wallet && (
            <div className="rounded-2xl p-4 mb-4 bg-gradient-to-br from-success/20 via-success/5 to-transparent border border-success/20">
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Available balance
              </div>
              <div className="text-3xl font-black text-success mt-1 font-mono">
                KES {formatKsh(wallet.totalBalance)}
              </div>
              <div className="grid grid-cols-3 gap-2 mt-4 text-center">
                <div>
                  <div className="text-[10px] uppercase text-muted-foreground">
                    Deposited
                  </div>
                  <div className="text-sm font-bold font-mono">
                    {formatKsh(wallet.totalDeposited)}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase text-muted-foreground">
                    Wagered
                  </div>
                  <div className="text-sm font-bold font-mono">
                    {formatKsh(wallet.totalWagered)}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase text-muted-foreground">
                    Withdrawn
                  </div>
                  <div className="text-sm font-bold font-mono">
                    {formatKsh(wallet.totalWithdrawn)}
                  </div>
                </div>
              </div>
              {!wallet.wageringMet && wallet.wageringRemaining > 0 && (
                <div className="mt-3 bg-yellow-500/10 border border-yellow-500/30 px-3 py-2 rounded-xl text-[11px] text-yellow-300">
                  Wager <b>KES {formatKsh(wallet.wageringRemaining)}</b> more to
                  unlock withdrawals
                </div>
              )}
            </div>
          )}

          {/* Pending banner */}
          {pendingTxId && (
            <div className="mb-4 bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-3 flex items-center gap-3">
              <Loader2 className="w-4 h-4 animate-spin text-yellow-400 shrink-0" />
              <div className="text-xs text-yellow-200">
                <b>Inaleta push 📲</b> — finish the M-Pesa prompt on your phone.
                We'll auto-update when it lands.
              </div>
            </div>
          )}

          {/* Tabs */}
          <div className="flex gap-1 mb-4 bg-background/60 p-1 rounded-xl sticky top-0">
            {(["deposit", "withdraw", "history"] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`flex-1 py-2.5 px-3 rounded-lg text-[11px] font-bold uppercase tracking-wide transition-all ${
                  tab === t
                    ? "bg-primary text-primary-foreground shadow"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                data-testid={`tab-${t}`}
              >
                {t}
              </button>
            ))}
          </div>

          {tab === "deposit" && (
            <div className="space-y-4">
              <div>
                <Label className="text-[11px] uppercase text-muted-foreground">
                  Amount (KES)
                </Label>
                <Input
                  type="number"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="100"
                  className="bg-background/60 h-14 text-2xl font-mono font-bold mt-1"
                  data-testid="input-deposit-amount"
                />
                <div className="grid grid-cols-3 gap-2 mt-3">
                  {presets.map((p) => (
                    <button
                      key={p}
                      onClick={() => setAmount(String(p))}
                      className="text-sm font-bold py-2.5 rounded-lg bg-muted/60 hover:bg-muted active:scale-95 transition-all"
                      data-testid={`preset-${p}`}
                    >
                      +{p.toLocaleString()}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <Label className="text-[11px] uppercase text-muted-foreground flex items-center gap-1">
                  <Smartphone className="w-3 h-3" /> M-Pesa phone
                </Label>
                <Input
                  type="tel"
                  inputMode="numeric"
                  value={phone}
                  onChange={(e) => setPhone(formatPhoneInput(e.target.value))}
                  placeholder="0712345678"
                  className="bg-background/60 h-12 mt-1 font-mono"
                  data-testid="input-deposit-phone"
                />
                <div className="text-[10px] text-muted-foreground mt-1">
                  Saved on this device. Leave blank to use your account number.
                </div>
              </div>

              <Button
                onClick={() => depositMutation.mutate()}
                disabled={!numericAmount || depositMutation.isPending}
                className="w-full h-14 bg-success hover:bg-success/90 text-success-foreground font-black uppercase tracking-wide text-base rounded-2xl"
                data-testid="button-deposit"
              >
                {depositMutation.isPending ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <>
                    <ArrowDownToLine className="w-5 h-5 mr-2" />
                    Deposit {numericAmount ? `KES ${numericAmount}` : ""}
                  </>
                )}
              </Button>
            </div>
          )}

          {tab === "withdraw" && (
            <div className="space-y-4">
              {wallet?.withdrawBlockedReason && (
                <div className="bg-yellow-500/10 border border-yellow-500/30 p-3 rounded-xl text-xs text-yellow-300">
                  {wallet.withdrawBlockedReason}
                </div>
              )}

              <div>
                <Label className="text-[11px] uppercase text-muted-foreground">
                  Amount (KES)
                </Label>
                <Input
                  type="number"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="500"
                  className="bg-background/60 h-14 text-2xl font-mono font-bold mt-1"
                  data-testid="input-withdraw-amount"
                />
                <div className="grid grid-cols-3 gap-2 mt-3">
                  {presets.map((p) => (
                    <button
                      key={p}
                      onClick={() => setAmount(String(p))}
                      className="text-sm font-bold py-2.5 rounded-lg bg-muted/60 hover:bg-muted active:scale-95 transition-all"
                    >
                      {p.toLocaleString()}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <Label className="text-[11px] uppercase text-muted-foreground flex items-center gap-1">
                  <Smartphone className="w-3 h-3" /> Send to
                </Label>
                <Input
                  type="tel"
                  inputMode="numeric"
                  value={phone}
                  onChange={(e) => setPhone(formatPhoneInput(e.target.value))}
                  placeholder="0712345678"
                  className="bg-background/60 h-12 mt-1 font-mono"
                  data-testid="input-withdraw-phone"
                />
              </div>

              {wallet && (
                <div className="text-[11px] text-muted-foreground bg-background/40 rounded-xl p-3 space-y-1">
                  <div className="flex justify-between">
                    <span>Daily limit left</span>
                    <span className="font-mono">
                      KES {formatKsh(wallet.dailyRemaining)} /{" "}
                      {formatKsh(wallet.dailyLimit)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Minimum withdrawal</span>
                    <span className="font-mono">
                      KES {formatKsh(wallet.minWithdrawal)}
                    </span>
                  </div>
                </div>
              )}

              <Button
                onClick={() => withdrawMutation.mutate()}
                disabled={submitDisabled}
                className="w-full h-14 bg-primary hover:bg-primary/90 text-primary-foreground font-black uppercase tracking-wide text-base rounded-2xl"
                data-testid="button-withdraw"
              >
                {withdrawMutation.isPending ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <>
                    <ArrowUpFromLine className="w-5 h-5 mr-2" />
                    Withdraw {numericAmount ? `KES ${numericAmount}` : ""}
                  </>
                )}
              </Button>
            </div>
          )}

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
                  tx.status === "success"
                    ? CheckCircle2
                    : tx.status === "failed"
                      ? XCircle
                      : Clock;
                const statusColor =
                  tx.status === "success"
                    ? "text-success"
                    : tx.status === "failed"
                      ? "text-destructive"
                      : "text-yellow-400";
                return (
                  <div
                    key={tx.id}
                    className="bg-background/50 p-3 rounded-xl border border-white/5 flex items-center justify-between gap-3"
                    data-testid={`tx-row-${tx.id}`}
                  >
                    <div
                      className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
                        isDeposit ? "bg-success/15" : "bg-primary/15"
                      }`}
                    >
                      {isDeposit ? (
                        <ArrowDownToLine className="w-4 h-4 text-success" />
                      ) : (
                        <ArrowUpFromLine className="w-4 h-4 text-primary" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs uppercase font-bold capitalize">
                        {tx.type}
                      </div>
                      <div className="text-[10px] text-muted-foreground truncate">
                        {new Date(tx.createdAt).toLocaleString("en-KE", {
                          dateStyle: "short",
                          timeStyle: "short",
                        })}
                        {tx.mpesaReceipt ? ` · ${tx.mpesaReceipt}` : ""}
                      </div>
                      {tx.failureReason && (
                        <div className="text-[10px] text-destructive truncate">
                          {tx.failureReason}
                        </div>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-mono font-bold text-sm">
                        {isDeposit ? "+" : "−"}
                        {formatKsh(tx.amount)}
                      </div>
                      <div
                        className={`text-[10px] uppercase font-bold flex items-center justify-end gap-1 ${statusColor}`}
                      >
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
