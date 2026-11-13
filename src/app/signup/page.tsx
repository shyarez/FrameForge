import { Suspense } from "react";
import { AuthScreen } from "@/components/auth/AuthScreen";

export const metadata = { title: "Create account · FrameForge Studio" };

export default function SignupPage() {
  return (
    <Suspense>
      <AuthScreen mode="signup" />
    </Suspense>
  );
}
