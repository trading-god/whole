import type { zhHansMessages } from "@/i18n/locales/zh-Hans";
import type { MessageShape } from "@/i18n/schema";

export const enMessages = {
  common: {
    wordmark: "WHOLE",
    addAccount: "Add account",
    backToAssetOverview: "Back to asset overview",
    settings: "Settings",
    cancel: "Cancel",
    required: "Required",
    stepIndicator: "Step {{current}} of {{total}}",
  },
  home: {
    greeting: "Hello, {{name}}",
    greetingFallback: "Hello",
    totalAssetsLabel: "Total assets · in",
    displayCurrency: "Display currency",
    chartRange: "Chart range",
    pastMonths_one: "Past month",
    pastMonths_other: "Past {{count}} months",
    pastYears_one: "Past year",
    pastYears_other: "Past {{count}} years",
    allTime: "All time",
    chartAccumulating: "Building chart history…",
    chartRatesUnavailable:
      "Chart history needs exchange rates. Connect to the internet and reopen Whole.",
    assetComposition: "Asset composition",
    loading: "Loading",
    accountCount_one: "{{count}} account",
    accountCount_other: "{{count}} accounts",
    accountCurrencies_one: "{{count}} currency",
    accountCurrencies_other: "{{count}} currencies",
    cash: "Cash",
    investments: "Investments",
    digitalAssets: "Digital assets",
    myAccounts: "My accounts",
    add: "Add",
    accountLoadError: "Unable to load accounts. Reopen Whole to try again.",
    accountDataPrivacy:
      "Account data is used only to create your asset overview",
    delete: "Delete",
    confirm: "Confirm",
    deleteAccount: "Delete account",
    confirmDeleteAccount: "Confirm delete account",
    deleteAccountError: "Couldn't delete the account. Try again later.",
    emptyBalanceHint: "Add an account to start tracking",
    openAccountHint: "View account details",
  },
  // Copy for the account form itself (AccountEditorFields), shared verbatim by
  // the add-account screen, its multi-account wizard, and the edit-account
  // screen — the form has one owner, so its labels do too. Screen-specific
  // copy (intro, hints, save/error wording) stays in `newAccount` /
  // `accountDetail`.
  accountForm: {
    accountName: "Account name",
    accountNameExample: "For example: DBS Multiplier",
    lastFourDigits: "Last four digits",
    accountBalance: "Account balance",
    currency: "Currency",
    accountKind: "Account type",
    kindCash: "Cash",
    kindInvestment: "Investment",
    kindCrypto: "Crypto",
    addCurrency: "Add currency",
    allCurrenciesAdded: "All currencies added",
    removeCurrencyRow: "Remove this currency",
  },
  newAccount: {
    screenTitle: "Add account",
    introTitle: "Add an account",
    introDescription:
      "Choose an account screenshot, then complete and confirm the account details.",
    accountInformation: "Account details",
    formHint: "Complete or edit the details using the account screenshot",
    saving: "Saving…",
    saveAccount: "Save account",
    saveErrorTitle: "Unable to save",
    saveErrorMessage: "The account could not be saved. Try again later.",
  },
  // Copy owned by the two shared account-screenshot components
  // (AccountScreenshotUploader and SourceImageCleanupModal), which the add- and
  // edit-account screens both render. Kept out of `newAccount` so editing the
  // add screen's copy can't silently change what the edit screen says.
  accountScreenshot: {
    uploadScreenshot: "Upload account screenshot",
    replaceScreenshot: "Replace screenshot",
    replaceScreenshotHint: "Choose a different account screenshot",
    screenshotReady: "Account screenshot ready",
    screenshotGuidance:
      "Choose a screenshot that clearly shows the account name, last four digits, and balance",
    chooseScreenshot: "Choose account screenshot",
    screenshotPrivacy:
      "Your account screenshot is used only to confirm account details and will not appear in your asset overview",
    recognizing: "Recognizing…",
    recognized: "Recognized — please review",
    recognitionFailed:
      "Couldn't read the screenshot. Please fill in the details manually.",
    noMatchingAccount:
      "This screenshot doesn't show the account you're editing, so nothing was filled in. Choose a screenshot of this account.",
    missingLlmConfigMessage:
      "Add an OpenAI-compatible endpoint and model to recognize accounts from screenshots.",
    goToSettings: "Open settings",
    accountSaved: "Account saved",
    cleanupPrompt:
      "This account screenshot was used to confirm the account details. Delete it from your photo library? The system will ask you to confirm.",
    cleanupManualPhotoLibrary:
      "The system could not locate the account screenshot. Delete it manually from your photo library.",
    keepScreenshot: "Keep screenshot",
    deletingScreenshot: "Deleting…",
    deleteScreenshot: "Delete screenshot",
    acknowledge: "Got it",
    deletionErrorTitle: "Unable to delete account screenshot",
    deletionErrorMessage:
      "The account was saved. Delete the account screenshot manually from your photo library.",
    deletionPermissionTitle: "Whole can't delete the screenshot",
    deletionPermissionMessage:
      "Whole needs full access to your photo library to delete the screenshot. Open Settings, tap Whole, and enable Full Access.",
    openSystemSettings: "Open settings",
    pickerErrorMessage:
      "Try again later or check Whole's permission to access your photos.",
  },
  accountDetail: {
    screenTitle: "Edit account",
    introTitle: "Edit account",
    introDescription: "Update the account name, balances, and type.",
    accountInformation: "Account details",
    formHint: "Edit the details you want to update",
    lastFourDigitsLocked:
      "The last four digits can't be changed after the account is created",
    lastFourDigitsOptional:
      "Optional — fill in the last four digits if the account has a card number",
    saving: "Saving…",
    saveAccount: "Save changes",
    conflictTitle: "Account already exists",
    conflictMessage:
      'Another account named "{{name}}" has the same last four digits. Use a different name.',
    saveErrorTitle: "Unable to save",
    saveErrorMessage: "The account could not be saved. Try again later.",
  },
  multiAccount: {
    title: "Recognized {{count}} accounts",
    accountPosition: "{{current}} of {{total}}",
    previous: "Previous account",
    next: "Next account",
    saveAll: "Save all",
    removeAccount: "Remove this account",
    duplicateAccounts:
      "Two accounts have the same name and last four digits. Rename one, or give one a different last four, so they save as separate accounts.",
    incompleteAccounts_one:
      "1 account still needs a name and at least one balance. Complete it, or remove it, to save.",
    incompleteAccounts_other:
      "{{count}} accounts still need a name and at least one balance. Complete them, or remove them, to save.",
    replaceDraftsTitle: "Replace the accounts in this form?",
    replaceDraftsMessage_one:
      "Reading this screenshot replaces the account you're filling in, including anything you've changed.",
    replaceDraftsMessage_other:
      "Reading this screenshot replaces the {{count}} accounts you're filling in, including anything you've changed.",
    replaceDraftsConfirm: "Replace",
    // Only the plural body differs from newAccount's — the busy label and the
    // error title read identically, so both modes share those keys.
    saveErrorMessage: "The accounts could not be saved. Try again later.",
  },
  settings: {
    screenTitle: "Settings",
    introTitle: "Screenshot recognition",
    introDescription:
      "Whole calls an OpenAI-compatible vision model directly from this device to read account screenshots. Enter your endpoint and model below; leave the API key blank if your endpoint doesn't require one.",
    baseUrl: "Base URL",
    baseUrlPlaceholder: "https://api.openai.com/v1",
    apiKey: "API key",
    apiKeyPlaceholder: "sk-…",
    model: "Model",
    modelPlaceholder: "gpt-4o",
    save: "Save",
    saving: "Saving…",
    saved: "Configuration saved",
    saveErrorTitle: "Unable to save",
    saveErrorMessage: "The configuration could not be saved. Try again later.",
    statusSaved: "Configured",
    statusNotSet: "Not configured",
    clear: "Clear",
    clearConfirmTitle: "Clear configuration?",
    clearConfirmMessage:
      "This removes the saved endpoint, API key, and model from this device.",
    clearErrorTitle: "Unable to clear",
    clearErrorMessage:
      "The configuration could not be cleared. Try again later.",
    privacy:
      "If set, the API key is stored in this device's secure storage and is sent only to the endpoint you enter.",
    testConnection: "Test connection",
    testing: "Testing…",
    testSuccess: "Connected",
    testFailed: "Failed",
  },
  onboarding: {
    nameTitle: "Welcome to Whole",
    nameSubtitle:
      "Tell us what to call you — it'll greet you on the home screen.",
    nameLabel: "Name",
    namePlaceholder: "e.g. Alex",
    modelTitle: "Connect your model",
    modelSubtitle:
      "Whole calls an OpenAI-compatible vision model to read account screenshots. Fill this in now, or skip and set it up later in Settings.",
    modelHint: "You can test the connection later in Settings.",
    modelInvalid: "Enter both a base URL and a model, or skip",
    next: "Next",
    back: "Back",
    finish: "Get started",
    skip: "Skip for now",
    completionErrorTitle: "Couldn't finish setup",
    completionErrorMessage:
      "Something went wrong saving your progress. Try again.",
  },
  notFound: {
    screenTitle: "Page not found",
    title: "This page could not be found",
    description: "The link may have expired or the address may be incorrect.",
  },
} satisfies MessageShape<typeof zhHansMessages>;
