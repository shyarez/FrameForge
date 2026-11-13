import { Suspense } from "react";
import { AuthScreen } from "@/components/auth/AuthScreen";

export const metadata = { title: "Sign in · FrameForge Studio" };

export default function LoginPage() {
  return (
    <Suspense>
      <AuthScreen mode="login" />
    </Suspense>
  );
}
