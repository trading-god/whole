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
import { SPACING } from "@/theme/spacing";
import { FONT_SIZE, FONT_WEIGHT, LETTER_SPACING } from "@/theme/typography";

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

// The institution selector for the account form. Renders a trigger in the
// same voice as the text fields around it (input-size text, no fill, a chevron
// where a field would have its cursor) plus a bottom sheet with: no
// institution, each existing institution, and a "create institution…" entry
// that reveals an inline name field — so an unrecognized institution can be
// named by hand without leaving the form.
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
        <Text
          numberOfLines={1}
          style={[styles.triggerText, !selected && styles.triggerTextEmpty]}
        >
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
        <Text style={styles.title}>{t("accountForm.group")}</Text>
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
              {selectedInstitutionId === "" ? (
                <Icon name="check" size="sm" color={COLORS.brand} />
              ) : null}
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
                <Icon name="plus" size="sm" color={COLORS.brand} />
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
  // Same box model as `FormField`'s input row — input-size text, no fill, no
  // border — so the picker sits in the form as one more field rather than a
  // control of a different family. The chevron is the only tell that it opens
  // a list instead of taking the keyboard.
  trigger: {
    alignItems: "center",
    flexDirection: "row",
    gap: SPACING.sm,
    justifyContent: "space-between",
    minHeight: 24,
  },
  triggerText: {
    color: COLORS.ink,
    flexShrink: 1,
    fontSize: FONT_SIZE.subtitle,
    fontWeight: FONT_WEIGHT.semibold,
  },
  // "No institution" reads as a placeholder, in the placeholder colour, not
  // as a value the user chose.
  triggerTextEmpty: {
    color: COLORS.subtle,
    fontWeight: FONT_WEIGHT.medium,
  },
  card: {
    ...scrimCardBase,
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.md,
  },
  // The sheet's title, in the same voice as OptionPicker's.
  title: {
    color: COLORS.muted,
    fontSize: FONT_SIZE.eyebrow,
    fontWeight: FONT_WEIGHT.semibold,
    letterSpacing: LETTER_SPACING.caption,
    marginBottom: SPACING.sm,
    paddingHorizontal: SPACING.md,
  },
  createOptionText: {
    color: COLORS.brand,
    flex: 1,
    fontSize: FONT_SIZE.bodyLg,
    fontWeight: FONT_WEIGHT.semibold,
    marginLeft: SPACING.sm,
  },
  createActions: {
    flexDirection: "row",
    gap: SPACING.sm,
    justifyContent: "flex-end",
    marginTop: SPACING.md,
  },
});
