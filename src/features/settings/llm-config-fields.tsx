import { type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";

import { FormField } from "@/components/FormField";
import { screenStyles } from "@/theme/screen-styles";

type LlmConfigFieldsProps = {
  baseUrl: string;
  apiKey: string;
  model: string;
  onBaseUrlChange: (value: string) => void;
  onApiKeyChange: (value: string) => void;
  onModelChange: (value: string) => void;
  editable?: boolean;
  baseUrlTrailing?: ReactNode;
};

// The three LLM-config form fields (base URL, API key, model) shared by the
// Settings screen and onboarding so the labels, placeholders, required flags,
// and keyboard hints stay in lockstep instead of being redeclared per screen.
// Settings passes `editable` (gated on config load) and a test-connection
// `baseUrlTrailing` slot; onboarding uses the fields bare.
export function LlmConfigFields({
  baseUrl,
  apiKey,
  model,
  onBaseUrlChange,
  onApiKeyChange,
  onModelChange,
  editable,
  baseUrlTrailing,
}: LlmConfigFieldsProps) {
  const { t } = useTranslation();
  return (
    <View style={screenStyles.formCard}>
      <FormField
        autoCapitalize="none"
        editable={editable}
        keyboardType="url"
        label={t("settings.baseUrl")}
        placeholder={t("settings.baseUrlPlaceholder")}
        required
        trailing={baseUrlTrailing}
        trailingLayout="responsive"
        value={baseUrl}
        onChangeText={onBaseUrlChange}
      />
      <View style={screenStyles.fieldDivider} />
      <FormField
        autoCapitalize="none"
        editable={editable}
        label={t("settings.apiKey")}
        placeholder={t("settings.apiKeyPlaceholder")}
        value={apiKey}
        onChangeText={onApiKeyChange}
      />
      <View style={screenStyles.fieldDivider} />
      <FormField
        autoCapitalize="none"
        editable={editable}
        label={t("settings.model")}
        placeholder={t("settings.modelPlaceholder")}
        required
        value={model}
        onChangeText={onModelChange}
      />
    </View>
  );
}
