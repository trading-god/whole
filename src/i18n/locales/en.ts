import type { zhHansMessages } from "@/i18n/locales/zh-Hans";
import type { MessageShape } from "@/i18n/schema";

export const enMessages = {
  common: {
    wordmark: "WHOLE",
    // Launch-screen brand slogan. Fixed English in BOTH locales: the slogan is
    // brand copy that stays verbatim in every language (AGENTS.md).
    sloganLine1: "Your whole financial life,",
    sloganLine2: "in one place.",
    addAccount: "Add account",
    backToAssetOverview: "Back to asset overview",
    cancel: "Cancel",
    required: "Required",
    stepIndicator: "Step {{current}} of {{total}}",
  },
  // Display names for institutions: when OCR detects an institution, this is
  // the suggested group name offered for auto-grouping. An institution is a
  // bank, a crypto exchange, or a broker, so this list spans all three — see
  // src/i18n/README.md terminology. Keys align 1:1 with the InstitutionId enum
  // in `@whole/ocr`; adding an institution requires a matching key here, and
  // the en/zh i18n type system enforces the two stay in sync.
  institutionNames: {
    ocbc: "OCBC",
    dbs: "DBS",
    alipay: "Alipay",
    bochk: "BOC Hong Kong",
    ccb: "China Construction Bank",
    cmb: "China Merchants Bank",
    cmbwl: "CMB Wing Lung Bank",
    hsbchk: "HSBC Hong Kong",
    hsbcsg: "HSBC Singapore",
    bitget: "Bitget",
    okx: "OKX",
    ibkr: "Interactive Brokers",
    trust: "Trust Bank",
    unknown: "Unknown institution",
  },
  home: {
    greeting: "Hello, {{name}}",
    greetingFallback: "Hello",
    totalAssetsLabel: "Total assets, in",
    displayCurrency: "Display currency",
    chartRange: "Chart range",
    pastMonths_one: "Past month",
    pastMonths_other: "Past {{count}} months",
    pastYears_one: "Past year",
    pastYears_other: "Past {{count}} years",
    allTime: "All time",
    chartAccumulating: "Building chart history…",
    // One sample stored. Says when the curve appears rather than leaving the
    // card on an open-ended "building…" — snapshots are daily, so the second
    // point is tomorrow's.
    chartFirstPoint: "First reading recorded. Your curve starts tomorrow.",
    // Shown in the chart's place while no account exists, where a curve is not
    // pending but impossible.
    chartEmptyPrompt: "Add your first account and your trend starts here.",
    chartRatesUnavailable:
      "Chart history needs exchange rates. Connect to the internet and reopen Whole.",
    assetComposition: "Asset composition",
    // A holding too small to round to a whole percent. Shown instead of "0%",
    // which reads as "you hold none of this".
    lessThanOnePercent: "<1%",
    netLiability: "Owed",
    loading: "Loading",
    accountCount_one: "{{count}} account",
    accountCount_other: "{{count}} accounts",
    accountCurrencies_one: "{{count}} currency",
    accountCurrencies_other: "{{count}} currencies",
    cash: "Cash",
    investments: "Investments",
    digitalAssets: "Digital assets",
    myAccounts: "My accounts",
    accountLoadError: "Unable to load accounts. Reopen Whole to try again.",
    accountDataPrivacy:
      "Account data is used only to create your asset overview",
    delete: "Delete",
    confirm: "Confirm",
    deleteAccount: "Delete account",
    confirmDeleteAccount: "Confirm delete account",
    deleteAccountError: "Couldn't delete the account. Try again later.",
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
    // Under a negative balance on an account row: the figure is money owed,
    // not an asset.
    liability: "Owed",
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
    invalidBalance: "Enter a number, e.g. 1234.56 or -1234.56",
    duplicateCurrency: "This currency already has a row",
    incompleteLastFour: "Enter all four digits, or leave this empty",
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
    // The multi-account wizard asks for the institution once, above the paged
    // form; this line says the one answer covers the whole batch.
    batchGroupHint:
      "Every account in this batch is filed under this institution. Leave it empty to keep them ungrouped.",
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
  settings: {
    title: "Settings",
    display: "Display",
    displayCurrencyHint:
      "The home screen total and every account balance are converted into this currency.",
    language: "Language",
    languageFollowsSystem: "Follows the system setting",
    changeInSystemSettings: "Change in system settings",
    about: "About",
    version: "Version {{version}}",
    onDevice: {
      title: "Recognition runs on this device",
      description:
        "{{model}} is stored on your phone and does the recognition. It takes about {{size}} of storage and extra memory while recognizing.",
      privacyNotice:
        "Nothing about your accounts ever leaves this device. Recognition works offline.",
      test: "Test",
      testing: "Loading the model…",
      testPassed: "The on-device model is working",
      testFailure:
        "The on-device model couldn't be verified. Restart the app, and free up memory and storage if it happens again.",
    },
    engine: {
      title: "Recognition engine",
      // The choice itself: two named routes, each with its cost in the label —
      // storage and offline for the local one, network and data-leaving for the
      // remote one. The user decides with the trade visible.
      onDevice: "On-device model",
      onDeviceHint: "{{size}}, works offline, nothing leaves this phone",
      remote: "Cloud model service",
      remoteHint:
        "Stronger results, needs internet — the screenshot's text is sent to your service",
      // The local engine's download flow. "Download" is one word for one
      // action, reused everywhere the action appears.
      download: "Download",
      downloading: "Downloading…",
      downloadFailed:
        "The download didn't finish. Check your connection and try again — completed parts are kept.",
      downloaded: "Downloaded",
      downloadHint:
        "Uses about {{size}} of storage. A Wi-Fi connection is recommended.",
      // One model row's cost line — both bills, storage and memory, because
      // they are what the E2B/E4B choice actually turns on for the device.
      modelCosts: "{{size}} storage · about {{ram}} memory to run",
      deleteModel: "Delete model",
      deleteModelHint:
        "Frees {{size}}. Recognition switches off until you download it again.",
      notDownloaded: "Not downloaded",
      partialDownload: "{{size}} of {{total}}",
      // The remote engine's form. Labels say what to paste, in the words a
      // provider's console uses.
      baseUrl: "Base URL",
      baseUrlHint:
        "Your provider's https:// address, e.g. https://api.deepseek.com/v1",
      model: "Model",
      modelHint: "The model name your provider serves, e.g. deepseek-chat",
      apiKey: "API key",
      apiKeyHint: "Stored only on this phone, never shown again after saving",
      save: "Save service",
      testing: "Testing…",
      testPassed: "The service responded",
      testFailure:
        "The service didn't respond. Check the address, the model name, and the API key.",
      clear: "Remove service",
      // The opt-in, stated plainly once. This is the sentence the whole
      // remote engine's privacy posture hangs on.
      remotePrivacy:
        "With a cloud service, the text Whole reads off your screenshots is sent to the service you configured — never the screenshots themselves. With the on-device model, nothing leaves this phone.",
    },
    // Shown by the screenshot uploader when the chosen engine isn't ready:
    // recognition is off until the model is downloaded or the service is
    // configured, and the user needs to be sent to the right screen.
    engineSetup: {
      title: "Recognition is off",
      notReady:
        "Choose an engine in Settings first: download the on-device model (offline, private) or configure a cloud service (needs internet).",
      goToSettings: "Open Settings",
    },
  },
  accountScreenshot: {
    uploadScreenshot: "Upload account screenshot",
    // The edit screen's compact entry: here a screenshot is a way to refresh
    // a balance, not the subject of the page.
    updateFromScreenshot: "Update from a new screenshot",
    replaceScreenshot: "Replace screenshot",
    // Shown in the form area while recognition runs. The on-device model is
    // slow to load, so the user needs to know how long and why.
    recognizingHint:
      "Reading the screenshot. The on-device model usually takes under a minute, and the form fills in on its own.",
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
    recognitionEmpty:
      "No accounts were found on this screenshot. Try one that shows the account name and balance, or fill in the details manually.",
    modelLoadFailed:
      "The on-device model couldn't load, so anything it would have added is missing. Check what was filled in, then restart the app — and free up memory and storage if it happens again.",
    remoteFailed:
      "The cloud service couldn't be reached. Check the address, the API key, and the model name in Settings — the rest was read on this phone.",
    modelUnusable:
      "The model couldn't finish reading this screenshot. Check what was filled in and complete the rest.",
    modelInterrupted:
      "Something interrupted the on-device model, so anything it would have added is missing. Check what was filled in and complete the rest.",
    ocrUnsupported:
      "This device can't recognize screenshots. Please fill in the details manually.",
    noMatchingAccount:
      "This screenshot doesn't show the account you're editing, so nothing was filled in. Choose a screenshot of this account.",
    accountSaved: "Account saved",
    cleanupPrompt:
      "This account screenshot was used to confirm the account details. Delete it from your photo library? The system will ask you to confirm.",
    cleanupManualPhotoLibrary:
      "The account screenshot has done its job. Delete it from your photo library whenever you no longer need it.",
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
      "Bring your bank, broker, and exchange accounts into one overview. Upload an account screenshot and the balance is read for you.",
    privacyNote:
      "Account details and screenshots stay on this device. Recognition runs here, not in the cloud.",
    nameLabel: "Name",
    nameHint: "Optional. Used for the home-screen greeting.",
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
  // Copy for the app-level crash fallback. AppErrorBoundary reads it straight
  // from `resources` rather than through the i18next instance: by the time the
  // fallback renders, I18nProvider is no longer mounted.
  errorBoundary: {
    title: "Something went wrong",
    description:
      "Whole hit an unexpected problem and stopped here. Your saved accounts are untouched.",
    detailLabel: "Error details",
    detailHint:
      "If it keeps failing after a retry, copy the details below when reporting it.",
    retry: "Try again",
  },
} satisfies MessageShape<typeof zhHansMessages>;
