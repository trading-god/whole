import type { zhHansMessages } from "@/i18n/locales/zh-Hans";
import type { MessageShape } from "@/i18n/schema";

export const enMessages = {
  common: {
    wordmark: "WHOLE",
    addAccount: "Add account",
    backToAssetOverview: "Back to asset overview",
    cancel: "Cancel",
    required: "Required",
    stepIndicator: "Step {{current}} of {{total}}",
  },
  // Display names for banks: when OCR detects a bank, this is the suggested
  // group name offered for auto-grouping. Keys align 1:1 with the BankId enum
  // in ocr-bank-config; adding a bank to DETECT_BANKS requires a matching key
  // here, and the en/zh i18n type system enforces the two stay in sync.
  bankNames: {
    ocbc: "OCBC",
    dbs: "DBS",
    unknown: "Unknown bank",
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
    showAssetAmounts: "Show asset amounts",
    hideAssetAmounts: "Hide asset amounts",
    showAssetAmountsHint: "Show amounts and percentages on the asset overview",
    hideAssetAmountsHint:
      "Replace amounts and percentages on the asset overview with bullets",
    accountCountInGroup_one: "{{count}} account",
    accountCountInGroup_other: "{{count}} accounts",
    collapseGroup: "Collapse institution",
    expandGroup: "Expand institution",
    deleteGroup: "Delete institution",
    confirmDeleteGroup:
      "Delete this institution? Accounts will be kept but no longer belong to it.",
    deleteGroupError: "Couldn't delete the institution. Try again later.",
    // Dev-mode entry in the home header. Registered only under __DEV__ (see
    // _layout.tsx), so this key has no surface in release builds.
    devToolsLabel: "Dev",
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
    // Institution copy. An institution is the named container an account
    // belongs to — a bank, crypto exchange, or broker. Accounts hang off it
    // (specific currency savings, coin positions, or stock positions). It
    // carries only a name and a total of its accounts' balances, no card number
    // or type of its own. See src/i18n/README.md terminology.
    group: "Institution",
    noGroup: "No institution",
    createGroup: "Create institution",
    groupName: "Institution name",
    newGroupPlaceholder: "Enter an institution name",
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
    ocrUnsupported:
      "This device can't recognize screenshots. Please fill in the details manually.",
    noMatchingAccount:
      "This screenshot doesn't show the account you're editing, so nothing was filled in. Choose a screenshot of this account.",
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
  onboarding: {
    nameTitle: "Welcome to Whole",
    nameSubtitle:
      "Tell us what to call you — it'll greet you on the home screen.",
    nameLabel: "Name",
    namePlaceholder: "e.g. Alex",
    finish: "Get started",
    completionErrorTitle: "Couldn't finish setup",
    completionErrorMessage:
      "Something went wrong saving your progress. Try again.",
  },
  notFound: {
    screenTitle: "Page not found",
    title: "This page could not be found",
    description: "The link may have expired or the address may be incorrect.",
  },
  // Dev-only copy for the OCR regression-fixture capture screen
  // (AccountScreenshotCapture). Registered only under __DEV__, so this block has
  // no production surface; it exists so locking down the eval workflow can ship
  // against the same i18n typing as the rest of the app.
  devTools: {
    title: "Dev Tools",
    subtitle: "Developer-only utilities. Not available in release builds.",
    ocrCaptureTitle: "OCR capture",
    ocrCaptureSubtitle:
      "Generate OCR regression samples for packages/ocr-eval from a real screenshot.",
  },
  devOcr: {
    screenTitle: "OCR capture",
    pickScreenshot: "Choose account screenshot",
    pickBatch: "Batch capture screenshots",
    recognizing: "Recognizing…",
    batchProgress: "Capturing {{current}}/{{total}}…",
    pickerFailed:
      "Couldn't open the photo library. Try again later or check Whole's permission to access your photos.",
    recognitionFailed: "Couldn't read the screenshot.",
    batchFailed: "Batch capture failed on image {{current}}.",
    ocrUnsupported:
      "This device can't run on-device OCR. Use a supported device or simulator.",
    resultsTitle: "Recognition results",
    blocksLabel_one: "{{count}} OCR text block",
    blocksLabel_other: "{{count}} OCR text blocks",
    moreBlocks_one: "+{{count}} more block",
    moreBlocks_other: "+{{count}} more blocks",
    accountsLabel_one: "{{count}} account",
    accountsLabel_other: "{{count}} accounts",
    noAccounts: "No accounts found in this screenshot.",
    copyBlocks: "Copy blocks.json",
    copyExpected: "Copy expected.json",
    copyTitle: "Copied to clipboard",
    copyBlocksSuccess:
      "blocks.json is copied. Save it as packages/ocr-eval/samples/<slug>/blocks.json.",
    copyExpectedSuccess:
      "expected.json template is copied. Review it, edit the fields, and save it as packages/ocr-eval/samples/<slug>/expected.json.",
    copyFailed: "Couldn't copy to the clipboard. Try again.",
    unnamed: "Unnamed account",
    noBalances: "No balances",
    lastFour: "Last four:",
    kindLabel: "Type:",
    unknownKind: "Unknown type",
    batchTitle: "Batch capture",
    batchHint:
      "Pick multiple screenshots. Each is OCR'd on device and packed into a zip (one folder per image: blocks.json + screenshot.png). Share the zip to your computer, then run pnpm eval:ocr:import <folder>.",
    batchShareTitle: "Share OCR fixtures",
    batchDone:
      "Captured {{count}} screenshot(s). Share the zip, then run pnpm eval:ocr:import on the unpacked folder.",
    shareFailed: "Couldn't share the zip. Try again.",
  },
} satisfies MessageShape<typeof zhHansMessages>;
