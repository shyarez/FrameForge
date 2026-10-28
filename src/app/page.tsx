import { Suspense } from "react";
import { Dashboard } from "@/components/dashboard/Dashboard";

export default function Home() {
  return (
    <Suspense>
      <Dashboard />
    </Suspense>
  );
}
