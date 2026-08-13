export const zhHansMessages = {
  common: {
    wordmark: "WHOLE",
    addAccount: "添加账户",
    backToAssetOverview: "返回资产总览",
    cancel: "取消",
    required: "必填",
    stepIndicator: "第 {{current}} 步，共 {{total}} 步",
  },
  // 银行显示名：OCR 检测到某银行时，用作自动归组的建议分组名。key 与
  // ocr-bank-config 的 BankId 枚举一一对应；新增 DETECT_BANKS 银行时须同步
  // 补充对应 key，en/zh 的 i18n 类型系统会强制两者对齐。
  bankNames: {
    ocbc: "OCBC",
    dbs: "DBS",
    unknown: "未知银行",
  },
  home: {
    greeting: "你好，{{name}}",
    greetingFallback: "你好",
    totalAssetsLabel: "总资产 · 折合",
    displayCurrency: "展示币种",
    chartRange: "图表时间范围",
    pastMonths_one: "过去 {{count}} 个月",
    pastMonths_other: "过去 {{count}} 个月",
    pastYears_one: "过去 {{count}} 年",
    pastYears_other: "过去 {{count}} 年",
    allTime: "全部时间",
    chartAccumulating: "正在积累图表数据…",
    chartRatesUnavailable: "图表数据需要汇率。请连接网络后重新打开 Whole。",
    assetComposition: "资产构成",
    loading: "正在加载",
    accountCount_one: "{{count}} 个账户",
    accountCount_other: "{{count}} 个账户",
    accountCurrencies_one: "共 {{count}} 个币种",
    accountCurrencies_other: "共 {{count}} 个币种",
    cash: "现金",
    investments: "投资",
    digitalAssets: "数字资产",
    myAccounts: "我的账户",
    add: "添加",
    accountLoadError: "无法加载账户，请重新打开 Whole",
    accountDataPrivacy: "账户数据仅用于生成你的资产总览",
    delete: "删除",
    confirm: "确认",
    deleteAccount: "删除账户",
    confirmDeleteAccount: "确认删除账户",
    deleteAccountError: "无法删除账户，请稍后重试。",
    emptyBalanceHint: "添加账户，开始追踪总资产",
    openAccountHint: "查看账户详情",
    showAssetAmounts: "显示资产数字",
    hideAssetAmounts: "隐藏资产数字",
    showAssetAmountsHint: "显示首页中的资产金额与比例",
    hideAssetAmountsHint: "将首页中的资产金额与比例替换为圆点",
    accountCountInGroup_one: "{{count}} 个账户",
    accountCountInGroup_other: "{{count}} 个账户",
    collapseGroup: "收起机构",
    expandGroup: "展开机构",
    deleteGroup: "删除机构",
    confirmDeleteGroup: "删除此机构？账户将保留，但不再归属该机构。",
    deleteGroupError: "无法删除机构，请稍后重试。",
    // 首页右上角开发者模式入口，仅在 __DEV__ 下注册（见 _layout.tsx），发布版
    // 本中没有这个入口。
    devToolsLabel: "开发者模式",
  },
  // 账户表单本身（AccountEditorFields）的文案，添加账户页、多账户向导与编辑
  // 账户页逐字共用——表单只有一个归属，它的标签也只有一份。各屏专属文案
  //（引导语、提示、保存与错误措辞）仍留在 `newAccount` / `accountDetail`。
  accountForm: {
    accountName: "账户名称",
    accountNameExample: "例如：DBS Multiplier",
    lastFourDigits: "账号后四位",
    accountBalance: "账户余额",
    currency: "币种",
    accountKind: "账户类型",
    kindCash: "现金",
    kindInvestment: "投资",
    kindCrypto: "加密货币",
    addCurrency: "添加币种",
    allCurrenciesAdded: "已添加全部币种",
    removeCurrencyRow: "删除该币种",
    // 机构（institution）相关文案。机构是账户归属的命名容器——银行、
    // 加密货币交易所或券商——账户挂在其下（具体币种储蓄、币种仓位或股
    // 票仓位）。它只存名字与下属账户汇总，不持有卡号或类型。见
    // src/i18n/README.md 术语库。
    group: "机构",
    noGroup: "无机构",
    createGroup: "新建机构",
    groupName: "机构名称",
    newGroupPlaceholder: "输入机构名称",
  },
  newAccount: {
    screenTitle: "添加账户",
    introTitle: "添加一个账户",
    introDescription: "选择账户截图，然后补充并确认账户信息。",
    accountInformation: "账户信息",
    formHint: "请根据账户截图补充或修改",
    saving: "正在保存…",
    saveAccount: "保存账户",
    saveErrorTitle: "保存失败",
    saveErrorMessage: "无法保存账户，请稍后重试。",
  },
  // 两个共享的账户截图组件（AccountScreenshotUploader 与
  // SourceImageCleanupModal）自有的文案，添加账户页与编辑账户页都会渲染它们。
  // 独立于 `newAccount`，这样改动添加账户页的文案不会悄悄改掉编辑页的措辞。
  accountScreenshot: {
    uploadScreenshot: "上传账户截图",
    replaceScreenshot: "更换截图",
    replaceScreenshotHint: "选择其他账户截图",
    screenshotReady: "账户截图已就绪",
    screenshotGuidance: "选择一张清晰显示账户名称、账号后四位和余额的截图",
    chooseScreenshot: "选择账户截图",
    screenshotPrivacy: "账户截图仅用于确认账户信息，不会显示在资产总览中",
    recognizing: "正在识别…",
    recognized: "已识别，请核对",
    recognitionFailed: "无法识别截图，请手动填写账户信息。",
    ocrUnsupported: "当前设备不支持截图识别，请手动填写账户信息。",
    noMatchingAccount:
      "这张截图中没有你正在编辑的账户，因此未填入任何信息。请选择该账户的截图。",
    accountSaved: "账户已保存",
    cleanupPrompt:
      "这张账户截图已用于确认账户信息。是否从系统相册删除？系统会再次请求确认。",
    cleanupManualPhotoLibrary:
      "系统无法定位相册中的账户截图，请前往系统相册手动删除。",
    keepScreenshot: "保留账户截图",
    deletingScreenshot: "正在删除…",
    deleteScreenshot: "删除账户截图",
    acknowledge: "我知道了",
    deletionErrorTitle: "无法删除账户截图",
    deletionErrorMessage: "账户已保存。请前往系统相册手动删除这张账户截图。",
    deletionPermissionTitle: "Whole 无法删除账户截图",
    deletionPermissionMessage:
      "Whole 需要照片完全访问权限才能删除账户截图。请打开系统设置，点击 Whole，并开启“完全访问”。",
    openSystemSettings: "打开设置",
    pickerErrorMessage: "请稍后重试，或检查 Whole 的照片访问权限。",
  },
  accountDetail: {
    screenTitle: "编辑账户",
    introTitle: "编辑账户",
    introDescription: "更新账户名称、余额与类型。",
    accountInformation: "账户信息",
    formHint: "修改需要更新的信息",
    lastFourDigitsLocked: "账号后四位在账户创建后无法修改",
    lastFourDigitsOptional: "选填——若账户有卡号，可补充后四位",
    saving: "正在保存…",
    saveAccount: "保存修改",
    conflictTitle: "账户已存在",
    conflictMessage:
      "另一个名为“{{name}}”的账户有相同的账号后四位。请使用其他名称。",
    saveErrorTitle: "保存失败",
    saveErrorMessage: "无法保存账户，请稍后重试。",
  },
  multiAccount: {
    title: "已识别 {{count}} 个账户",
    accountPosition: "第 {{current}}/{{total}} 个",
    previous: "上一个账户",
    next: "下一个账户",
    saveAll: "全部保存",
    removeAccount: "移除此账户",
    duplicateAccounts:
      "两个账户的名称与账号后四位相同。请重命名其中一个，或为其中一个填写不同的后四位，以便分别保存。",
    incompleteAccounts_one:
      "还有 {{count}} 个账户缺少名称或至少一笔余额。请补全或移除后再保存。",
    incompleteAccounts_other:
      "还有 {{count}} 个账户缺少名称或至少一笔余额。请补全或移除后再保存。",
    replaceDraftsTitle: "替换表单中的账户？",
    replaceDraftsMessage_one:
      "识别这张截图会替换你正在填写的 {{count}} 个账户，包括你已修改的内容。",
    replaceDraftsMessage_other:
      "识别这张截图会替换你正在填写的 {{count}} 个账户，包括你已修改的内容。",
    replaceDraftsConfirm: "替换",
    // 与 newAccount 的差异仅在于英文的单复数，中文两者同字——忙碌态文案与错
    // 误标题在两种模式下共用 newAccount 的键。
    saveErrorMessage: "无法保存账户，请稍后重试。",
  },
  onboarding: {
    nameTitle: "欢迎使用 Whole",
    nameSubtitle: "告诉我们该如何称呼你，它会出现在首页。",
    nameLabel: "称呼",
    namePlaceholder: "例如：小明",
    finish: "开始使用",
    completionErrorTitle: "无法完成设置",
    completionErrorMessage: "保存进度时出错，请重试。",
  },
  notFound: {
    screenTitle: "页面不存在",
    title: "找不到这个页面",
    description: "这个链接可能已经失效，或者页面地址有误。",
  },
  // 仅供开发的文案：OCR 回归样本采集屏（AccountScreenshotCapture）。该路由
  // 仅在 __DEV__ 下注册，无生产入口；仍走同一套 i18n 类型系统，方便与其余
  // 页面保持一致。
  devTools: {
    title: "开发者工具",
    subtitle: "仅供开发使用的工具，发布版本中不可用。",
    ocrCaptureTitle: "OCR 采集",
    ocrCaptureSubtitle: "用真实截图生成 packages/ocr-eval 的 OCR 回归样本。",
  },
  devOcr: {
    screenTitle: "OCR 采集",
    pickScreenshot: "选择账户截图",
    pickBatch: "批量采集截图",
    recognizing: "正在识别…",
    batchProgress: "正在采集 {{current}}/{{total}}…",
    pickerFailed: "无法打开相册，请稍后重试，或检查 Whole 的照片访问权限。",
    recognitionFailed: "无法识别这张截图。",
    batchFailed: "第 {{current}} 张图片采集失败。",
    ocrUnsupported: "当前设备不支持端上 OCR，请使用受支持的设备或模拟器。",
    resultsTitle: "识别结果",
    blocksLabel_one: "{{count}} 个 OCR 文本块",
    blocksLabel_other: "{{count}} 个 OCR 文本块",
    moreBlocks_one: "+{{count}} 个文本块",
    moreBlocks_other: "+{{count}} 个文本块",
    accountsLabel_one: "{{count}} 个账户",
    accountsLabel_other: "{{count}} 个账户",
    noAccounts: "这张截图中未识别到账户。",
    copyBlocks: "复制 blocks.json",
    copyExpected: "复制 expected.json",
    copyTitle: "已复制到剪贴板",
    copyBlocksSuccess:
      "blocks.json 已复制。请保存为 packages/ocr-eval/samples/<slug>/blocks.json。",
    copyExpectedSuccess:
      "expected.json 模板已复制。请核对并编辑字段后，保存为 packages/ocr-eval/samples/<slug>/expected.json。",
    copyFailed: "复制到剪贴板失败，请重试。",
    unnamed: "未命名账户",
    noBalances: "无数额",
    lastFour: "后四位：",
    kindLabel: "类型：",
    unknownKind: "未知类型",
    batchTitle: "批量采集",
    batchHint:
      "选择多张截图，每张在设备上跑 OCR 后打包成 zip（每张一个文件夹：blocks.json + screenshot.png）。分享 zip 到电脑后，运行 pnpm eval:ocr:import <文件夹>。",
    batchShareTitle: "分享 OCR fixtures",
    batchDone:
      "已采集 {{count}} 张截图。分享 zip 后，解压运行 pnpm eval:ocr:import。",
    shareFailed: "分享 zip 失败，请重试。",
  },
} as const;
