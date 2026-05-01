import React, { useState, useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useLocation } from "wouter";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Gift } from "lucide-react";

export default function AuthPage() {
  const [isLogin, setIsLogin] = useState(true);
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [referralCode, setReferralCode] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const { login, register, isLoggingIn, isRegistering, user } = useAuth();
  const [, setLocation] = useLocation();

  // Pre-fill referral code from URL ?ref=XXXX
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ref = params.get("ref");
    if (ref) {
      setReferralCode(ref.toUpperCase());
      setIsLogin(false);
    }
  }, []);

  useEffect(() => {
    if (user) setLocation("/");
  }, [user, setLocation]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phone || !password) return;
    try {
      if (isLogin) {
        await login({ phone, password });
      } else {
        await (register as Function)({ phone, password, referralCode: referralCode.trim() || undefined });
      }
    } catch {
      setPassword("");
    }
  };

  const isPending = isLoggingIn || isRegistering;

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-1/4 left-1/4 w-[500px] h-[500px] bg-primary/20 rounded-full blur-[120px] mix-blend-screen" />
        <div className="absolute bottom-1/4 right-1/4 w-[400px] h-[400px] bg-blue-500/20 rounded-full blur-[100px] mix-blend-screen" />
      </div>

      <div className="w-full max-w-sm bg-card/80 backdrop-blur-xl border border-white/10 rounded-3xl p-7 shadow-2xl relative z-10">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-black tracking-tighter text-primary text-glow mb-1">
            CRASH<span className="text-foreground">.BET</span>
          </h1>
          <p className="text-muted-foreground text-sm">
            {isLogin ? "Sign in with your M-Pesa number" : "Create your account — get KES 50 free"}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Phone */}
          <div className="space-y-1.5">
            <Label className="text-muted-foreground uppercase text-xs font-bold tracking-wider">
              M-Pesa Phone Number
            </Label>
            <Input
              type="tel"
              inputMode="numeric"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="bg-background/50 border-white/10 h-12 text-base focus-visible:ring-primary"
              placeholder="0712345678"
              autoComplete="tel"
              required
            />
            {!isLogin && (
              <p className="text-[11px] text-muted-foreground/70">
                Use the same number you'll deposit and withdraw with.
              </p>
            )}
          </div>

          {/* Password */}
          <div className="space-y-1.5 relative">
            <Label className="text-muted-foreground uppercase text-xs font-bold tracking-wider">
              Password
            </Label>
            <div className="relative">
              <Input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="bg-background/50 border-white/10 h-12 text-base focus-visible:ring-primary pr-12"
                placeholder="••••••••"
                autoComplete={isLogin ? "current-password" : "new-password"}
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-primary"
              >
                {showPassword ? "🙈" : "👁️"}
              </button>
            </div>
          </div>

          {/* Referral code — register only */}
          {!isLogin && (
            <div className="space-y-1.5">
              <Label className="text-muted-foreground uppercase text-xs font-bold tracking-wider flex items-center gap-1.5">
                <Gift className="w-3.5 h-3.5 text-primary" />
                Referral Code (optional)
              </Label>
              <Input
                type="text"
                value={referralCode}
                onChange={(e) => setReferralCode(e.target.value.toUpperCase())}
                className="bg-background/50 border-white/10 h-11 text-base focus-visible:ring-primary tracking-widest font-mono"
                placeholder="XXXXXX"
                maxLength={6}
              />
              <p className="text-[11px] text-emerald-400/80">
                Enter a friend's code to give them KES 50 too!
              </p>
            </div>
          )}

          <Button
            type="submit"
            disabled={isPending}
            className="w-full h-13 py-3.5 text-base font-bold uppercase tracking-widest bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl mt-2"
          >
            {isPending
              ? "Connecting…"
              : isLogin
              ? "Launch →"
              : "Create Account — Free KES 50"}
          </Button>
        </form>

        <div className="mt-6 text-center">
          <button
            type="button"
            onClick={() => setIsLogin(!isLogin)}
            className="text-sm text-muted-foreground hover:text-primary transition-colors"
          >
            {isLogin
              ? "Don't have an account? Register"
              : "Already have an account? Sign in"}
          </button>
        </div>

        {/* Trust badges */}
        <div className="mt-6 flex justify-center gap-4 text-[10px] text-muted-foreground/40">
          <span>🔒 Secure</span>
          <span>🇰🇪 M-Pesa</span>
          <span>⚡ Instant</span>
        </div>
      </div>

      {/* Footer */}
      <p className="fixed bottom-3 left-0 right-0 text-center text-[10px] text-muted-foreground/30">
        © {new Date().getFullYear()} Crash.Bet · 18+ · Play Responsibly
      </p>
    </div>
  );
}
