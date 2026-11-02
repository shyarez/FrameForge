"use client";

import { LogOut, UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import { auth } from "@/lib/client/api";
import type { PublicUser } from "@/lib/server/users";
import { IconButton } from "@/components/ui/primitives";

/** Signed-in email and a log-out button. */
export function UserMenu({ compact = false }: { compact?: boolean }) {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    auth.me().then((r) => !cancelled && setUser(r?.user ?? null));
    return () => {
      cancelled = true;
    };
  }, []);

  const logout = async () => {
    setBusy(true);
    await auth.logout().catch(() => undefined);
    // A full page load (not client navigation) so no previous user's state survives in kept-alive routes.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/login");
  };

  if (!user) return null;
  return (
    <div className="flex items-center gap-1.5">
      {!compact && (
        <span className="hidden max-w-48 items-center gap-1.5 truncate text-xs text-mute lg:flex" title={user.email}>
          <UserRound className="size-3.5 shrink-0" />
          <span className="truncate">{user.email}</span>
        </span>
      )}
      <IconButton label={`Log out (${user.email})`} onClick={() => void logout()} disabled={busy}>
        <LogOut className="size-4" />
      </IconButton>
    </div>
  );
}
