"use client";

import { useEffect, useState } from "react";
import { z } from "zod";
import type { ManagerMutation, ManagerSnapshot } from "@/lib/manager";
import { managerSnapshotSchema } from "@/lib/manager";
import { apiErrorMessage, caughtErrorMessage } from "./api-error";

export function useManager() {
  const [snapshot, setSnapshot] = useState<ManagerSnapshot>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;

    async function loadSnapshot() {
      try {
        const response = await fetch("/api/manager", { cache: "no-store" });
        const body = z.unknown().parse(await response.json());
        if (!response.ok) {
          throw new Error(apiErrorMessage(body) ?? "Manager request failed.");
        }
        if (active) setSnapshot(managerSnapshotSchema.parse(body));
      } catch (refreshError) {
        if (active) {
          setError(
            caughtErrorMessage(refreshError) ?? "Manager request failed."
          );
        }
      }
    }

    void loadSnapshot();

    return () => {
      active = false;
    };
  }, []);

  const mutate = async (mutation: ManagerMutation) => {
    setBusy(true);
    setError(undefined);
    try {
      const response = await fetch("/api/manager", {
        body: JSON.stringify(mutation),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const body = z.unknown().parse(await response.json());
      if (!response.ok) {
        throw new Error(apiErrorMessage(body) ?? "Manager request failed.");
      }
      setSnapshot(managerSnapshotSchema.parse(body));
      return true;
    } catch (mutationError) {
      setError(caughtErrorMessage(mutationError) ?? "Manager request failed.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  return { busy, error, mutate, snapshot };
}
