"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { BrowserStorage, STORAGE_KEY } from "@/services/browser-storage";
import { LocalProjectService } from "@/services/local-project-service";
import { BrowserOutputDirectories } from "@/services/browser-output-directories";
import { browserProjectDeletion } from "@/services/workbench-store";
import type { LocalProjectPort } from "@/services/contracts";

const ServiceContext = createContext<LocalProjectPort | null>(null);

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 } } }));
  const [service] = useState(() => new LocalProjectService(new BrowserStorage(), undefined, undefined, new BrowserOutputDirectories(), browserProjectDeletion));
  useEffect(() => {
    const refresh = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY || event.key === null) void client.invalidateQueries();
    };
    window.addEventListener("storage", refresh);
    return () => window.removeEventListener("storage", refresh);
  }, [client]);
  return <ServiceContext.Provider value={service}><QueryClientProvider client={client}>{children}</QueryClientProvider></ServiceContext.Provider>;
}

export function useService() {
  const service = useContext(ServiceContext);
  if (!service) throw new Error("Service provider missing");
  return service;
}

export function useProject(id: string) {
  const service = useService();
  return useQuery({ queryKey: ["project", id], queryFn: () => service.get(id) });
}
