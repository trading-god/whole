import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Button } from "@/components/Button";
import { FieldShell } from "@/components/FieldShell";
import { FormField } from "@/components/FormField";
import { Icon } from "@/components/Icon";
import { optionSheetStyles } from "@/components/option-sheet-styles";
import { ScrimModal } from "@/components/ScrimModal";
import { type AssetAccountGroup } from "@/features/assets/asset-repository";
import { COLORS } from "@/theme/colors";
import { PRESSED_OPACITY_SURFACE } from "@/theme/interaction";
import { scrimCardBase } from "@/theme/screen-styles";
import { CHIP_RADIUS } from "@/theme/sizes";
import { SPACING } from "@/theme/spacing";
import { FONT_SIZE, FONT_WEIGHT } from "@/theme/typography";

type InstitutionPickerProps = {
  institutions: readonly AssetAccountGroup[];
  // "" means no institution; a group id means membership.
  selectedInstitutionId: string;
  onChange: (id: string) => void;
  // When provided, the option sheet offers "Create institution…", which
  // switches to an inline name field. The parent creates the group and returns
  // its new id, which becomes the selection.
  onCreate?: (name: string) => Promise<string | undefined>;
};

// The institution selector for the account form. Renders a form-styled trigger
// (body-size text matching the other fields, not the eyebrow-size capsule
// `OptionPicker` uses) plus an option sheet with: no institution, each
// existing institution, and a "create institution…" entry that reveals an
// inline name field — so an unrecognized institution can be named by hand
// without leaving the form.
export function InstitutionPicker({
  institutions,
  selectedInstitutionId,
  onChange,
  onCreate,
}: InstitutionPickerProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");

  const selected = institutions.find(
    (institution) => institution.id === selectedInstitutionId,
  );
  const triggerLabel = selected ? selected.name : t("accountForm.noGroup");

  const handleConfirmCreate = async () => {
    const name = newName.trim();
    if (!name || !onCreate) {
      return;
    }
    const id = await onCreate(name);
    if (id) {
      onChange(id);
    }
    setOpen(false);
    setCreating(false);
    setNewName("");
  };

  return (
    <FieldShell label={t("accountForm.group")}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("accountForm.group")}
        accessibilityValue={{ text: triggerLabel }}
        onPress={() => {
          setCreating(false);
          setOpen(true);
        }}
        style={({ pressed }) => [
          styles.trigger,
          pressed && { opacity: PRESSED_OPACITY_SURFACE },
        ]}
      >
        <Text numberOfLines={1} style={styles.triggerText}>
          {triggerLabel}
        </Text>
        <Icon name="chevron-down" size="sm" color={COLORS.muted} />
      </Pressable>

      <ScrimModal
        accessibilityLabel={t("accountForm.group")}
        onDismiss={() => {
          setOpen(false);
          setCreating(false);
        }}
        visible={open}
        cardStyle={styles.card}
      >
        {creating ? (
          <View>
            <FormField
              label={t("accountForm.groupName")}
              onChangeText={setNewName}
              placeholder={t("accountForm.newGroupPlaceholder")}
              value={newName}
            />
            <View style={styles.createActions}>
              <Button
                size="sm"
                variant="ghost"
                onPress={() => {
                  setCreating(false);
                  setNewName("");
                }}
              >
                {t("common.cancel")}
              </Button>
              <Button
                size="sm"
                variant="primary"
                disabled={!newName.trim()}
                onPress={() => void handleConfirmCreate()}
              >
                {t("accountForm.createGroup")}
              </Button>
            </View>
          </View>
        ) : (
          <View>
            <Pressable
              accessibilityRole="radio"
              accessibilityState={{ selected: selectedInstitutionId === "" }}
              onPress={() => {
                onChange("");
                setOpen(false);
              }}
              style={({ pressed }) => [
                optionSheetStyles.option,
                selectedInstitutionId === "" &&
                  optionSheetStyles.optionSelected,
                pressed && optionSheetStyles.optionPressed,
              ]}
            >
              <Text
                style={[
                  optionSheetStyles.optionText,
                  selectedInstitutionId === "" &&
                    optionSheetStyles.optionTextSelected,
                ]}
              >
                {t("accountForm.noGroup")}
              </Text>
            </Pressable>
            {institutions.map((institution) => {
              const isSelected = institution.id === selectedInstitutionId;
              return (
                <Pressable
                  key={institution.id}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: isSelected }}
                  onPress={() => {
                    onChange(institution.id);
                    setOpen(false);
                  }}
                  style={({ pressed }) => [
                    optionSheetStyles.option,
                    isSelected && optionSheetStyles.optionSelected,
                    pressed && optionSheetStyles.optionPressed,
                  ]}
                >
                  <Text
                    style={[
                      optionSheetStyles.optionText,
                      isSelected && optionSheetStyles.optionTextSelected,
                    ]}
                    numberOfLines={1}
                  >
                    {institution.name}
                  </Text>
                  {isSelected ? (
                    <Icon name="check" size="sm" color={COLORS.brand} />
                  ) : null}
                </Pressable>
              );
            })}
            {onCreate ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => setCreating(true)}
                style={({ pressed }) => [
                  optionSheetStyles.option,
                  pressed && optionSheetStyles.optionPressed,
                ]}
              >
                <Text style={styles.createOptionText}>
                  {t("accountForm.createGroup")}
                </Text>
              </Pressable>
            ) : null}
          </View>
        )}
      </ScrimModal>
    </FieldShell>
  );
}

const styles = StyleSheet.create({
  // Form-styled trigger: body-size text matching the other form fields (name,
  // balance, type), not the eyebrow-size capsule OptionPicker uses. Sized to
  // sit beside the other fields without raising the row height.
  trigger: {
    alignItems: "center",
    backgroundColor: COLORS.surfaceMuted,
    borderRadius: CHIP_RADIUS,
    flexDirection: "row",
    gap: 2,
    justifyContent: "space-between",
    minHeight: 44,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
  },
  triggerText: {
    color: COLORS.ink,
    flexShrink: 1,
    fontSize: FONT_SIZE.body,
    fontWeight: FONT_WEIGHT.bold,
  },
  card: {
    ...scrimCardBase,
    maxWidth: 360,
    padding: SPACING.md,
  },
  createOptionText: {
    color: COLORS.brand,
    fontSize: FONT_SIZE.bodyLg,
    fontWeight: FONT_WEIGHT.semibold,
  },
  createActions: {
    flexDirection: "row",
    gap: SPACING.sm,
    justifyContent: "flex-end",
    marginTop: SPACING.md,
  },
});
