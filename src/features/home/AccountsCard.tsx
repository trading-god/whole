import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, StyleSheet, Text, View } from "react-native";

import { AccountGroupRow } from "@/features/accounts/AccountGroupRow";
import { AccountRow } from "@/features/accounts/AccountRow";
import {
  type AssetAccount,
  type AssetAccountGroup,
} from "@/features/assets/asset-repository";
import { type Currency } from "@/features/assets/currencies";
import { type ExchangeRates } from "@/features/assets/currency-conversion";
import { cardSurface } from "@/theme/screen-styles";
import { ACCOUNT_ROW_HEIGHT } from "@/theme/sizes";
import { COLORS } from "@/theme/colors";
import { FONT_SIZE } from "@/theme/typography";

type AccountsCardProps = {
  accounts: readonly AssetAccount[];
  groups: readonly AssetAccountGroup[];
  displayCurrency: Currency;
  rates: ExchangeRates;
  isBalanceHidden: boolean;
  isLoading: boolean;
  loadFailed: boolean;
  onOpenAccount: (id: string) => void;
  onRemove: (id: string) => void | Promise<void>;
};

// The accounts card on the home screen: ungrouped accounts as plain rows and
// grouped ones under collapsible group headers. The active-row and
// collapsed-group state is purely this card's UI state, so it lives here
// rather than in the screen.
export function AccountsCard({
  accounts,
  groups,
  displayCurrency,
  rates,
  isBalanceHidden,
  isLoading,
  loadFailed,
  onOpenAccount,
  onRemove,
}: AccountsCardProps) {
  const { t } = useTranslation();
  const [activeRowId, setActiveRowId] = useState<string | null>(null);
  // Collapsed group ids — empty by default means every group starts expanded.
  // Component state only (not persisted) for v1; the home screen resets to
  // expanded on each launch.
  const [collapsedGroupIds, setCollapsedGroupIds] = useState<
    ReadonlySet<string>
  >(() => new Set<string>());

  // Partitions accounts into ungrouped (rendered as plain rows, unchanged
  // from the pre-group layout) and grouped (rendered under a collapsible
  // AccountGroupRow header). Memoized so a cache-hot refocus — which hands
  // back the same accounts reference — doesn't re-partition and churn the
  // group list identity on every render.
  const { ungroupedAccounts, groupedAccounts } = useMemo(() => {
    const ungrouped: AssetAccount[] = [];
    const grouped = new Map<string, AssetAccount[]>();
    for (const account of accounts) {
      if (account.groupId) {
        const list = grouped.get(account.groupId);
        if (list) {
          list.push(account);
        } else {
          grouped.set(account.groupId, [account]);
        }
      } else {
        ungrouped.push(account);
      }
    }
    return { ungroupedAccounts: ungrouped, groupedAccounts: grouped };
  }, [accounts]);

  const toggleGroup = useCallback((groupId: string) => {
    setCollapsedGroupIds((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  }, []);

  // Removal failures surface as an alert; the row still closes afterwards —
  // only the deleted row, not a different row the user opened during the await.
  const handleRemove = useCallback(
    async (id: string) => {
      try {
        await onRemove(id);
      } catch {
        Alert.alert(t("home.deleteAccountError"));
      }
      // Close only the deleted row — a different row the user opened during
      // the await should stay open.
      setActiveRowId((current) => (current === id ? null : current));
    },
    [onRemove, t],
  );

  if (isLoading) {
    return (
      <View style={styles.accountsCard}>
        <View style={styles.accountsPlaceholder} />
      </View>
    );
  }

  if (loadFailed) {
    return (
      <View style={styles.accountsCard}>
        <View style={styles.accountStatus}>
          <Text style={styles.accountErrorText}>
            {t("home.accountLoadError")}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.accountsCard}>
      {ungroupedAccounts.map((account, index) => (
        <AccountRow
          key={account.id}
          account={account}
          displayCurrency={displayCurrency}
          rates={rates}
          isBalanceHidden={isBalanceHidden}
          isFirst={index === 0}
          isActive={activeRowId === account.id}
          onActivate={setActiveRowId}
          onOpenAccount={onOpenAccount}
          onRemove={handleRemove}
        />
      ))}
      {groups.map((group, groupIndex) => {
        const groupAccounts = groupedAccounts.get(group.id);
        // An empty group is kept in storage (the user may populate it
        // later) but hidden on the home screen.
        if (!groupAccounts || groupAccounts.length === 0) {
          return null;
        }
        // The group header draws a separator unless it's the very
        // first row in the card (no ungrouped accounts ahead of it).
        const isFirst = ungroupedAccounts.length === 0 && groupIndex === 0;
        const isExpanded = !collapsedGroupIds.has(group.id);
        return (
          <View key={group.id}>
            <AccountGroupRow
              group={group}
              accounts={groupAccounts}
              displayCurrency={displayCurrency}
              rates={rates}
              isBalanceHidden={isBalanceHidden}
              isExpanded={isExpanded}
              onToggle={() => toggleGroup(group.id)}
              isFirst={isFirst}
            />
            {isExpanded
              ? groupAccounts.map((account) => (
                  <AccountRow
                    key={account.id}
                    account={account}
                    displayCurrency={displayCurrency}
                    rates={rates}
                    isBalanceHidden={isBalanceHidden}
                    // Child rows are never the first row — the group
                    // header sits above them and provides separation.
                    isFirst={false}
                    isActive={activeRowId === account.id}
                    onActivate={setActiveRowId}
                    onOpenAccount={onOpenAccount}
                    onRemove={handleRemove}
                  />
                ))
              : null}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  accountsCard: {
    ...cardSurface,
    overflow: "hidden",
  },
  accountStatus: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "center",
    minHeight: ACCOUNT_ROW_HEIGHT,
  },
  // Invisible placeholder holding the accounts card's height while the local
  // accounts load (fast). Transparent so it blends with the card surface — no
  // skeleton/spinner flash — and ACCOUNT_ROW_HEIGHT matches a real row.
  accountsPlaceholder: {
    backgroundColor: "transparent",
    minHeight: ACCOUNT_ROW_HEIGHT,
  },
  accountErrorText: {
    color: COLORS.muted,
    fontSize: FONT_SIZE.eyebrow,
  },
});
