# Readest fork 二次开发交接记录

最后更新：2026-07-22

这份文档记录本 fork 相对上游 Readest 的产品目标、已经完成的改造、验证结果、已知问题和后续计划。开始新的 fork 专属开发前，应先阅读本文；完成一个阶段后，应同步更新日期、提交、测试结果和未完成事项。

本文只记录可提交到仓库的技术信息。不得写入 GitHub 令牌、S3 密钥、签名密码、用户数据或其他本机秘密。

当前 Git 状态（截至最后更新）：

- `master` 与 `origin/master` 位于 `89a55d1e merge: automate GitHub releases`。
- S3 诊断工作位于 `codex/s3-diagnostic-apk`，诊断代码提交为 `be075e04`；本交接文档也在该分支维护。
- 诊断分支尚未合并到 `master`、尚未推送；应在后续修复和真机验收完成后再决定是否合并。
- 本地 `artifacts/` 目录只存放测试安装包，未纳入 Git。

## 1. 当前目标和长期约定

### 1.1 产品目标

- 维护一个面向个人使用和自托管场景的 Readest fork。
- 移除会员订阅、套餐等级和用户级云存储配额对功能的限制。
- WebDAV、Google Drive、S3、OneDrive 等第三方同步能力不再依赖高级会员。
- 支持在设置页面配置自定义 S3 兼容对象存储。
- 保留必要的登录和云账户能力，但不把登录等同于会员资格。
- 使用 fork 自己的 GitHub Actions 构建和发布安装包，不调用上游发布、R2、部署或更新器基础设施。

### 1.2 Git 工作流

约定的开发流程如下：

1. 每项二次开发从 `master` 创建独立分支，默认使用 `codex/` 前缀。
2. 先编写或调整测试，再实现功能。
3. 依次执行相关测试、类型检查、lint、Rust 检查和适当的集成/构建验证。
4. 用户真机验证通过后，再经明确授权合并到 `master` 并推送远端。
5. 不直接在 `master` 上开发，不在未经验证时创建版本 Release。

项目规则要求使用 `pnpm worktree:new <branch>` 创建 worktree。不过当前 fork 的脚本仍硬编码 `origin/main`，而远端默认分支是 `origin/master`，因此创建 fork 分支时会失败。2026-07-22 的诊断任务在干净工作区内使用 `git switch -c` 安全回退。后续应单独修复 worktree 脚本，让它自动识别远端默认分支；修复前不要假装 worktree 初始化成功。

## 2. 项目技术基线

- Monorepo：pnpm workspace。
- 主应用：`apps/readest-app`。
- 前端：Next.js 16、React、TypeScript、Zustand。
- 原生壳：Tauri v2、Rust。
- 桌面平台：Windows、Linux、macOS。
- 移动平台：Android、iOS/iPadOS；当前 fork CI 只构建 Android，不构建 iOS/iPadOS。
- 文件同步引擎：`src/services/sync/file/engine.ts`。
- 第三方存储 provider：WebDAV、Google Drive、S3、OneDrive。

构建前端和 Android 时必须使用 Node.js 20.9 以上。当前 GitHub Actions 使用 Node.js 24；本机默认 Node.js 18 会被 Next.js 直接拒绝。

## 3. 已完成工作

### 3.1 移除会员系统和功能门槛

开发提交：`313dc3cc feat: remove membership gates from cloud features`

合并提交：`4cb953de merge: open cloud sync and add fork release builds`

主要结果：

- 删除 Stripe、Apple IAP、Google IAP 的购买、校验、通知和对账代码。
- 删除套餐页面、购买入口、会员等级展示、Quota 组件和会员相关测试。
- WebDAV、Google Drive、S3、OneDrive、Send-to-Readest 等相关访问不再校验高级会员订阅。
- 第三方存储 provider 统一通过 `providerRegistry.ts` 接入文件同步引擎。
- 用户级套餐存储配额被移除。
- 仍允许部署方通过运行时配置设置统一的存储或翻译限额；未配置或配置为 `0` 时表示无限制。这是部署级保护，不是会员配额。
- 账户页面保留登录、账户信息和必要操作，不再展示订阅购买流程。

关键文件：

- `src/utils/access.ts`
- `src/services/sync/cloudSyncProvider.ts`
- `src/services/sync/file/providerRegistry.ts`
- `src/components/settings/IntegrationsPanel.tsx`
- `src/app/user/`
- `docs/architecture.md`

### 3.2 自定义 S3 对象存储

当前 S3 实现支持 SigV4 兼容 endpoint，包括 AWS S3、Cloudflare R2、MinIO、Backblaze B2 等。设置项包括：

- Endpoint
- Region
- Bucket
- Access Key ID
- Secret Access Key
- 上传书籍文件
- 完全同步
- 同步策略

实现采用 path-style 地址：`<endpoint>/<bucket>/<key>`。连接时会先执行列表请求验证 endpoint、bucket 和凭据。

安全与同步语义：

- S3 的 `enabled`、`deviceId`、`lastSyncedAt`、`providerSelectedAt` 属于设备本地状态。
- S3 配置和凭据可以进入加密的设置副本同步流程。
- 未加密备份默认移除 Access Key 和 Secret Key；只有用户明确选择包含凭据时才可带出。
- 诊断日志不得记录凭据或预签名 URL 查询参数。

关键文件：

- `src/types/settings.ts`
- `src/components/settings/integrations/S3Form.tsx`
- `src/services/sync/providers/s3/S3Provider.ts`
- `src/services/backupService.ts`

### 3.3 登录系统目前的作用

移除会员系统不等于删除账户系统。当前代码将“书籍文件存储”和“账户级同步”区分处理：

- 使用 S3/WebDAV/Drive 同步书籍文件本身不要求会员，也不应要求登录。
- 登录仍用于 Readest Cloud 身份认证以及账户级数据能力。
- 设置副本、阅读统计、字典、字体、纹理和部分账户数据仍可通过 Readest Cloud/副本同步处理。
- 选择第三方 provider 后，Readest Cloud 不再上传书籍文件；第三方 provider 成为书籍文件的主要存储位置。
- 因此，纯本地加自定义 S3 可以不登录；需要跨设备账户数据同步时，登录仍有意义。

### 3.4 fork 专用 GitHub Actions

初始提交：`49bf31a4 ci: add fork multi-platform release workflow`

修复提交：`129e2614 ci: disable updater artifacts in fork builds`

自动 Release 提交：`9741ea70 ci: publish installers on version changes`

对应合并提交：

- `4cb953de merge: open cloud sync and add fork release builds`
- `0173f6af merge: fix fork release updater signing`
- `89a55d1e merge: automate GitHub releases`

当前工作流：`.github/workflows/fork-release.yml`

行为：

- 每次推送到 `master` 自动运行。
- 构建 Android universal APK、Android ARM64 APK。
- 构建 Windows x64/ARM64 NSIS 安装包。
- 构建 Linux x64/ARM64 AppImage 和 deb。
- 构建 macOS Universal dmg。
- 普通 push 始终生成 Actions artifacts，并保留 30 天。
- 当 `apps/readest-app/package.json` 的版本相对 push 前发生变化时，自动创建 `v<version>` GitHub Release，并附加全部安装包和 `SHA256SUMS`。
- `workflow_dispatch` 可通过 `publish_release=true` 强制发布当前版本。
- 带连字符的 semver 被标记为 prerelease。
- 已存在的正式 Release 不会重复创建；中断留下的 draft Release 会被修复并发布。
- fork 构建通过 `src-tauri/fork-ci-tauri-config.json` 禁用 Tauri updater artifacts，避免缺少上游更新器签名密钥导致构建失败。

上游工作流已移至 `.github/upstream-workflows-disabled/`，GitHub 不会执行该目录中的 YAML。同步上游代码时，新出现的上游 workflow 应先放入禁用目录，完成 fork 审核和适配后才能启用。

当前 CI 不包含 iOS/iPadOS 安装包。iOS/iPadOS 自动发布需要 Apple Developer 证书、provisioning profile、App Store Connect 凭据和专门的签名/导出流程，不能把 macOS dmg 构建视为 iOS 构建。

Android 正式可更新签名依赖仓库 Secrets：

- `ANDROID_KEY_BASE64`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`

未配置时，CI 会生成临时证书；这种 APK 不同运行之间签名不同，无法覆盖升级。因此，面向长期真机使用或 GitHub Release 时必须配置稳定签名密钥并做好离线备份。

### 3.5 本地 Android 构建

2026-07-22 已验证的环境：

- Node.js 24.18.0
- Android Studio 内置 JDK 21
- Android SDK 36
- Android NDK `28.2.13676358`
- Rust stable，目标 `aarch64-linux-android`

核心构建命令：

```bash
cd apps/readest-app
pnpm tauri android build -t aarch64 -- --features devtools
```

本机没有 `src-tauri/gen/android/keystore.properties` 时，Gradle 会生成 unsigned release APK。真机诊断包使用本机 Android debug keystore 二次签名，仅供测试，不得作为正式 Release 证书。

2026-07-22 的本地诊断 APK：

- 路径：仓库根目录 `artifacts/readest-s3-diagnostic-arm64.apk`
- 大小：约 72 MB
- SHA-256：`091641cdffe17851fa167602cc706d11e3781d45a780f03f6428c76748cadb74`
- Android v2/v3 签名校验通过
- `artifacts/` 是本地产物，不应提交 Git

如需要代理，当前用户提供的本机代理为 `http://127.0.0.1:7890`。不要把代理写死进项目代码或 CI。

### 3.6 S3 真机诊断版本

分支：`codex/s3-diagnostic-apk`

提交：`be075e04 feat: add local S3 diagnostic logging`

目标是让 Android 用户不依赖 ADB，即可在应用内保存和导出诊断日志。该提交主要增加诊断能力，没有刻意改变同步成功/失败判定。

实现内容：

- 新增有界本地日志，最多保留最近 500 条且总 UTF-8 容量不超过约 256 KB；超限时优先淘汰最旧记录。
- 支持导出 JSONL、清除日志。
- 设置 → 集成 → S3 中提供 Diagnostic Logs 面板。
- 递归脱敏 Access Key、Secret Key、token、授权信息和 URL 查询参数。
- 记录 S3 流式上传/下载开始、完成和失败。
- 记录下载模式、预期/实际字节数、分片总数、成功/失败分片数，以及服务端是否对 Range 请求错误返回完整对象。
- 记录远端与本地文件大小及是否一致。
- 记录阅读器打开阶段、文件大小、类型、文件头和错误栈。

关键文件：

- `src/utils/diagnosticLog.ts`
- `src/__tests__/utils/diagnosticLog.test.ts`
- `src/services/sync/providers/s3/S3Provider.ts`
- `src/services/sync/file/engine.ts`
- `src/store/readerStore.ts`
- `src-tauri/src/transfer_file.rs`
- `src/components/settings/integrations/S3Form.tsx`

2026-07-22 的生产化收敛进一步区分了认证请求签名和书籍文件头签名字节：`signature`、`xAmzSignature` 等认证字段仍会脱敏，`signatureHex` 可以正常导出。正式构建不启用 Tauri `devtools` feature；诊断能力本身不引入大型依赖或资源。

## 4. S3 跨设备“无法打开书籍”调查

### 4.1 用户现象

1. 设备 A 配置自定义 S3，上传书籍和进度。
2. 设备 B 配置同一 S3，拉取已有书籍。
3. 曾出现“无法打开书籍”。
4. 用户观察到打开设置中的“完全同步”后，问题消失。

### 4.2 2026-07-22 日志结论

用户导出的成功日志只有 35 行，没有 `book-open-failed`：

- S3 对 Range 请求返回正常。
- 一个约 1.54 MB 的 EPUB 使用两个分片下载。
- `completedParts=2`、`failedParts=0`、`fullResponseParts=0`。
- `transferredBytes` 与 `expectedBytes` 完全一致。
- 本地文件大小与远端大小一致。
- 阅读器成功解析该 EPUB，共 17 个章节。
- 另一份本地 EPUB也成功解析并上传。

这排除了该次运行中的登录问题、S3 凭据问题、对象损坏、Range 不兼容和阅读器格式不支持。

最重要的细节是：日志里所有 `library-sync-start` 都是 `fullSync:false`。因此不能根据这份日志断言“真正的完全同步修好了文件”。更可能的解释是：切换设置触发了后续普通增量同步，或等待期间文件同步终于完成。

### 4.3 当前最可信的根因方向

按优先级排序：

1. 书籍元数据先进入书架，而书籍二进制文件仍未落盘，用户可以过早点击打开。
2. 增量同步的 index/etag 缓存认为远端未变化，但没有再次验证本地文件是否真实存在且大小正确。
3. 本地文件缺失或损坏时，阅读器只显示通用错误，没有触发一次自动修复下载。
4. Rust multipart 下载实现仍可能在某个分片失败后返回总体成功；诊断版本只统计这个情况，尚未改变行为。本次成功日志没有触发该缺陷。

目前没有证据支持“必须登录才能打开从 S3 同步的书籍”。

## 5. 下一阶段修复方案

修复应继续在新的独立分支中进行，并采用测试先行。建议拆为以下顺序：

1. 为“本地文件不存在但缓存/index 未变化”增加失败测试。
2. 在增量同步提前跳过前，校验本地文件存在性和远端/本地大小。
3. Rust multipart 下载要求每个分片都成功；任一请求、状态码或 body 失败必须让总体下载失败。
4. 校验 HTTP Range 语义、最终传输字节数和落盘文件大小，不能只以文件存在作为成功依据。
5. 书籍条目在文件未准备好时显示下载状态，禁止直接交给阅读器解析。
6. 打开书籍遇到文件缺失或明显不完整时，允许从当前第三方 provider 自动重新下载一次，然后再打开；必须防止无限重试。
7. 将“完全同步”改成语义明确的一次性“重新检查并修复”操作，或确保开关与自动同步行为一致。当前自动同步在 `useLibraryFileSync.ts` 中固定传入 `fullSync:false`，只有设置页的手动 Sync now 才读取该开关。

验收场景至少包括：

- 设备 B 第一次连接已有 S3，等待文件完成后可以打开。
- 元数据先到、文件后到时不会显示误导性的可打开状态。
- 删除设备 B 的本地书籍文件后，普通同步可以自愈。
- 制造本地短文件或大小不匹配后，普通同步可以重新下载。
- 模拟一个分片失败时，同步明确失败且不会写入成功标记。
- S3 服务端忽略 Range、返回 HTTP 200 全对象时，不会拼接出损坏文件。
- 不登录账户、只配置 S3 时仍可完成书籍同步和打开。

## 6. 测试与已知基线

诊断提交 `be075e04` 的验证结果：

- `pnpm lint`：通过，检查 1661 个文件。
- 诊断与文件同步相关 Vitest：6 个文件、65 条测试全部通过。
- `cargo fmt -p Readest`：通过。
- `cargo clippy -p Readest --no-deps -- -D warnings`：通过；输出中仍有工作区上游依赖自身的警告。
- `cargo test -p Readest --lib`：83/83 通过。
- Next.js Android 生产前端构建和 TypeScript 检查：通过。
- Android ARM64 release 构建：通过。

全量 `pnpm test` 的结果：

- 539 个测试文件中 538 个通过。
- 7252 条测试中 7246 条通过、3 条跳过、3 条失败。
- 失败全部位于 `src/__tests__/database/turso-node.test.ts` 的向量 L2 距离精度断言。
- 示例：期望 `5.0`，实际约 `4.99704122543335`；期望 `sqrt(2)`，实际约 `1.414939284324646`。
- 这是诊断改动之前已存在的 Turso/SQLite 向量实现或精度基线问题，与 S3 日志功能无关。

修复 Turso 测试时，应先确定底层扩展使用的向量编码和近似计算语义，再决定修实现或调整合理容差；不要仅为了全绿而盲目放宽断言。

## 7. 常用验证命令

从仓库根目录执行：

```bash
pnpm lint
pnpm test
pnpm --filter @readest/readest-app fmt:check
pnpm --filter @readest/readest-app clippy:check
pnpm --filter @readest/readest-app test:rust
node --test .github/scripts/release-metadata.test.mjs
```

单独运行文件同步与诊断测试时，当前可使用 Node 环境避免无关的 jsdom 开销：

```bash
pnpm --filter @readest/readest-app exec vitest run \
  src/__tests__/utils/diagnosticLog.test.ts \
  src/__tests__/services/sync/file/engine-auth-abort.test.ts \
  src/__tests__/services/sync/file/engine-metadata-sync.test.ts \
  src/__tests__/services/sync/file/engine-deletion-sync.test.ts \
  src/__tests__/services/sync/file/engine-sync-paths.test.ts \
  src/__tests__/services/sync/file/engine-cloud-copy-tracking.test.ts \
  --environment node --maxWorkers=1
```

## 8. 关键文件索引

| 主题 | 文件 |
| --- | --- |
| fork 交接记录 | `docs/fork-development-handoff.md` |
| 项目架构 | `docs/architecture.md` |
| 测试说明 | `docs/testing.md` |
| 访问与部署级限额 | `src/utils/access.ts` |
| 云 provider 选择 | `src/services/sync/cloudSyncProvider.ts` |
| 文件 provider 注册 | `src/services/sync/file/providerRegistry.ts` |
| 文件同步引擎 | `src/services/sync/file/engine.ts` |
| 自动文件同步 | `src/app/library/hooks/useLibraryFileSync.ts` |
| 通用同步设置 UI | `src/components/settings/integrations/FileSyncForm.tsx` |
| S3 设置 UI | `src/components/settings/integrations/S3Form.tsx` |
| S3 provider | `src/services/sync/providers/s3/S3Provider.ts` |
| 阅读器初始化 | `src/store/readerStore.ts` |
| 原生流式传输 | `src-tauri/src/transfer_file.rs` |
| 本地诊断日志 | `src/utils/diagnosticLog.ts` |
| fork CI | `../../../.github/workflows/fork-release.yml` |
| Release 版本判断 | `../../../.github/scripts/release-metadata.mjs` |

## 9. 每次后续开发的文档更新清单

完成 fork 专属任务后，至少更新：

- “最后更新”日期。
- 新分支、开发提交和合并提交。
- 功能行为与重要设计决策。
- 新增或改变的设置、Secrets、构建要求。
- 实际执行的测试及结果。
- 尚未解决的问题、风险和可复现步骤。
- 如果结论被新日志推翻，明确修改旧结论，而不是只在末尾追加矛盾描述。
