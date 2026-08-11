# OCR 评测/回归集(验证集)

这不是"训练集"——iOS Apple Vision 与 Android ML Kit 是**预训练模型**,端上无法
fine-tune。这个目录的作用是驱动并验证 `src/features/assets/ocr-parser.ts`
(纯 TS 语义解析层)的正确性:**规则引擎是唯一被迭代的对象**,评测集则是它的
回归门。

解析层的目标范围是**自用常用银行**的多币种账户总览、单账户行,以及券商/Crypto
各一行。其余布局会落入"未识别 → 手动录入"的既有路径。

## 目录结构

```
packages/ocr-eval/
  src/
    run-eval.ts          # 编排器:跑全部样本,输出逐样本/逐字段结果
    annotate.ts          # LLM 标注器:大模型给 blocks.json(+ 截图)生成 expected.json
    compare.ts           # 字段级 gold 对比(accountName / lastFour / balances / kind)
    render.ts            # ASCII 表格输出
    paths.ts             # 包根/samples 等路径定位(基于 import.meta)
  samples/<slug>/
    blocks.json          # 设备端真实 OCR 输出(归一化 0..1 框)——入库,回归 fixture
    expected.json        # 人工标注的 gold RecognizedAccount[]
    screenshot.png       # 真实银行截图——私有,已被 .gitignore 忽略,不入库
    notes.md             # 可选:布局怪癖、易错点说明
```

## 如何运行

```bash
pnpm eval:ocr                                          # 跑全部样本(根目录)
pnpm --filter @whole/ocr-eval run eval -- --sample <slug>   # 只跑一个(本包内)
pnpm eval:ocr:label -- --sample <slug>                 # 用 LLM 生成/覆盖 expected.json(见下节)
```

全跑时若有失败样本,进程以非零退出(便于接入 CI 之类),只跑单个总是零退出。
输出:`✓/✗ 样本名`、失败样本的字段级原因(`· name: expected …, got …`)、末尾的
逐字段聚合表与总通过率。

## 用 App 调试采集屏新增样本(推荐)

上传/编辑账户的截图流程里有一个 **dev-only 入口**(标注 "OCR 采集"/"OCR
capture",仅 `__DEV__` 构建显示)。点进去即采集屏:选一张账户截图,自动跑一遍
真实设备 OCR 流水线(识别 → 归一化 → 语义解析),然后一键复制两份 fixture。
这样新增一个回归样本不再需要手工 `console.log` 记录 OCR 输出:

1. 启动 dev 构建(如 `pnpm exec expo start --dev-client`),进「添加账户」或
   「编辑账户」页,点「OCR 采集」入口。
2. 选一张你常用的银行账户截图。采集屏会显示识别出的账户(名称/后四位/各币种
   余额/类型)与 OCR 文本块数量。
3. 点「复制 blocks.json」,在仓库里新建 `samples/<slug>/blocks.json` 并粘贴。
4. 点「复制 expected.json」,对照截图核对采集屏给出的账户字段,保留正确的、
   删除不想要(不想要求)的字段,存成 `samples/<slug>/expected.json`。
5. 把截图本身放一份到 `samples/<slug>/screenshot.png`(仅本地排查用,已被
   `.gitignore` 忽略,不会入库)。
6. 跑 `pnpm --filter @whole/ocr-eval run eval -- --sample <slug>` 确认通过。

> 采集屏产物与 `src/run-eval.ts` 的 `blocksFixtureSchema` 完全对拍:它导出的
> `blocks.json` 就是 harness 重放的那个归一化 `{ blocks: [{ text, box }] }`
> 形状(见 `src/features/assets/ocr-fixture.ts` 的 `blocksJsonFromNormalized`)。

## 用 LLM 自动标注(可选)

不再逐个手抄 `expected.json` 时,可用大模型直接「看」blocks.json(+ 截图)生成 gold,
人工只需复核修订。

```bash
# 需要 OpenAI 兼容端点,配置方式二选一(真实 env 优先于 .env):
#
# A) 仓库根目录 .env(推荐——写一次,本地长期可用;.env 已被 .gitignore,不会进 git):
#    OPENAI_BASE_URL=https://api.openai.com/v1
#    OPENAI_API_KEY=sk-xxx
#    OPENAI_MODEL=gpt-4o
#    然后直接跑:
pnpm eval:ocr:label -- --sample <slug>
#
# B) 临时环境变量:
#    OPENAI_API_KEY=xxx OPENAI_BASE_URL=https://api.openai.com/v1 \
#    OPENAI_MODEL=gpt-4o pnpm eval:ocr:label -- --sample <slug>
#
# 不传 --sample 则对 samples/ 下所有有 blocks.json 的样本逐个标注。
# 默认多模态:会把 samples/<slug>/screenshot.png(如存在)以 base64 一起发给模型。
```

- 产出:把 `sample/<slug>/expected.json` **覆盖**成模型标注 + zod 校验过的
  `RecognizedAccount[]`;原有内容会先做备份为 `expected.json.bak`。
- 模型想「偷懒」给空数组时,会原样保留(人工覆核或删除即可)。
- `OPENAI_MODEL` 缺省 `gpt-4o`;任何 OpenAI 兼容端点(DeepSeek/Ollama/内部网关)都可用。
- **隐私**:多模态会把截图发到所配云端端点,截图是敏感数据,务必只在可信端点使用。

## 批量样本规范

- **一个 slug = 一张账户截图**。多币种账户、券商/Crypto 各一行都放同一个 slug,
  因为它们本来就是一次识别就能覆盖的一个账户。
- slug 命名:`<bank>-<account>` 或 `<bank>-<desc>`,全小写、连字符分隔。例如:
  `dbs-multiplier`、`ocbc-360`、`uob-one`、`crypto-binance`、`crypto-okx`。
- 每个样本目录:
  ```
  samples/<slug>/
    blocks.json       # 采集屏复制的 OCR 归一化文本块(入库,回归 fixture)
    expected.json     # 人工核对后的 gold RecognizedAccount[](入库)
    screenshot.png    # 真实截图(仅本地,已被 .gitignore 忽略,不入库)
    notes.md          # 可选:布局怪癖、易错点、多币种顺序说明
  ```
- 提交前自查:确认 `git status` 里**没有** `screenshot.*` 被跟踪——真实截图含
  敏感信息,永远只留在本地。
- 每次修 parser 规则 += 每个真实回归样本,通过率只升不降。

### expected.json 格式

采集屏复制出的 `expected.json` 模板可直接编辑;`RecognizedAccount[]` 里留哪些字段
就是"这个账户必须识别出哪些字段":

```json
[
  {
    "accountName": "DBS Multiplier",
    "accountLastFourDigits": "0423",
    "balances": [
      { "currency": "SGD", "balance": 1234.56 },
      { "currency": "USD", "balance": 789.1 }
    ],
    "kind": "cash"
  }
]
```

- 字段可选:gold 里不写 `accountLastFourDigits` 则该字段对解析器"不要求"。
- `kind` 缺省 `cash`。`balances` 若为空则对余额不要求。
- 每次修 parser 规则 += 每个真实回归样本,通过率只升不降。

## 对比规则(见 src/compare.ts)

- `accountName`:空白/大小写归一后相等。
- `accountLastFourDigits`:精确 4 位相等。
- `balances`:按币种多重集,金额容差 < 0.01。
- `kind`:精确。
- gold 要求但解析器缺失 = "miss"(计入失败),git 标注时写全。

## 坐标约定(关键)

`blocks.json` 存的是 **0..1 归一化、左上原点** 的框,与 `normalizeOcrResult` 的
输出一致(`ocr-types.ts`)。若你的设备采集用的是像素框,记得先除以图片宽高,
或采集时直接调用 `normalizeOcrResult(result, width, height)`。
