"use client";

import { useParams } from "next/navigation";
import { EditorApp } from "@/components/editor/EditorApp";

export function EditorRoute() {
  const { id } = useParams<{ id: string }>();
  return <EditorApp projectId={id} />;
}
