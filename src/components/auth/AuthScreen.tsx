"use client";

import { motion } from "motion/react";
import { Eye, EyeOff, LogIn, UserPlus } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { auth, safeNext } from "@/lib/client/api";
import { useOceanPhase } from "@/components/dashboard/OceanClock";
import { Wordmark } from "@/components/brand/Logo";
import { PixelOcean } from "@/components/pixel/PixelOcean";
import { Sprite } from "@/components/pixel/Sprite";
import { ArcadeLabel, Button, Field, TextInput } from "@/components/ui/primitives";

type Mode = "login" | "signup";

export function AuthScreen({ mode }: { mode: Mode }) {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const ocean = useOceanPhase();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const signup = mode === "signup";

  // Already signed in? Go straight on.
  useEffect(() => {
    let cancelled = false;
    auth.me().then((r) => !cancelled && r && router.replace(next));
    return () => {
      cancelled = true;
    };
  }, [router, next]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await (signup ? auth.register(email, password) : auth.login(email, password));
      router.replace(next);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  const other = signup ? `/login?next=${encodeURIComponent(next)}` : `/signup?next=${encodeURIComponent(next)}`;

  return (
    <main data-theme="dark" className="relative flex min-h-screen items-center justify-center overflow-hidden p-4 text-paper">
      <PixelOcean className="absolute inset-0 h-full w-full" palette={ocean.palette} />
      <motion.div
        initial={{ y: 24, opacity: 0, scale: 0.96 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        transition={{ type: "spring", stiffness: 320, damping: 24 }}
        className="px-box relative z-10 w-full max-w-sm bg-panel/95 p-7"
      >
        <div className="mb-6 flex items-center justify-between">
          <Wordmark />
          <Sprite name="fish" scale={3} className="animate-bob" />
        </div>
        <ArcadeLabel className="text-aqua-ink">{signup ? "New player" : "Welcome back"}</ArcadeLabel>
        <h1 className="mt-2 mb-6 font-display text-3xl font-bold">{signup ? "Create your account" : "Sign in"}</h1>

        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <Field label="Email">
            <TextInput type="email" autoComplete="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
          </Field>
          <Field label="Password">
            <div className="relative">
              <TextInput
                type={show ? "text" : "password"}
                autoComplete={signup ? "new-password" : "current-password"}
                required
                minLength={signup ? 8 : undefined}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="pr-9"
              />
              <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? "Hide password" : "Show password"}
                className="absolute top-1/2 right-2 -translate-y-1/2 text-mute hover:text-paper">
                {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </Field>
          {signup && <p className="-mt-2 text-[11px] text-mute">At least 8 characters.</p>}
          {error && (
            <p className="px-box-flat bg-coral/10 p-2.5 text-xs text-coral-ink [--px-c:var(--color-coral)]" role="alert">{error}</p>
          )}
          <Button variant="primary" type="submit" disabled={busy || !email || !password} className="mt-1 h-11">
            {signup ? <UserPlus className="size-4" /> : <LogIn className="size-4" />}
            {busy ? (signup ? "Creating account…" : "Signing in…") : signup ? "Create account" : "Sign in"}
          </Button>
        </form>

        <p className="mt-5 text-center text-sm text-mute">
          {signup ? "Already have an account? " : "New to FrameForge? "}
          <Link href={other} className="font-semibold text-aqua-ink underline-offset-2 hover:underline">
            {signup ? "Sign in" : "Create an account"}
          </Link>
        </p>
      </motion.div>
    </main>
  );
}
