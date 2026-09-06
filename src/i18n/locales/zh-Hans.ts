export const zhHansMessages = {
  common: {
    wordmark: "WHOLE",
    // 启动屏品牌 slogan：两个语言保持同一句英文原文，slogan 是品牌文案，
    // 任何语言都不翻译（见 AGENTS.md）。
    sloganLine1: "Your whole financial life,",
    sloganLine2: "in one place.",
    addAccount: "添加账户",
    backToAssetOverview: "返回资产总览",
    cancel: "取消",
    required: "必填",
    stepIndicator: "第 {{current}} 步，共 {{total}} 步",
  },
  // 机构显示名：OCR 识别出某机构时，用作自动归组的建议分组名。机构包括银行、
  // 加密货币交易所与券商，因此这份清单三者都涵盖——见 src/i18n/README.md 术语
  // 库。key 与 `@whole/ocr` 的 InstitutionId 枚举一一对应；新增机构时须同步补充
  // 对应 key，en/zh 的 i18n 类型系统会强制两者对齐。
  institutionNames: {
    ocbc: "OCBC",
    dbs: "DBS",
    alipay: "支付宝",
    bochk: "中银香港",
    ccb: "中国建设银行",
    cmb: "招商银行",
    cmbwl: "招商永隆银行",
    hsbchk: "汇丰香港",
    hsbcsg: "汇丰新加坡",
    bitget: "Bitget",
    okx: "OKX",
    ibkr: "盈透证券",
    trust: "Trust Bank",
    unknown: "未知机构",
  },
  home: {
    greeting: "你好，{{name}}",
    greetingFallback: "你好",
    totalAssetsLabel: "总资产，折合为",
    displayCurrency: "展示币种",
    chartRange: "图表时间范围",
    pastMonths_one: "过去 {{count}} 个月",
    pastMonths_other: "过去 {{count}} 个月",
    pastYears_one: "过去 {{count}} 年",
    pastYears_other: "过去 {{count}} 年",
    allTime: "全部时间",
    chartAccumulating: "正在积累图表数据…",
    chartFirstPoint: "已记录第一个数据点，走势从明天开始绘制。",
    chartEmptyPrompt: "添加第一个账户，你的资产走势从这里开始。",
    chartRatesUnavailable: "图表数据需要汇率。请连接网络后重新打开 Whole。",
    assetComposition: "资产构成",
    lessThanOnePercent: "<1%",
    netLiability: "负债",
    loading: "正在加载",
    accountCount_one: "{{count}} 个账户",
    accountCount_other: "{{count}} 个账户",
    accountCurrencies_one: "共 {{count}} 个币种",
    accountCurrencies_other: "共 {{count}} 个币种",
    cash: "现金",
    investments: "投资",
    digitalAssets: "数字资产",
    myAccounts: "我的账户",
    accountLoadError: "无法加载账户，请重新打开 Whole",
    accountDataPrivacy: "账户数据仅用于生成你的资产总览",
    delete: "删除",
    confirm: "确认",
    deleteAccount: "删除账户",
    confirmDeleteAccount: "确认删除账户",
    deleteAccountError: "无法删除账户，请稍后重试。",
    openAccountHint: "查看账户详情",
    showAssetAmounts: "显示资产数字",
    hideAssetAmounts: "隐藏资产数字",
    showAssetAmountsHint: "显示首页中的资产金额与比例",
    hideAssetAmountsHint: "将首页中的资产金额与比例替换为圆点",
    accountCountInGroup_one: "{{count}} 个账户",
    accountCountInGroup_other: "{{count}} 个账户",
    collapseGroup: "收起机构",
    expandGroup: "展开机构",
    // 账户行余额下方的说明：余额为负的账户是一笔欠款，不是资产。
    liability: "负债",
  },
  // 账户表单本身（AccountEditorFields）的文案，添加账户页、多账户向导与编辑
  // 账户页逐字共用——表单只有一个归属，它的标签也只有一份。各屏专属文案
  //（引导语、提示、保存与错误措辞）仍留在 `newAccount` / `accountDetail`。
  accountForm: {
    accountName: "账户名称",
    accountNameExample: "例如：DBS Multiplier",
    lastFourDigits: "账号后四位",
    accountBalance: "账户余额",
    invalidBalance: "请输入数字，例如 1234.56 或 -1234.56",
    duplicateCurrency: "该币种已有一行",
    incompleteLastFour: "请输入完整的四位数字，或留空",
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
    // 多账户向导里机构只填一次，放在分页表单上方，这句说明它管的是整批账户。
    batchGroupHint: "这批账户都会归入该机构，留空则不归组。",
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
  settings: {
    title: "设置",
    display: "显示",
    displayCurrencyHint: "首页总资产与各账户余额按这个币种折算。",
    language: "语言",
    languageFollowsSystem: "跟随系统设置",
    changeInSystemSettings: "在系统设置中更改",
    about: "关于",
    version: "版本 {{version}}",
    onDevice: {
      title: "识别在本机完成",
      description:
        "{{model}} 模型已存储在你的手机上并负责识别。它占用约 {{size}} 存储空间，识别时额外占用内存。",
      privacyNotice: "账户信息不会离开这台设备。识别可以离线完成。",
      test: "测试",
      testing: "正在加载模型…",
      testPassed: "本机模型可用",
      testFailure:
        "本机模型未能通过验证。请重启应用；若仍不行，请清理内存和存储空间。",
    },
    engine: {
      title: "识别引擎",
      // 选择本身：两条有名字的路线，各自的代价写在说明里——本地是存储和离线，
      // 云端是联网和数据出设备。让用户看着代价做决定。
      onDevice: "本机模型",
      onDeviceHint: "{{size}}，可离线使用，数据不离开手机",
      remote: "云端模型服务",
      remoteHint: "效果更强，需要联网——截图上的文字会发送到你配置的服务",
      download: "下载",
      downloading: "正在下载…",
      downloadFailed: "下载未完成。请检查网络后重试——已下载的部分会保留。",
      downloaded: "已下载",
      downloadHint: "占用约 {{size}} 存储空间，建议在 Wi-Fi 下下载。",
      deleteModel: "删除模型",
      deleteModelHint: "释放 {{size}}。删除后识别功能关闭，需重新下载。",
      notDownloaded: "未下载",
      partialDownload: "已下载一部分（{{size}} / {{total}}）",
      baseUrl: "服务地址",
      baseUrlHint: "服务商的 https:// 地址，例如 https://api.deepseek.com/v1",
      model: "模型",
      modelHint: "服务商提供的模型名称，例如 deepseek-chat",
      apiKey: "API 密钥",
      apiKeyHint: "仅保存在这台手机上，保存后不再显示",
      save: "保存服务",
      testing: "正在测试…",
      testPassed: "服务可用",
      testFailure: "服务没有响应。请检查地址、模型名称和 API 密钥。",
      clear: "移除服务",
      remotePrivacy:
        "使用云端服务时，Whole 从截图中读出的文字会发送到你配置的服务——截图本身不会发送。使用本机模型时，数据不会离开手机。",
    },
    engineSetup: {
      title: "识别功能已关闭",
      notReady:
        "请先在设置中选择一种引擎：下载本机模型（离线、隐私），或配置云端服务（需要联网）。",
      goToSettings: "打开设置",
    },
  },
  accountScreenshot: {
    uploadScreenshot: "上传账户截图",
    // 编辑账户页的紧凑入口：截图在这里是更新余额的手段，不是页面主体。
    updateFromScreenshot: "用新截图更新",
    replaceScreenshot: "更换截图",
    // 识别期间显示在表单区域。本机模型加载慢，用户要知道等多久、为什么等。
    recognizingHint: "正在读取截图，本机模型通常需要几十秒，表单会自动填入。",
    replaceScreenshotHint: "选择其他账户截图",
    screenshotReady: "账户截图已就绪",
    screenshotGuidance: "选择一张清晰显示账户名称、账号后四位和余额的截图",
    chooseScreenshot: "选择账户截图",
    screenshotPrivacy: "账户截图仅用于确认账户信息，不会显示在资产总览中",
    recognizing: "正在识别…",
    recognized: "已识别，请核对",
    recognitionFailed: "无法识别截图，请手动填写账户信息。",
    recognitionEmpty:
      "这张截图里没有找到账户。换一张能看清账户名称和余额的截图，或手动填写信息。",
    modelLoadFailed:
      "本机模型无法加载，它本该补上的信息这次缺失了。请核对已填入的内容，然后重启应用；若仍不行，请清理内存和存储空间。",
    remoteFailed:
      "云端服务无法访问。请到设置中检查服务地址、API 密钥和模型名称——其余内容已在本机读出。",
    modelUnusable: "模型没能读完这张截图。请核对已填入的内容，并补齐其余部分。",
    modelInterrupted:
      "本机模型运行中断，它本该补上的信息这次缺失了。请核对已填入的内容，并补齐其余部分。",
    ocrUnsupported: "当前设备不支持截图识别，请手动填写账户信息。",
    noMatchingAccount:
      "这张截图中没有你正在编辑的账户，因此未填入任何信息。请选择该账户的截图。",
    accountSaved: "账户已保存",
    cleanupPrompt:
      "这张账户截图已用于确认账户信息。是否从系统相册删除？系统会再次请求确认。",
    cleanupManualPhotoLibrary:
      "账户截图已经用完。不再需要时，可以到系统相册删除它。",
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
    nameSubtitle:
      "把银行、券商和交易所里的账户放到一张总览里。上传账户截图，余额自动识别。",
    privacyNote: "账户信息和截图都留在这台设备上，识别在本机完成。",
    nameLabel: "称呼",
    nameHint: "选填，用于首页问候。",
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
  // 应用级崩溃兜底的文案。AppErrorBoundary 直接从 resources 读取它，不经过
  // i18next 实例：兜底界面渲染时 I18nProvider 已经不在树上了。
  errorBoundary: {
    title: "出了点问题",
    description: "Whole 遇到意外错误，已经停在这里。你保存的账户数据不受影响。",
    detailLabel: "错误详情",
    detailHint: "重试后仍然出错时，复制下面的内容反馈给我们。",
    retry: "重试",
  },
} as const;
