import { Suspense } from "react";
import { EditorRoute } from "./EditorRoute";

export default function EditorPage() {
  return (
    <Suspense fallback={<main className="flex h-screen items-center justify-center text-mute">Loading editor…</main>}>
      <EditorRoute />
    </Suspense>
  );
}
