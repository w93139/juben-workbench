import { localJson } from "./studio-client";
import type { AuthorMemoryItem } from "@/domain/author-memory";

export interface MemoryList { items: AuthorMemoryItem[]; count: number; enabled: number; limit: number }

export const fetchMemory = () => localJson("/api/studio/memory", { cache: "no-store" }) as Promise<MemoryList>;
