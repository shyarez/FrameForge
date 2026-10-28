"use client";

import { useState } from "react";

/**
 * Local editable copy of an external value that resets when the external value changes
 * (React's "adjust state during render" pattern — no effect, no cascading render).
 */
export function useDraft<T>(value: T): [T, (v: T) => void] {
  const [draft, setDraft] = useState(value);
  const [source, setSource] = useState(value);
  if (!Object.is(source, value)) {
    setSource(value);
    setDraft(value);
  }
  return [draft, setDraft];
}
