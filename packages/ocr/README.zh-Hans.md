# @whole/ocr

[English](./README.md) | [简体中文](./README.zh-Hans.md)

账户识别规则引擎。给它一张账户截图的 OCR 文本块，它回答：这屏上有哪些账户、叫什么
名字、每种币各有多少余额、账号后四位是什么、这是哪家机构。

纯 TypeScript，只有一个依赖（`zod`）——不依赖 React Native、Expo 或文件系统——所以
同一份代码能在 App 里经 Metro 运行、在 Node 里经评测 harness 和 CLI 运行，也能跑在
Vitest 下。

## 为什么要独立成包

引擎原本放在 `src/features/assets/`，紧挨着消费它的 App 代码。拆出来换来三件事：

- **可以被独立测试。** 不需要 Metro、原生模块或模拟器——`pnpm test:ocr` 跑完整套用例不到一秒。
- **边界是被强制的，而不只是约定。** 引擎的 `tsconfig.json` 设了 `"types": []`，
  所以它连误用 `process`、`window` 或原生模块都做不到。某条规则一旦需要这些，那正是
  它该待在 App 而不是这里的信号。
- **识别契约只有一个归属。** 币种、资产类型、后四位规则都定义在这里，由 App
  re-export，所以识别器永远不可能读出一个 App 存不下的币种。

## 目录结构

```text
src/
  contract/       “被识别的账户”是什么——App 与引擎必须达成一致的词汇表。
    currency.ts        knownAssetCurrencies、CURRENCY_SYMBOLS、currencySchema
    asset-kind.ts      knownAssetKinds、assetKindSchema、lastFourDigitsSchema
    balance.ts         accountBalanceSchema
    institution.ts     institutionIdSchema、InstitutionId
    recognized-account.ts  RecognizedAccount——引擎的输出
    block.ts           OcrTextBlock——引擎的输入
    fixture.ts         给评测 harness 用的 fixture 序列化
  engine/         把文本读成上述形状的规则。
    line-clustering.ts   扁平文本块 → 视觉行
    line-classify.ts     行 → 角色（accountName / amountRow / cardNumber / …）
    token-classify.ts    词 → 角色（currency / amount / label / …）
    amount.ts            “这是不是钱、多少、什么币”
    currency-mention.ts  币种出现在哪、以什么拼法出现
    kind.ts              现金 / 投资 / 加密
    account-grouping.ts  行 → 候选账户
    vocabulary.ts        所有机构共享的词表
    parser.ts            整条流水线，以及对外入口
  institutions/   叠加在共享规则之上的按机构覆盖。
    config.ts       识别信号、图标标签、产品关键词
    detect.ts       这张截图属于哪家机构
  test-support/   让测试读起来像截图的构造器
```

`contract/` 是自洽的——它只依赖 zod 和它自己，所以只需要词汇表的一方（App、评测
harness）可以单独取用，不必连带整套规则表。`engine/` 与 `institutions/` 则是有意
互相依赖的：`parser.ts` 在流水线中途解析机构 config，而 `institutions/` 又复用
engine 的 token 类型与共享词表。真正单向的是词表——共享词表住在
`engine/vocabulary.ts`，规则模块不必为了取词表去够 `institutions/`，机构 config
里也只留真正属于它自己的东西。

## 使用

```ts
import { parseOcrBlocks, type RecognizedAccount } from "@whole/ocr";

const accounts: RecognizedAccount[] = parseOcrBlocks(blocks);
```

`blocks` 是 `{ text, normalizedBox }`，位于 **0..1 归一化、左上原点** 空间——也就是
App 的 `ocr-engine.ts` 里 `normalizeOcrResult` 从原生 OCR 结果产出的东西。

`RecognizedAccount` 的每个字段都是可选的：引擎只报告它识别到的东西，不多报。
**它绝不会为了迁就表单能存什么而收窄输出**——表单拒绝的币种照样会被识别出来，由表单
在填充时丢弃。在这里丢掉，意味着将来表单一扩展就又要回头改 OCR。

`parseOcrBlocksTraced` 跑同一条流水线，同时返回中间态（聚类后的行、行级与词级角色、
识别出的机构）——当结果不对、你需要知道是哪条规则做的决定时，`pnpm ocr --trace`
打印的就是它。

`src/index.ts` 是唯一的入口。规则级内部件曾经从第二个入口
（`@whole/ocr/internals`）导出，供评测 harness 的 LLM 诊断工具使用；那套工具已被
删除，这个入口也随之删除。本包自己的单测直接从各自模块导入规则，不需要为了可测试而
登记成公开接口。

## 测试

```bash
pnpm test:ocr                            # 跑一次（仓库根目录）
pnpm --filter @whole/ocr run test:watch  # 改规则时的 watch 模式
```

测试与它所验证的规则放在一起（`engine/amount.test.ts` 挨着 `engine/amount.ts`），
这样规则和它的用例是一起改的。

`test-support/screen.ts` 是端到端测试可读性的关键——测试描述的是“屏幕长什么样”，
而不是手写坐标：

```ts
parseOcrBlocks(
  screen(row("Statement", "Savings", "Account"), row("SGD", "6,672.59")),
);
```

几何信息是真实的，不是占位：行间距足够让行聚类把它们分开，`columns([...])` 则用来
钉住 center-x，供多币种表格的测试使用——那里一笔金额属于正上方的那个币种。

### 改一条规则的循环

1. 在规则旁边加一个失败用例。
2. 改规则直到它通过。
3. `pnpm test:ocr`——确认没碰坏别的。
4. `pnpm eval:ocr`——确认对真实截图没有回归
   （见 [packages/ocr-eval](../ocr-eval/README.zh-Hans.md)）。

第 3 步和第 4 步回答的是不同的问题。单测说的是*这条规则是对的*；评测说的是*整个引擎
读真实截图的结果没有变*。两者都变好才是目标；只让前者变好、让后者退化，通常说明这条
规则原本还兜着一个你不知道的场景。

### 已知局限是被钉住的，不是被藏起来的

引擎有明知不完美的地方时，会有一个测试把真实行为钉住，并用注释说明它为何维持现状
——见 `engine/line-classify.test.ts` 里的“beyond the 10-digit amount ceiling”。
钉住它意味着将来的改动会以“一个决定”的形式浮现，而不是变成意外，也让测试对引擎的
真实行为保持诚实。

## 屏幕上写了什么，以及它意味着什么

引擎的难点不在于读出数字——那是 OCR 引擎的事——而在于判断哪些数字是余额。同一屏
会印出许多看起来一模一样、含义却完全不同的数字，`engine/vocabulary.ts` 里的共享
词表就是用来区分它们的：

| 屏幕上                            | 它是什么          | 如何处理                             |
| --------------------------------- | ----------------- | ------------------------------------ |
| `总资产`、`Total`、`净清算价值`   | 账户总额          | 先搁置；仅当整屏没有别的余额时才启用 |
| `7个账户`、`3 accounts`           | 下面是子账户列表  | 丢弃它上方的总额——下方的明细取而代之 |
| `信用额度`、`账单到期`            | 授信额度          | 绝不是余额                           |
| `您花了 4,766.92`                 | 欠款              | 余额取其负值                         |
| `-0.51%`、`今日变动`、`当日盈亏`  | 比率或变动        | 绝不是余额                           |
| `3.51亿美元`                      | 带亿/万倍数的数字 | 拒绝——解析器不做倍数换算             |
| `Transaction History`、`净现金流` | 账户列表到此为止  | 停止读取整屏                         |

弄错其中一条不是小错。把信用额度和账单到期金额与余额一起相加，会把一张 4,766.92
的卡读成 61,180.91；把广告语里的“3.51亿”读成 3.51，则会凭空造出一笔持仓。

**券商的持仓表是其中最有迷惑性的布局。** 它每一行都印着币种标签，但旁边的数字
其实已经折算成了账户的基础货币：IBKR 的“HKD 现金 15.8K 市场价值”是 15,800
**新币**，而不是 15,800 港币。把这样一行当作分币种余额来读会错两次——币种错，且
因为 `K` 未换算而差了 1000 倍。这些行不贡献任何余额；账户自己的总额（净清算价值）
已经把它们包含在内了。

## 新增一家机构

把 id 加进 `institutionIdSchema`（`contract/institution.ts`），再往
`institutions/config.ts` 的 `INSTITUTION_CONFIGS` 里追加一个
`InstitutionConfig`。`DETECT_INSTITUTIONS` 由这份 record 派生——凡是声明了识别
信号的机构都在其中——所以没有第二份清单需要同步。不要去改分类器或分组状态机：每家
机构的规则彼此隔离，所以一条 OCBC 的规则不可能弄坏 DBS 的解析。

**识别信号。** 优先选只有这家机构自己界面才会印出的东西。品牌名并不天然安全——
“IBKR”会出现在任何持有该股票的券商 App 的持仓列表里，所以 IBKR 改用它自己的术语
（`净清算价值`）来识别。信号还必须能区分兄弟机构：汇丰香港与汇丰新加坡共享品牌、
共享 App、连账号格式都一样，只有各自的旗舰产品名能把它们分开。

**一份 config 可以声明什么：**

| 字段                         | 用途                                                     |
| ---------------------------- | -------------------------------------------------------- |
| `detect`                     | 名称 token、产品名、账号格式                             |
| `accountKeywords`            | 这家机构的产品词，**包括中文**                           |
| `defaultCurrency`            | 只印裸数字的本土银行（招行整屏没有 ¥，只有 `76,007.05`） |
| `defaultKind`                | 账户名说不清时，这家机构持有的是什么                     |
| `iconTags`                   | 印在名字前的图标标签（`360`、`GSA`）                     |
| `accountNumberEndsAccount`   | 账号在后的布局（中银香港）                               |
| `accountNumberStartsAccount` | 账号在前的布局（招商永隆）                               |
| `accountNumberLastFour`      | 识别位不在末尾的账号（中银香港的校验位）                 |

中文账户词属于 `accountKeywords`，绝不要加进共享的 `defaultAccountKeywords`。在
全局范围内，“储蓄”和“账户”标注子账户行的频率不低于账户本身，会把一个账户炸成
好几个——在整个语料上实测，加了它们没有修好任何一项，反而让三个字段退化。收窄到
单个机构后歧义就消失了：“汇丰”只会用来命名汇丰香港的账户。

一家机构声明在 `institutionIdSchema` 里、但它的 config 没有任何识别信号，是有意
为之——它不会进入 `DETECT_INSTITUTIONS`，检测会返回 `"unknown"`，引擎按共享默认
规则运行。评测会把它记为一个已知的 `unsupported-institution` 缺口，而不是一次
失败。

## 相关

- [`packages/ocr-eval`](../ocr-eval/README.zh-Hans.md)——针对真实截图的回归 harness、
  `pnpm ocr <image>` CLI，以及 macOS 上的 Apple Vision 桥。
- `src/features/assets/ocr-engine.ts`（App）——唯一接触原生 OCR 引擎的模块。它产出的
  就是本包消费的文本块。
