# OCR 评测/回归集（验证集）

[English](./README.md) | [简体中文](./README.zh-Hans.md)

这不是“训练集”——iOS Apple Vision 与 Android ML Kit 是**预训练模型**，端上无法
fine-tune。这个目录的作用是驱动并验证 [`@whole/ocr`](../ocr/README.zh-Hans.md)
里规则引擎的正确性：**规则引擎是唯一被迭代的对象**，评测集则是它的回归门。

与引擎包的分工：`@whole/ocr` 用合成输入对每条规则做单测（`pnpm test:ocr`），本
harness 则用真实录制的截图检验整个引擎。一条规则可以单独看是对的，读真实屏幕却仍然
出错——这就是两者都要存在的原因。

解析层的目标范围是**自用常用机构**的多币种账户总览、单账户行，以及券商/Crypto
各一行。其余布局会落入“未识别 → 手动录入”的既有路径。

## 目录结构

```
packages/ocr-eval/
  src/
    run-eval.ts          # 编排器：跑全部样本，输出逐样本/逐字段结果
    baseline.ts          # 已知失败基线：回归门禁 + 缺口分类
    compare.ts           # 字段级 gold 对比（accountName / lastFour / balances / kind / institutionId）
    render.ts            # ASCII 表格输出
    recognize.ts         # `pnpm ocr`——端到端识别单张图片（或单个样本）
    vision.ts            # macOS Apple Vision 桥驱动：screenshot.png → blocks.json（pnpm eval:ocr:vision）
    vision-bridge.ts     # Swift Vision 桥的共享编译与调用
    golden.test.ts       # 针对人工核对样本的硬断言（pnpm test:ocr:golden）
    verified-samples.ts  # 哪些 gold 已人工核对——golden.test.ts 与 vision.ts 共用
    baseline.test.ts     # 基线门禁自身差分逻辑的单元测试
    paths.ts             # 包根/samples 等路径定位（基于 import.meta）
  vision/
    recognize-text.swift # macOS 上的 Apple Vision OCR，对齐 iOS 端的请求配置
  baseline.json          # 逐样本/逐字段的已知失败——回归门禁的参照物
  samples/<slug>/
    blocks.json          # 真实 OCR 输出（归一化 0..1 框）——入库，回归 fixture
    expected.json        # 人工标注的 gold RecognizedAccount[]
    screenshot.png       # 真实账户截图——私有，已被 .gitignore 忽略，不入库
    notes.md             # 可选：布局怪癖、易错点说明
```

## 如何运行

```bash
pnpm ocr <image>                                       # 识别单张图片，打印引擎看到的内容
pnpm ocr --sample <slug> --trace                       # ……改为回放已入库的 fixture
pnpm eval:ocr                                          # 跑全部样本（根目录）
pnpm test:ocr:golden                                   # 对人工核对过的样本做硬断言
pnpm --filter @whole/ocr-eval run eval -- --sample <slug>   # 只跑一个（本包内）
pnpm eval:ocr:baseline                                 # 按当前结果重写 baseline.json
pnpm eval:ocr:vision                                   # macOS：screenshot.png → blocks.json（见下节）
#   … [--overwrite [--force]]   重新生成已存在的 fixture；真机采集的还需要 --force
#   … [--check]                 与已入库 fixture 做解析器级别的漂移对比
```

四条命令，各管一件事：临时识别（`ocr`）、录制 fixture（`eval:ocr:vision`）、
查回归（`eval:ocr`）、对已核对的 gold 做硬断言（`test:ocr:golden`）。凡是 coding
agent 读一读 `--trace` 输出和规则源码就能做的事，这里一律不做成脚本。

输出：`✓/~/✗ 样本名`、未通过项的字段级原因（`· name: expected …, got …`）、逐字段
聚合表，以及基线判定结果。

## 识别单张截图或单个样本（`pnpm ocr`）

从“这有一张截图”到“规则把它读成了什么”之间最短的一条路——不用真机、不用 dev 构建、
不用 gold：

```bash
pnpm ocr ~/Desktop/some-bank.png
pnpm ocr --sample ocbc-overview  # 改为回放已入库的 fixture
pnpm ocr <image> --json     # App 会拿到的 RecognizedAccount[]
pnpm ocr <image> --trace    # 逐行角色与识别出的机构
pnpm ocr <image> --blocks   # 规则跑之前的原始 OCR 文本块
```

```text
screenshot.png — 52 OCR blocks
──────────────────────────────────────────────

3 account(s) recognized:

1. 360 Account
   kind        cash
   institution ocbc
   SGD          6,672.59
…
```

用它在决定一个新机构值不值得做回归样本之前先看一眼它的布局；也用它迭代规则：改规则、
对着当初促使你改的那张截图重跑、立刻看到差异。当结果不对、你需要知道是哪条规则做的
决定时，看 `--trace`。

`pnpm eval:ocr` 报某个样本失败时，应该用 `--sample <slug>` 这个模式：它回放的正是
门禁所依据的那份 fixture，所以你看到的就是当时失败的东西——重新识别截图则会走一遍
可能读法不同的 Vision 版本。它也不需要 Swift 桥，因此是唯一能在非 macOS 上用的模式。
图片模式仅限 macOS——它通过 Swift 桥驱动 Apple Vision。

## 两种断言

gold 是关于“截图上写了什么”的断言，没核对过的 gold 等于把引擎钉死在一次猜测上，
所以 harness 有意把两种断言分开：

|          | `pnpm eval:ocr` | `pnpm test:ocr:golden`    |
| -------- | --------------- | ------------------------- |
| 覆盖     | 全部样本        | gold 已对照截图核对的样本 |
| 断言     | “不比基线更差”  | “输出必须正好是这样”      |
| 何时失败 | 出现回归        | 任何偏差                  |

目前 17 个样本全部达标：每份 gold 都逐字段对照截图核对过，其中两份在核对中被修正
——都是本 harness 曾经内置的 LLM 标注器对账号尾号的误读（`hsbc-hk-one`
0833 → 1833，`hsbc-sg-overview` 8221 → 2221）。17 份里错 2 份，而且错在人眼核对
最快的那个字段上——这就是标注器被删掉、且“亲眼核对”成为唯一准入条件的原因。

新增样本时，先亲眼把它的 gold 与截图核对，再提升进 `VERIFIED_SAMPLES`
（`src/verified-samples.ts`）。这是唯一的准入条件。

## 基线门禁（退出码由什么决定）

规则引擎的机构覆盖还在扩，所以“所有样本必须通过”这种门禁在改动前后都是红的——
等于什么都拦不住。真正的门禁是 `baseline.json`：它逐字段记录**当前已知**的失败，
只有**不在**其中的失败才会让运行失败。

- `✓ 样本` —— 与 gold 完全一致。
- `~ 样本` —— 失败方式和基线预期完全一致。只报告，不致命。
- `✗ 样本` —— **回归**：某个未记入基线的字段现在失败了，退出码 2。
- `resolved` —— 基线里的某个失败现在通过了。不致命，但应跑
  `pnpm eval:ocr:baseline` 把这个战果锁进基线，否则它以后悄悄退回也不会被发现。

只跑单个样本（`--sample <slug>`）属于交互式探查，总是零退出。

每个已知缺口都带原因，所以汇总告诉你的是“接下来该做什么”，而不只是“红成什么样”：

| 原因                      | 含义                                                        | 对应的修法                 |
| ------------------------- | ----------------------------------------------------------- | -------------------------- |
| `unsupported-institution` | 该样本的机构还没有识别信号（不在 `DETECT_INSTITUTIONS` 里） | 补一份 `InstitutionConfig` |
| `parser-bug`              | 机构确实识别到了，是规则本身判错                            | 修规则引擎                 |
| `gold-uncertain`          | gold 本身存疑（已写好但尚未对照截图核对）                   | 先核对 gold                |

`unsupported-institution` 与 `parser-bug` 由“gold 的 `institutionId` 是否已接入
检测”自动推断；`gold-uncertain` 永不自动推断——手工写进 `baseline.json`，用来把
一个 gold 未经人工核对的样本先挂起，`--update-baseline` 会保留这个人工判断。

新增样本只会抬高已知缺口数，不会让门禁变红，这正是设计意图：新样本是一次新的
测量，不是一个新的故障。先把它记入基线，再逐步把缺口做掉。

## 在 macOS 上用截图新增样本

扩样本最快的路径：把 `screenshot.png` 丢进 `samples/<slug>/`，本机直接生成
fixture——不用真机，也不用起 dev 构建。

```bash
mkdir -p packages/ocr-eval/samples/<slug>
cp ~/Desktop/whatever.png packages/ocr-eval/samples/<slug>/screenshot.png
pnpm eval:ocr:vision       # 给所有缺 blocks.json 的样本生成 fixture
#                          # 然后对着截图把 expected.json 写出来
pnpm eval:ocr:baseline     # 记录解析器在它上面的当前水平
```

写 `expected.json` 是一件靠眼睛的活：看截图，把它写的内容记下来。
`pnpm ocr --sample <slug>` 会打印引擎当前对这份 fixture 的读法，可以作为起点去修正
——但也仅仅是起点。一份天然与解析器一致的 gold 什么都断言不了，所以 gold 必须从截图
出发来写，解析器的输出只用来看两者在哪里不一致。

`vision/recognize-text.swift` 用与 iOS 端完全一致的请求配置跑 Apple Vision
（`.accurate`、开启语言纠正、`["zh-Hans", "en-US"]`、词级 box、左上原点）。这确实
是同一个框架——App 的 iOS 构建设了 `EXPO_MLKIT_OCR_DISABLE_MLKIT=1`，跑的就是
Vision 而不是 ML Kit。

**但同框架不等于同输出。** macOS 与 iOS 的 Vision 模型版本不同。在 17 个真机采集
样本上实测：

- **0/17** 产出逐块完全一致的 blocks——分词与读数都有差异。
- **16/17** 最终解析出的账户仍然完全一致。

所以 macOS 生成的 fixture 是一份真实的 Apple Vision 记录，足以快速覆盖一个新机构的
布局，但它**不等同于**已经入库的那批真机采集（见下节——App 里已经无法再采集新的
真机样本）。生成的 fixture 会带 `"source": "macos-vision"`
标记以保持这个区分，且这个标记是会被真正读取的：`--overwrite` 只重新生成 macOS
生成的 fixture，遇到真机采集会跳过（确实要替换请加 `--force`）；`--check` 也会跳过
committed fixture 本身就是 macOS 生成的样本——拿 macOS 的输出去比 macOS 的输出，
证明不了任何事情。

```bash
pnpm eval:ocr:vision -- --check   # 重跑所有截图，对比的是「解析结果」
```

`--check` 对比的是识别出的账户而非原始 blocks——因为 blocks 漂移是预期内的，账户
漂移不是。它只提供信息，不会让构建失败：一个样本在两个 Vision 版本下解析结果不同，
说明规则引擎依赖了不稳定的 OCR 细节，无论哪份 fixture“更对”，这都值得加固。

## 真机采集的 fixture（历史）

入库 fixture 中没有 `source` 字段的那些，是当年在 App 里通过一个 dev-only 采集屏
在真机上录下来的。那个采集屏已经移除——上面的 macOS Vision bridge 在设备之外覆盖
了同一条流水线，App 里不必再留一个对产品无用的识别工具。

这些 fixture 仍然入库、仍然是权威记录：它们是 iOS Vision 真实输出的唯一记录，这也
正是 `--check` 会跳过 macOS 生成样本、`--overwrite` 不加 `--force` 就拒绝覆盖真机
采集的原因。新增样本一律走 macOS 那条路。

> 无论谁写出 fixture，都不可能与 harness 重放的内容跑偏：`@whole/ocr` 的
> `contract/fixture.ts` 里的 `blocksFixtureSchema` / `blocksFromFixture` 定义了
> 唯一那个归一化 `{ blocks: [{ text, box }] }` 形状，且每份 fixture 在加载时都会
> 按它校验。

## 这个 harness 有意不做的事

它曾经带过一个 LLM 标注器（由截图生成 `expected.json`）、一个 LLM“教师”
（trace → 规则修复报告）、一个为其供料的 trace 导出器、一个机构识别打印器，以及一个
把 App 导出的 fixture 文件夹导入进来的导入器。这些全部已删除，理由值得留档：

- **导入器的输入源已经不存在。** 它读的是 App 里那个 dev-only 采集屏的批量导出格式；
  那个屏幕已被移除，取而代之的是 macOS Vision bridge。生产者没了，工具也就不成立。
- **那套 LLM 工具是 coding agent 的劣化版。** 教师只能出主意——写一份还得人去执行的
  markdown 报告；而 agent 直接读 `pnpm ocr --sample <slug> --trace`、读规则源码、改完
  再跑 `pnpm eval:ocr` 自我验证。标注器产出的 gold 反正要全量人工复核（17 份里错了
  2 个尾号），它省下的是打字，不是判断。
- **`detect` 与 `dump` 是别的命令的子集。** 识别出的机构本来就是 `eval:ocr` 会比对的
  字段、也是 `pnpm ocr --trace` 会打印的内容；trace 导出则纯粹是为教师供料。

删掉它们同时移除了本包的全部网络依赖：不再需要 `OPENAI_BASE_URL` /
`OPENAI_API_KEY` / `OPENAI_MODEL`，不再向任何端点发请求，截图也不再有任何离开本机
的路径。

## 批量样本规范

- **一个 slug = 一张账户截图**。多币种账户、券商/Crypto 各一行都放同一个 slug，
  因为它们本来就是一次识别就能覆盖的一个账户。
- slug 命名：`<institution>-<account>` 或 `<institution>-<desc>`，全小写、连字符
  分隔。例如：`dbs-multiplier`、`ocbc-360`、`uob-one`、`crypto-binance`、
  `crypto-okx`。
- 每个样本目录：
  ```
  samples/<slug>/
    blocks.json       # OCR 归一化文本块（入库，回归 fixture）
    expected.json     # 人工核对后的 gold RecognizedAccount[]（入库）
    screenshot.png    # 真实截图（仅本地，已被 .gitignore 忽略，不入库）
    notes.md          # 可选：布局怪癖、易错点、多币种顺序说明
  ```
- 提交前自查：确认 `git status` 里**没有** `screenshot.*` 被跟踪——真实截图含
  敏感信息，永远只留在本地。
- 每次修 parser 规则 += 每个真实回归样本，通过率只升不降。

### expected.json 格式

`expected.json` 由人工写出、可直接编辑；`RecognizedAccount[]` 里留哪些字段
就是“这个账户必须识别出哪些字段”：

```json
[
  {
    "accountName": "DBS Multiplier",
    "accountLastFourDigits": "0423",
    "balances": [
      { "currency": "SGD", "balance": 1234.56 },
      { "currency": "USD", "balance": 789.1 }
    ],
    "kind": "cash",
    "institutionId": "dbs"
  }
]
```

- 字段可选：gold 里不写 `accountLastFourDigits` 则该字段对解析器“不要求”。
- `kind` 缺省 `cash`。`balances` 若为空则对余额不要求。
- `institutionId` 为该截图所属机构——`institutionIdSchema`
  （`@whole/ocr` 的 `contract/institution.ts`）里的任意值。它按截图识别，同一样本
  里每个账户都带同一个值。不写则该样本不回归机构识别。
  - 写一个还没进 `DETECT_INSTITUTIONS` 的机构是有意为之：检测会返回
    `"unknown"`，该样本以 `unsupported-institution` 落入基线，缺口被记录而不是
    被遗忘。

## 对比规则（见 src/compare.ts）

- `accountName`：空白/大小写归一后相等。
- `accountLastFourDigits`：精确 4 位相等。
- `balances`：按币种多重集，金额容差 < 0.01。
- `kind`：精确。
- `institutionId`：精确（`institutionIdSchema` 中的任意值，含 `"unknown"`）。
- gold 要求但解析器缺失 = “miss”（计入失败）；要求该字段时请在 gold 中写全。这类
  失败是否致命由基线决定，而不是由 `compare.ts` 决定。

## 坐标约定（关键）

`blocks.json` 存的是 **0..1 归一化、左上原点** 的框，与 `normalizeOcrResult` 的
输出一致（`/ocr` 的 `contract/block.ts`）。若你的设备采集用的是像素框，记得先除以图片宽高，
或采集时直接调用 `normalizeOcrResult(result, width, height)`。
