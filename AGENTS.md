# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

# Package Manager

Use pnpm exclusively for dependency installation and package scripts.

- Use the pnpm version pinned by the `packageManager` field in `package.json`.
- Keep `pnpm-lock.yaml` as the only dependency lockfile.
- Do not run `npm install`, `npm ci`, `npm run`, `npx`, Yarn, or Bun in this repository.
- Use `pnpm install`, `pnpm <script>`, and `pnpm exec <binary>` instead.

# Code Quality

ESLint enforces the Expo, React Native, React Hooks, TypeScript, and import
rules. Prettier is the only formatter.

- Run `pnpm lint`, `pnpm format:check`, and `pnpm exec tsc --noEmit` before
  submitting a change.
- Run `pnpm format` to format all supported, non-ignored files.
- Keep `eslint-plugin-prettier/recommended` after `eslint-config-expo/flat` in
  the ESLint Flat Config so formatting conflicts are disabled and formatting
  violations remain visible in the Expo lint gate.
- Keep `.prettierignore` minimal. Add an entry only when a generated or
  package-manager-owned file would otherwise be formatted; never add
  speculative or convenience-only ignores.
- Update the ESLint config, Prettier ignore file, editor settings, scripts,
  lockfile, and developer documentation together when changing code-quality
  tooling.

# Technical Decisions

Choose established, widely adopted solutions from the React Native or broader
React ecosystem for libraries, architecture, and integrations.

- Verify current official documentation, Expo and React Native compatibility,
  maintenance activity, ecosystem adoption, and production suitability before
  adding or replacing a dependency.
- Prefer the established React or React Native integration over a lower-level
  JavaScript library or a custom abstraction when it satisfies the product
  requirements.
- Do not treat a library used in a tutorial or example as the recommended
  production default without comparing it with the community-standard options.
- Do not introduce a niche library or custom framework when a maintained,
  community-standard solution meets the requirements.
- If the community-standard option cannot satisfy a concrete requirement,
  document the requirement and trade-off, and obtain explicit user approval
  before implementing the exception.

# README Translations

`README.md` is the English source and `README.zh-Hans.md` is its Simplified
Chinese counterpart. Keep both documents synchronized.

- Any change to either README must update the other README in the same change.
- Keep their section structure, product facts, commands, links, and status
  statements semantically equivalent.
- Preserve the language switch links at the top of both files.
- The product slogan is brand copy and must remain exactly
  `Your whole financial life, in one place.` in both versions unless the user
  explicitly approves a localized slogan.
