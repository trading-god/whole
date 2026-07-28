# Whole

[English](./README.md) | [简体中文](./README.zh-Hans.md)

> **Your whole financial life, in one place.**

Whole 是一款注重隐私的跨平台财务总览应用，帮助用户在一个地方查看所有账户和资产。它基于 Expo 和 React Native 构建，支持 iOS、Android 和 Web。

当前产品原型聚焦于清晰的资产总览和引导式账户导入流程。用户可以选择账户截图、确认账户信息、将账户保存在本地，并在完成后决定是否删除原始截图。

## 产品原则

- **完整统一的视图**——将现金、投资和数字资产整合到一致的总览中。
- **清晰的用户控制**——账户信息由用户检查，删除等破坏性操作必须由用户明确确认。
- **隐私优先**——当前原型中的账户数据保存在本地，账户截图不会显示在资产总览中。
- **一致的产品语言**——集中管理和本地化产品文案，并通过统一的术语规范保持一致。

## 当前能力

- 展示账户余额和资产构成的资产总览
- 基于账户截图的引导式账户创建流程
- 使用 AsyncStorage 在本地持久化账户数据
- 在平台支持时，由用户选择是否删除原始账户截图
- 简体中文和英文界面
- 静态 Web 输出和可安装的 PWA 元数据
- 从单一源 Logo 生成 iOS、Android、Web 和应用商店图标

账户识别目前尚未接入 OCR 或 AI 服务。在当前流程中，账户信息由用户手动填写并确认。

## 技术栈

- [Expo SDK 57](https://docs.expo.dev/versions/v57.0.0/)
- React 19 和 React Native 0.86
- 支持类型化路由和静态 Web 渲染的 Expo Router
- TypeScript
- ESLint 和 Expo 推荐规则
- Prettier
- `i18next` 和 `react-i18next`
- `expo-localization`
- AsyncStorage
- `expo-image-picker` 和 `expo-media-library`

## 开始开发

### 环境要求

- Node.js 22.13 或更高版本
- `package.json` 中固定的 pnpm 11.11.0
- iOS 模拟器、Android 模拟器或受支持的 Web 浏览器

### 安装依赖

```bash
pnpm install
```

### 运行

```bash
pnpm start
```

也可以直接启动指定平台：

```bash
pnpm ios
pnpm android
pnpm web
```

## 质量检查

提交变更前请运行：

```bash
pnpm lint
pnpm format:check
pnpm exec tsc --noEmit
pnpm exec expo export --platform web
```

运行 `pnpm format` 可以格式化所有受支持的源码和文档文件。

本仓库只使用 pnpm。请保留 `pnpm-lock.yaml` 作为唯一的依赖锁文件。

## 项目结构

```text
config/locales/        原生权限文案翻译
public/                PWA manifest 和 Web 公共资源
scripts/               可重复运行的资源生成脚本
src/app/               Expo Router 路由和布局
src/features/assets/   账户存储、币种和截图清理
src/i18n/              运行时本地化、文案目录和术语规范
assets/branding/       品牌源文件
assets/app-icons/      生成的平台图标产物
eslint.config.js        Expo ESLint 与 Prettier 集成
.prettierignore         不参与格式化的生成文件
```

## 本地化与产品语言

Whole 使用 React 社区标准的本地化技术栈：

- `expo-localization` 检测系统 Locale。
- `i18next` 负责资源、fallback、插值和复数规则。
- `react-i18next` 将本地化能力接入 React 渲染生命周期。

运行时文案位于：

```text
src/i18n/locales/en.ts
src/i18n/locales/zh-Hans.ts
```

组件应通过 `useTranslation()` 使用语义化翻译 key；不要在 UI 代码中直接写入面向用户的文案。原生权限文案属于构建期配置，位于 `config/locales/*.json`。

英文统一使用 **account screenshot**，简体中文统一使用**账户截图**。不要使用 “bank screenshot” 或“银行截图”，因为 Whole 支持的金融账户并不局限于银行账户。完整术语规范见 [`src/i18n/README.md`](./src/i18n/README.md)。

## 隐私与截图处理

当前原型使用 AsyncStorage 在本地保存账户记录。用户选择的账户截图只用于账户确认流程，不会作为已保存账户记录的一部分持久化。

账户保存后，Whole 可以询问用户是否删除原始截图：

- 删除操作始终由用户发起；
- 操作系统可能再次请求确认；
- 浏览器环境无法删除用户设备中的原始文件；
- 如果系统无法定位或删除截图，Whole 会提示用户手动删除。

## 品牌资源

源 Logo 位于：

```text
assets/branding/whole-logo.svg
```

使用以下命令重新生成各平台资源：

```bash
pnpm generate:icons
```

不要手动修改生成的图标。需要调整时，应修改源文件或生成脚本。

## 工程决策

项目级开发和架构规则位于 [`AGENTS.md`](./AGENTS.md)。技术选型应优先采用维护活跃、在 React Native 或 React 社区中广泛使用的方案。任何例外都必须有明确的产品约束、记录完整的取舍，并获得明确批准。

## 许可证

[MIT](./LICENSE)
