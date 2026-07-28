import type { zhHansMessages } from "@/i18n/locales/zh-Hans";
import type { MessageShape } from "@/i18n/schema";

export const enMessages = {
  common: {
    brandName: "Whole",
    wordmark: "WHOLE",
    addAccount: "Add account",
    backToAssetOverview: "Back to asset overview",
  },
  metadata: {
    homeTitle: "Whole — Your complete asset overview",
    homeDescription: "Your whole financial life, in one place.",
    newAccountTitle: "Add account — Whole",
    newAccountDescription: "Add an account to Whole and confirm its details.",
    notFoundTitle: "Page not found — Whole",
  },
  home: {
    greeting: "Hello, {{name}}",
    totalAssetsInCurrency: "Total assets · in {{currency}}",
    pastMonths: "Past {{count}} months",
    assetComposition: "Asset composition",
    loading: "Loading",
    accountCount_one: "{{count}} account",
    accountCount_other: "{{count}} accounts",
    cash: "Cash",
    investments: "Investments",
    digitalAssets: "Digital assets",
    myAccounts: "My accounts",
    add: "Add",
    loadingAccounts: "Loading accounts",
    accountLoadError: "Unable to load accounts. Reopen Whole to try again.",
    accountDataPrivacy:
      "Account data is used only to create your asset overview",
  },
  newAccount: {
    screenTitle: "Add account",
    introTitle: "Add an account",
    introDescription:
      "Choose an account screenshot, then complete and confirm the account details.",
    uploadScreenshot: "Upload account screenshot",
    changeScreenshot: "Change account screenshot",
    screenshotReady: "Account screenshot ready",
    tapToChangeScreenshot: "Tap to change the account screenshot",
    screenshotGuidance:
      "Choose a screenshot that clearly shows the account name, last four digits, and balance",
    chooseScreenshot: "Choose account screenshot",
    screenshotPrivacy:
      "Your account screenshot is used only to confirm account details and will not appear in your asset overview",
    accountInformation: "Account details",
    formHint: "Complete or edit the details using the account screenshot",
    accountName: "Account name",
    accountNameExample: "For example: DBS Multiplier",
    accountNumberLastFour: "Last four digits",
    accountBalance: "Account balance",
    currency: "Currency",
    saving: "Saving…",
    saveAccount: "Save account",
    accountSaved: "Account saved",
    cleanupPrompt:
      "This account screenshot was used to confirm the account details. Delete it from your photo library? The system will ask you to confirm.",
    cleanupManualPhotoLibrary:
      "The system could not locate the account screenshot. Delete it manually from your photo library.",
    cleanupManualBrowser:
      "The browser cannot delete the account screenshot from your device. Delete it manually from your photos or downloads.",
    keepScreenshot: "Keep screenshot",
    deletingScreenshot: "Deleting…",
    deleteScreenshot: "Delete screenshot",
    acknowledge: "Got it",
    validationTitle: "Check account details",
    validationMessage:
      "Enter an account name, the last four digits, and a valid account balance.",
    saveErrorTitle: "Unable to save",
    saveErrorMessage: "The account could not be saved. Try again later.",
    deletionErrorTitle: "Unable to delete account screenshot",
    deletionErrorMessage:
      "The account was saved. Delete the account screenshot manually from your photo library.",
    pickerErrorTitle: "Unable to choose account screenshot",
    pickerErrorMessage:
      "Try again later or check Whole's permission to access your photos.",
  },
  notFound: {
    screenTitle: "Page not found",
    title: "This page could not be found",
    description: "The link may have expired or the address may be incorrect.",
  },
} satisfies MessageShape<typeof zhHansMessages>;
