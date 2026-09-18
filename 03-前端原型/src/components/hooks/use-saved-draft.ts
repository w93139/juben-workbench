"use client";

import { useState } from "react";

// Follow saved data until this form has local edits. Once edited, retain its
// snapshot until an explicit successful save; the action keeps its revision.
export function useSavedDraft<T>(value: T, initialDraft?: T) {
  const signature = JSON.stringify(value);
  const [state, setState] = useState({ signature, value: initialDraft ?? value, dirty: initialDraft !== undefined });
  if (!state.dirty && state.signature !== signature) setState({ signature, value, dirty: false });
  return {
    draft: !state.dirty && state.signature !== signature ? value : state.value,
    change: (next: T) => setState({ signature, value: next, dirty: true }),
    saved: () => setState((previous) => ({ ...previous, dirty: false })),
    reset: () => setState({ signature, value, dirty: false }),
  };
}
