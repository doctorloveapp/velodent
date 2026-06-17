import { invoke } from "@tauri-apps/api/core";
import type { L10nKey, TFunction } from "@/frontend/shared/i18n/L10nProvider";

export interface HealthStatus {
  status: "checking" | "ready" | "degraded";
  message: string;
}

interface TauriHealthResponse {
  status: "ready";
  message_key: L10nKey;
}

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

export async function getHealthStatus(t: TFunction): Promise<HealthStatus> {
  if (!window.__TAURI_INTERNALS__) {
    return {
      status: "ready",
      message: t("healthReady")
    };
  }

  try {
    const response = await invoke<TauriHealthResponse>("health_check");

    return {
      status: response.status,
      message: t(response.message_key)
    };
  } catch {
    return {
      status: "degraded",
      message: t("healthDegraded")
    };
  }
}
