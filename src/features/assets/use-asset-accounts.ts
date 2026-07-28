import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";

import {
  type AssetAccount,
  listAssetAccounts,
} from "@/features/assets/asset-repository";

type AssetAccountsState = {
  accounts: readonly AssetAccount[];
  error: boolean;
  isLoading: boolean;
};

const initialAssetAccountsState: AssetAccountsState = {
  accounts: [],
  error: false,
  isLoading: true,
};

export function useAssetAccounts() {
  const [state, setState] = useState(initialAssetAccountsState);

  useFocusEffect(
    useCallback(() => {
      let isActive = true;

      void listAssetAccounts()
        .then((accounts) => {
          if (isActive) {
            setState({
              accounts,
              error: false,
              isLoading: false,
            });
          }
        })
        .catch(() => {
          if (isActive) {
            setState((currentState) => ({
              ...currentState,
              error: true,
              isLoading: false,
            }));
          }
        });

      return () => {
        isActive = false;
      };
    }, []),
  );

  return state;
}
