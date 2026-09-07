import { useCallback, useSyncExternalStore } from "react";

import {
  modelDownloadState,
  observeModelDownload,
} from "@/features/on-device-model/model-download";
import type { OnDeviceModelId } from "@/features/on-device-model/on-device-catalog";

/**
 * One model's download snapshot, as React state. `useSyncExternalStore` over
 * the download store — the store's `observe`/`modelDownloadState` pair IS a
 * subscribe/getSnapshot, and the hook form means every consumer gets the
 * tear-safe read instead of re-implementing the subscription (and its
 * render→effect gap) per call site. Lives beside the store it binds (the
 * `useResponsiveLayout` precedent), so a consumer imports one thing from the
 * feature that owns the state.
 */
export function useModelDownload(id: OnDeviceModelId) {
  const subscribe = useCallback(
    (listener: () => void) => observeModelDownload(id, listener),
    [id],
  );
  const getSnapshot = useCallback(() => modelDownloadState(id), [id]);
  return useSyncExternalStore(subscribe, getSnapshot);
}
