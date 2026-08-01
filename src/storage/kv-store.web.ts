import AsyncStorage from "@react-native-async-storage/async-storage";

// Web override of the sqlite-backed kv-store. expo-sqlite's web backend needs
// extra bundler and cross-origin-isolation setup, which isn't worth it while
// the web build is on hold — so web keeps using AsyncStorage, preserving
// today's behavior. See `kv-store.ts` for the native implementation.
export const getItem = (key: string): Promise<string | null> =>
  AsyncStorage.getItem(key);

export const setItem = (key: string, value: string): Promise<void> =>
  AsyncStorage.setItem(key, value);

export const removeItem = (key: string): Promise<void> =>
  AsyncStorage.removeItem(key);

// AsyncStorage has no transaction primitive, and the web build is on hold, so
// run the work sequentially. The native sqlite path is where atomicity matters
// for migration correctness (see kv-store.ts).
export const withTransaction = async (
  work: () => Promise<void>,
): Promise<void> => {
  await work();
};
