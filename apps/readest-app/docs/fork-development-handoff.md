# Readest fork 二次开发交接记录

最后更新：2026-07-27

这份文档记录本 fork 相对上游 Readest 的产品目标、已经完成的改造、验证结果、已知问题和后续计划。开始新的 fork 专属开发前，应先阅读本文；完成一个阶段后，应同步更新日期、提交、测试结果和未完成事项。

本文只记录可提交到仓库的技术信息。不得写入 GitHub 令牌、S3 密钥、签名密码、用户数据或其他本机秘密。

当前 Git 状态（截至最后更新）：

- `master` 已合并生产化诊断功能和经过真机验收的 S3 书籍恢复修复。
- 自建 Supabase 登录与数据库接入正在分支 `codex/self-hosted-supabase-auth` 开发；Auth、数据库基线、客户端构建配置、Web/API 部署和登录验收已经完成，存储统计 RPC 修复正在合并前验证，因此尚不得提前合并到 `master`。
- 正式修复分支保留为 `codex/fix-s3-book-recovery`，核心提交为 `2bae62ab fix: recover incomplete synced books`，真机验收记录为 `9ef8f2f5 docs: record S3 recovery device validation`。
- 每次继续开发前仍应先获取并核对 `origin/master`，不要只依赖本文记录判断远端是否有新提交。
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

### 3.3.1 自建 Supabase 接入进度

开发分支：`codex/self-hosted-supabase-auth`

2026-07-27 已完成服务器端第一阶段：

- 目标环境为 Pigsty 管理的 PostgreSQL 18.4 和自托管 Supabase；不启动项目 `docker/compose.yaml` 中的第二套 PostgreSQL/Auth/Kong。
- 自托管 Auth 的 `JWT_SECRET`、`ANON_KEY`、`SERVICE_ROLE_KEY` 已统一轮换并验证 Admin API。
- 首个用户已创建并确认，随后通过 Pigsty 源配置设置 `DISABLE_SIGNUP=true`；未来仍可由管理员创建用户或临时重新开放注册。
- 登录系统公开域名、HTTPS、Kong、GoTrue 和 PostgREST 已完成健康验证。仓库不得记录实际域名、IP、邮箱或密钥。
- 用户选择保留完整 Supabase 服务栈并不配置 Swap；这是部署决策，不应通过代码擅自停用服务。
- PostgreSQL 已通过 Pigsty 配置 pgBackRest、S3 备份仓库和 PITR。此环境今后执行
  Readest 数据库迁移前，标准备份命令统一为 `sudo -iu postgres pig pb backup`；
  命令成功后再迁移，不默认追加临时 `pg_dump`。

数据库部署新增 `docker/volumes/db/self-hosted/`：

- `bootstrap.sh` 将当前基础 schema 与空库所需历史迁移组装后，通过标准输入交给管理员 `psql`。
- 基线在单个事务中执行；失败自动回滚。
- `readest_internal.schema_migrations` 记录基线版本，重复执行成功退出且不修改数据库。
- 已存在 Readest 表但没有预期版本记录时，脚本拒绝猜测和覆盖。
- `verify.sql` 验证 12 张业务表、RLS、同步列、replica allowlist 和迁移记录。
- `test-bootstrap.sh` 验证迁移选择，排除已折叠迁移和不能放进事务的在线迁移 016，并阻止生成 SQL 出现 ESC 控制字符。

真实环境验收结果：

- 第一次执行发现迁移提示行的 `\echo` 被 Bash `printf` 解释为 ESC 控制字符；`ON_ERROR_STOP` 触发后整个事务正确回滚，没有残留业务表。
- 修复生成方式并增加回归断言后，首次基线应用成功。
- 独立验收得到 1 个已确认 Auth 用户、12 张 Readest 表和 44 条 RLS policy。
- 第二次执行命中版本记录并安全跳过。
- 仓库级测试入口为 `pnpm test:self-hosted-db`。

2026-07-27 的 Web/API 候选部署与登录验收：

- 开发分支推送会构建仅含不可变 `sha-*` 标签的 Linux x64 GHCR 候选镜像，不会覆盖
  `master` 或 `latest`。
- 候选镜像已确认可匿名拉取，并部署到 QNAP Container Station；QNAP 反向代理为
  Readest 提供 HTTPS，Supabase 保持运行在同一 NAS 内的独立 Rocky Linux 虚拟机。
- `/runtime-config.js`、Readest Web 和已执行的登录流程均验证成功。仓库只记录部署
  拓扑和结果，不记录实际域名、IP、邮箱、anon key 或 `service_role` key。
- 运行日志发现 API 调用 `public.get_storage_by_book_hash(p_user_id)` 时收到
  `PGRST202`。上游 API 带有分页回退，所以登录和同步未失败；调查确认根因是上游代码
  引入 RPC 调用时没有同步提交数据库函数。

存储统计 RPC 正式修复：

- 新增 `018_add_storage_stats_rpc.sql`，在 PostgreSQL 内按 `book_hash` 聚合未软删除
  文件的数量和总大小，并保持 API 所需的 camelCase 返回字段。
- RPC 使用 `SECURITY INVOKER`，撤销 `PUBLIC` 执行权限，只允许 Readest 服务端使用的
  `service_role` 调用，并显式保证该角色拥有 `files` 的最小读取权限。
- 当前 `schema.sql` 和新装自建基线更新到 018；现有 017 基线不得重跑 bootstrap，
  而是使用新增的 `self-hosted/upgrade.sh` 前向迁移。
- `upgrade.sh` 在独立事务中执行迁移、记录台账并通知 PostgREST 刷新 schema cache；
  重复执行安全跳过。
- `verify.sql` 新增函数签名、018 迁移记录、`PUBLIC` 禁权和 `service_role` 授权检查。
- `pnpm test:self-hosted-db` 同时覆盖新装基线与 017 → 018 升级 SQL 生成。

本修复的本地验证：

- `pnpm test:self-hosted-db`：新装基线与升级生成测试均通过。
- `bash -n`、`git diff --check`、`pnpm format:check` 和 `pnpm lint`：通过。
- Node 24.14.0 全量 `pnpm test`：539 个测试文件通过，7253 条测试通过；仍只有
  `turso-node.test.ts` 中 3 条既有向量距离浮点精度断言失败，与本数据库迁移无关。
- 本机没有 PostgreSQL、`psql` 或 Docker，因此实际 SQL 执行、PostgREST schema cache
  刷新和 RPC 返回值集成验证留给已备份的 Pigsty 测试步骤；完成前不宣称真实迁移通过。

2026-07-27 Pigsty 真实迁移验证：

- `sudo -iu postgres pig pb backup` 成功完成 pgBackRest S3 增量备份，备份结束与保留
  清理均正常；仓库不记录实际 bucket、endpoint 或密钥。
- 017 → 018 升级在单个事务中成功执行：创建 RPC、撤销 `PUBLIC` 权限、授予
  `service_role` 表读取与函数执行权限、写入迁移台账、发送 PostgREST reload 通知后
  提交。
- `verify.sql` 执行通过，得到 1 个 Auth 用户、12 张 Readest 表、44 条 RLS policy；
  台账同时包含 017 基线与 `018_add_storage_stats_rpc`。
- 尚待重复运行 `upgrade.sh` 验证安全跳过，并从 Readest Web/API 日志确认不再出现
  `get_storage_by_book_hash` 的 `PGRST202` 回退警告。

2026-07-27 完成客户端与 Web/API 配置阶段：

- `.github/scripts/prepare-fork-env.mjs` 从 GitHub Variables/Secret 生成原生构建专用 `.env.local`。
- Android 和桌面 fork Release 构建现在必须提供 `NEXT_PUBLIC_SUPABASE_URL`、
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`、`NEXT_PUBLIC_API_BASE_URL`；缺失、占位符、非 HTTPS
  或多行值会中止，不能继续回退到上游后端。
- `.github/workflows/fork-web-image.yml` 只构建 Linux x64 的 fork Web/API 镜像并发布
  到当前仓库所有者的 GHCR；`codex/**` 开发分支只发布不可变 `sha-*` 候选标签，
  `master` 才更新 `master` 和 `latest`，没有恢复上游 Docker Hub、多架构或正式部署
  流程。
- `docker/compose.external-supabase.yaml` 只启动 Readest Web/API，不管理 Pigsty 或现有
  Supabase 容器。`docker/.env.external-supabase.example` 将客户端 anon key 与仅服务端
  `service_role` key 明确分离。
- `docker/EXTERNAL_SUPABASE.md` 记录镜像部署、反向代理、回调 allowlist、GitHub 配置和
  最小验收顺序，不包含真实域名、IP、邮箱或密钥。
- GoTrue 回调最少需要 Readest Web 的 `/auth/callback` 精确 HTTPS URL 与
  `readest://auth-callback`；现有 Tauri 配置已注册 `readest` scheme，无需改 Rust。

本阶段验证：

- `node --test .github/scripts/*.test.mjs`：8 条通过。
- `pnpm lint`（Node 24.14.0）：通过。
- `pnpm format:check`：通过。
- `BUILD_STANDALONE=true pnpm --filter @readest/readest-app build-web`（Node 24.14.0，
  使用虚拟 HTTPS 配置）：通过，生成 standalone server 和动态 `/runtime-config.js`。
- 全量 `pnpm test`（Node 24.14.0）：539 个测试文件、7253 条测试通过；仅
  `turso-node.test.ts` 中 3 条既有向量距离浮点精度断言失败，与本阶段改动无关。
- 本机没有 Docker CLI，`docker compose config` 尚未执行；YAML 与 dotenv 静态语法
  检查通过，必须在目标服务器部署前补跑 compose config。

下一阶段：

1. 再次运行 `self-hosted/upgrade.sh`，确认命中迁移台账并安全跳过。
2. 重新访问账户存储管理页面，确认 Web/API 日志不再出现
   `get_storage_by_book_hash` 的 `PGRST202` 回退。
3. 使用真实后端地址构建新的 Android 与桌面候选安装包。
4. 执行令牌刷新、登出、跨设备书籍元数据/进度/笔记与自定义 S3 真机同步测试。
5. 完成上述测试前，不把本分支合并到 `master`。

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

## 5. S3 书籍完整性正式修复

分支：`codex/fix-s3-book-recovery`

提交：`2bae62ab fix: recover incomplete synced books`

已经完成：

1. 流式和缓冲下载只有在落盘文件存在、且本地大小与远端对象大小一致时才记为成功；不完整文件不会再写入 `downloadedAt` 或加入书架。
2. 普通增量同步会对远端已确认存在的书籍做轻量本地文件检查。本地文件被删除时，即使 `library.json` ETag 没变化，也会重新下载并更新已有书籍记录。
3. Rust multipart 下载要求每个分片都是 HTTP 206，`Content-Range`、分片边界、对象总大小和 body 长度必须完全匹配；任一请求、读、seek 或 write 失败都会让总体下载失败。
4. 单线程下载在服务端提供 `Content-Length` 时也会校验最终传输字节数。
5. 阅读器在 app 管理的本地书籍加载或解析失败时，如果当前使用 S3/WebDAV/Drive 且远端有副本，会自动重新下载、持久化书籍记录并重试一次。外部文件、RSS/PSE 流和 Readest Cloud 不走该恢复路径；一次性保护避免无限循环。
6. 设置中的“Full Sync（完全同步）”改为一次性操作：它只影响下一次手动同步，执行完成后自动关闭；普通自动同步仍使用增量模式。
7. 原有本地诊断功能继续保留，并新增恢复开始、完成、失败及大小不匹配等事件。

自动化测试已经覆盖：

- 远端新书正常下载并加入本地书架。
- 短文件/大小不匹配不会记为成功。
- 本地文件丢失且远端 ETag 未变化时仍会自愈。
- HTTP 200 全对象不能冒充 Range 分片；短分片和错误 `Content-Range` 会被拒绝。
- 阅读器第一次解析失败后恢复并重试；恢复最多执行一次。

2026-07-23 真机验收通过：设备 B 普通同步正常；选择“仅从设备中移除”后，直接点击书籍会自动从 S3 下载并正常打开。

已记录但本阶段不修复：书籍卡片右下角的云朵图标仍沿用 Readest Cloud 登录流程，点击后会跳转登录页，即使当前活动 provider 是 S3。后续应把该入口也路由到活动的第三方 provider；不要把它与本次已验收的下载完整性修复混在同一提交中。

## 6. 测试与已知基线

正式修复提交 `2bae62ab` 的验证结果：

- `pnpm lint`：通过，检查 1663 个文件。
- 文件同步相关 Vitest：13 个文件、152 条测试全部通过。
- 文件同步加阅读器相关 Vitest：14 个文件、177 条测试全部通过。
- `rustfmt --check src/transfer_file.rs`：通过。
- `cargo clippy --lib`：通过；工作区上游依赖仍输出既有 warning。附加 `-D warnings` 会被上游 `tauri-utils` 的 MSRV warning 阻断，不是本次代码产生。
- `cargo test -p Readest --lib`：86/86 通过。
- TypeScript 检查和 Biome lint：通过。
- Android ARM64 release 构建（不启用 devtools）：通过，同时生成 unsigned APK 和 AAB。
- 真机验收 APK：`artifacts/readest-s3-recovery-arm64.apk`，75,899,751 bytes，SHA-256 `72706f152cec40cfbfe6460111a0f2c6ad55001373d0431cb1553fb10dd4cf15`；使用本机 Android debug 证书签名，APK v2/v3 校验通过，仅供测试。

全量 `pnpm test` 的结果：

- 540 个测试文件中 539 个通过。
- 7259 条测试中 7253 条通过、3 条跳过、3 条失败。
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
| 阅读器第三方存储恢复 | `src/services/sync/file/readerBookRecovery.ts` |
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
