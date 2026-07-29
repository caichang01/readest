# Readest fork 二次开发交接记录

最后更新：2026-07-29

这份文档记录本 fork 相对上游 Readest 的产品目标、已经完成的改造、验证结果、已知问题和后续计划。开始新的 fork 专属开发前，应先阅读本文；完成一个阶段后，应同步更新日期、提交、测试结果和未完成事项。

本文只记录可提交到仓库的技术信息。不得写入 GitHub 令牌、S3 密钥、签名密码、用户数据或其他本机秘密。

当前 Git 状态（截至最后更新）：

- `master` 已合并生产化诊断、S3 书籍恢复、自建 Supabase 登录/数据库接入和 S3 设置副本缺失字段修复；第一大需求的合并提交为 `3c74c661 merge: complete self-hosted Supabase integration`。
- 自建 Supabase 的 Auth、数据库基线、存储统计 RPC、客户端构建配置、Web/API 部署、长期 Android 签名、跨平台候选构建、原生端登录、会话恢复和跨设备同步均已完成验收。
- 第二大需求“自有更新检查与发布链”已经合并到 `master`；正式 `v0.11.18` Release、
  fork updater 公钥、签名产物和 `latest.json` 已完成基线验收。
- 第三大需求“受控同步上游功能”在 `codex/upstream-sync-20260729` 开发；本轮目标上游
  基线为 `readest/readest:main` 的 `21e1ed5d`。
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

### 1.3 上游同步兼容原则

第三大需求采用“上游镜像、独立同步分支、分层解决冲突、完整验证后合并”的受控流程：

1. `origin/upstream` 只镜像 `readest/readest:main`，不得混入 fork 专属提交。
2. 每轮同步从已发布且验证通过的 `master` 创建 `codex/upstream-sync-*` 分支；禁止把
   未验证的 `origin/upstream` 直接合并到 `master`。
3. 使用普通 merge commit 保留共同祖先，不使用 squash 或 rebase 抹去上游合并边界，
   以保证下一轮仍可进行标准三方合并。
4. 文本自动合并不等于功能兼容。所有双方共同修改的文件都必须按产品行为重新审查，
   尤其是访问策略、登录、自建 Supabase、云同步、S3、更新器、版本和 GitHub Actions。
5. 新引入的上游功能如果与 fork 二次开发发生冲突，必须兼容已经验收的 fork 能力；
   不得为快速解决冲突而恢复会员门槛、用户云配额、支付/IAP、上游服务端点、上游更新
   公钥或上游发布流程。
6. 云同步优先采用上游持续维护的新架构，但必须保留自定义 S3 endpoint、凭据加密同步、
   settings 缺失字段回填、书籍自动恢复、生产化诊断和第三方存储免会员能力。多 provider
   行为必须同时覆盖 S3-only、Readest Cloud + S3 以及其他第三方组合。
7. 上游新增或修改的 `.github/workflows` 一律先进入
   `.github/upstream-workflows-disabled/`；活动工作流继续使用明确白名单，未经 fork 审核
   不得执行上游部署、R2、Docker Hub、商店或正式发布动作。
8. 冲突解决完成后必须执行 fork 不变量测试、目标回归、全量测试、原生检查、数据库验证、
   非发布跨平台候选构建和真机验收。只有这些检查通过，才可经用户明确授权合并
   `master`。

每次上游同步都要记录共同祖先、目标上游 SHA、冲突清单、兼容决策、测试结果和未完成
风险。上游版本号只作为代码来源参考；fork Release 必须保持合法且单调递增的 SemVer。

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
- 重复运行 `upgrade.sh` 命中迁移台账并安全跳过；PostgreSQL 18 的 `psql` 同时提示
  `\quit: extra argument "0" ignored`。这不影响本次退出和数据库状态，但说明
  `\quit 0/3/4/5` 的参数不可移植，错误分支也无法依赖该参数返回非零。
- 脚本修正将成功跳过改为无参数 `\quit`，将前置条件错误改为
  `RAISE EXCEPTION`；生成测试明确禁止带参数的 `\quit`。
- Readest 账户/存储管理页面验证与容器日志验证通过，不再出现
  `get_storage_by_book_hash`、`PGRST202` 或 fallback aggregation 警告。存储统计 RPC
  修复的真实环境验收完成。

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

2026-07-27 原生候选安装包构建：

- 在 `codex/self-hosted-supabase-auth` 分支的提交 `4e97c670` 上手动运行
  `Fork Release Installers`，参数为 `publish_release=false`。
- 元数据、Android、Windows x64、Windows ARM64、Linux x64、Linux ARM64 和 macOS
  Universal 作业全部成功；Android 同时完成 APK 签名与 zipalign 验证。
- 该次 Android 作业没有取得 `ANDROID_KEY_*` Secrets，因此使用了每次运行都会变化的
  临时签名证书；产物只能用于本轮安装测试，不能作为后续可覆盖升级的基线。
- `Publish GitHub Release` 按预期跳过，没有创建标签或正式 Release。
- 六组 Actions artifacts 已上传并保留 30 天，用于安装后的登录、会话恢复和跨设备同步
  验收。

2026-07-28 长期 Android 签名与候选构建验证：

- 仓库已配置 `ANDROID_KEY_BASE64`、`ANDROID_KEY_ALIAS` 和
  `ANDROID_KEY_PASSWORD`；文档和日志只记录 Secret 名称及使用结果，不记录任何值。
- 在当前分支提交 `9fa6e75f` 上手动运行 `Fork Release Installers`
  （Actions run `30322520270`），参数仍为 `publish_release=false`。
- Android 签名步骤成功，运行时日志明确输出
  `Using the stable Android signing key configured in repository secrets.`；随后 universal
  与 ARM64 APK 构建、签名校验、zipalign 校验和 artifact 上传全部成功，没有执行临时
  密钥回退。
- Windows x64、Windows ARM64、Linux x64、Linux ARM64 和 macOS Universal 作业也
  全部成功；`Publish GitHub Release` 按预期跳过。
- 六组 artifact 均以完整提交 SHA 命名并保留至 2026-08-27。此前安装过临时证书 APK
  的设备需要先卸载一次，才能安装首个长期签名 APK；从此以后，只要继续使用同一份
  keystore、alias 和密码，后续 APK 可以正常覆盖升级。

下一阶段：

1. Android 与 macOS 的登录、应用重启会话恢复、登出和重新登录已经通过。
2. 跨设备书籍和进度同步已经通过；笔记与其余设置仍应继续补充真机覆盖。
3. S3 endpoint、region、bucket 未进入服务器设置副本的问题已进入独立正式修复，见下一节。
4. 完成正式修复候选包的跨设备真机验证前，不把相关分支合并到 `master`。

### 3.3.2 设置副本缺失字段正式修复

分支：`codex/fix-settings-replica-backfill`

核心提交：`7d1a1675 fix: backfill missing replica settings`

2026-07-28 的真实现象与证据：

- macOS 已配置 Readest 登录和 S3 后，Android 登录同一账户时，S3 表单没有自动出现
  endpoint、region 和 bucket，界面长时间显示同步进行中。
- 数据库安全检查确认 `public.replicas` 的 settings 单例中存在已加密的
  `s3.accessKeyId` 和 `s3.secretAccessKey`，但不存在 `s3.endpoint`、`s3.region` 和
  `s3.bucket`。
- Android 手工补上缺失的非敏感字段后，临时恢复方案验证成功，证明认证、加密密钥解密
  和 S3 连接本身正常，故障位于设置副本字段不完整及表单未刷新。

根因：

- 应用启动时 `initSettingsSync(initialSettings)` 会用磁盘设置初始化已发布快照，防止新
  设备以本地默认值覆盖服务器权威设置。
- 如果 S3 是在登录前配置的，磁盘上已有 endpoint、region、bucket；登录后这些值因为
  与已初始化快照相同，不会被普通变更发布器视为新变更。
- 凭据同步使用独立哈希和加密流程，因此可能只把 Access Key、Secret Key 写入服务器，
  形成“有密钥、无连接元数据”的部分 settings 行。
- `S3Form` 原先只在组件挂载时把 Zustand 设置复制进 React state；副本拉取稍后到达时，
  已打开的表单不会更新。

正式修复行为：

1. settings 启动全量拉取成功后，收集服务器实际存在的字段路径；只用本地有意义的值
   补齐服务器缺失字段，绝不覆盖服务器已有字段。
2. 增量拉取的空结果只表示游标之后没有变化，不能解释为服务器字段缺失，因此不会触发
   回填。
3. `dictionarySettings.providerOrder` 等要求显式用户操作的字段仍不自动发布。
4. 加密字段继续遵守“凭据同步”开关和口令解锁流程；开关关闭时不会提示口令、不会上传
   S3 密钥。服务器已经存在的加密字段也不会重传。
5. 未激活且未被用户编辑的 S3 表单会在远端设置异步到达时刷新；如果用户已经开始输入，
   远端更新不会覆盖正在编辑的草稿。

验证结果：

- 回归过程先确认新增测试因缺少回填函数而失败，再完成实现。
- 设置发布、拉取编排和 S3 表单相关测试：3 个文件、60 条全部通过。
- `pnpm lint`：通过，TypeScript 与 Biome lint 无错误。
- `pnpm -w format:check`：通过。
- 全量 Vitest：541 个测试文件中 540 个通过；7259 条通过、3 条跳过、3 条失败。失败仍
  全部是 `turso-node.test.ts` 的既有向量距离浮点精度断言（期望 5、实际约
  4.997041），与本次设置同步修复无关。
- 分支推送触发的 `Fork Web and API Image`（Actions run `30327656397`）成功完成，
  并发布仅以本次提交 SHA 标识的候选镜像。
- 手动运行 `Fork Release Installers`（Actions run `30327709979`，
  `publish_release=false`）：Android、macOS Universal、Windows x64/ARM64、Linux
  x64/ARM64 全部成功；Release 作业按预期跳过。
- Android 使用仓库稳定签名密钥，universal 与 ARM64 APK 的构建、签名校验、
  zipalign 校验和 artifact 上传全部成功。六组 artifact 对应提交
  `e29ea9912e9c62317fe0664f75620809f2effad5`，保留至 2026-08-27。

合并前真机验收重点：

1. 设备 A 使用旧的“不完整 settings 行”启动新候选包，确认一次全量拉取后服务器自动
   补齐 endpoint、region、bucket。
2. 清空设备 B 的本地应用数据或使用未配置过 S3 的设备，登录并解锁凭据同步，确认 S3
   表单自动出现完整配置，随后手动连接成功。
3. 在设备 B 表单内先输入未保存内容，再等待或触发设置拉取，确认用户草稿不会被覆盖。
4. 确认书籍、进度和原有 S3 文件同步行为无回归后，方可合并到长期开发分支或
   `master`。

2026-07-28 真机验收结论：

- 用户确认本次正式修复候选版本测试验证通过。
- 设置副本缺失字段回填与跨设备 S3 配置恢复符合预期，未报告书籍、进度或原有 S3
  文件同步回归。
- 用户明确授权后，`codex/fix-settings-replica-backfill` 连同它所基于的自建 Supabase
  改造通过 `3c74c661 merge: complete self-hosted Supabase integration` 合并到
  `master` 并推送远端。
- 本次合并未改变应用版本号，因此正式流水线只生成验证 artifacts，不创建重复 Release。
- 合并提交触发的 `Fork Web and API Image`（Actions run `30334843862`）成功，发布
  `master`、`latest` 和不可变 SHA 标签的 Linux x64 GHCR 镜像。
- `Fork Release Installers`（Actions run `30334843848`）成功；Android、macOS
  Universal、Windows x64/ARM64、Linux x64/ARM64 全部完成构建和 artifact 上传，
  Android 同时通过长期签名、apksigner 与 zipalign 验证。`Publish GitHub Release`
  因版本号未变化按预期跳过。
- 第一大需求“自建 Supabase 登录系统”至此完成代码合并、远端推送和正式流水线验证；
  目标环境更新 `master/latest` 镜像后的冒烟测试属于部署收尾与持续运维。

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

### 3.4.1 自有更新检查与发布链

开发分支：`codex/self-hosted-updater`

开始开发时的现状：

- 稳定版更新清单和发行说明仍固定指向 `download.readest.com`，Tauri 桌面更新器还保留
  上游 GitHub Release 作为备用端点。
- 客户端内嵌的 minisign 公钥仍属于上游 Readest，不能验证本 fork 自己签发的更新。
- fork 流水线通过 `fork-ci-tauri-config.json` 设置
  `createUpdaterArtifacts=false`，只生成可安装包，不生成 Tauri 更新归档和 `.sig`。
- 当前 Release 作业只上传 APK、NSIS、AppImage、deb、dmg 和校验和，不生成或发布本
  fork 的 `latest.json`。
- Android 使用稳定 APK 签名密钥解决系统层覆盖安装，但 APK 签名与 Tauri/minisign
  更新清单签名是两条不同的信任链，不能互相替代。

目标设计：

1. 版本清单基础 URL 和公开验证密钥通过 fork 构建配置注入；仓库和日志不得包含更新器
   私钥或密码。
2. 使用 fork 独有的长期 Tauri/minisign 密钥为桌面更新归档、Android APK 和需要应用
   内替换的 AppImage 签名。
3. 版本变化时由 GitHub Actions 汇总各平台已签名产物，原子生成单一 `latest.json`，
   并与安装包一起发布到本 fork 的 GitHub Release。
4. 客户端稳定版更新只信任 fork 的端点和公钥，不再回退到上游更新服务；自定义域名可
   通过 HTTPS 反向代理或静态镜像同一份 Release 资产，而不改变签名内容。
5. macOS/Windows 安装版继续使用 Tauri updater；Linux AppImage 与 Android 使用现有
   自定义下载路径，但必须在安装前验证清单中的 minisign 签名。deb/rpm/Flatpak 不显示
   无法兑现的应用内更新操作。
6. 保持“版本号发生变化才创建 Release”的既有规则；普通 `master` 推送仍可构建候选
   artifacts，但不能改写稳定更新清单。

实施顺序：

1. 先为构建配置校验、平台清单映射和缺失签名拒绝行为编写失败测试。
2. 实现可配置端点与 Tauri overlay，并恢复签名更新产物。
3. 实现清单汇总、Release 上传和客户端签名校验。
4. 完成本地单元测试、lint、Rust 检查和候选 Actions 构建后，再进行旧版本到新版本的
   真机更新测试。

2026-07-28 第一阶段进展：

- 扩展 fork 原生环境生成器，要求提供 updater 的 HTTPS 基础 URL 和 Base64 编码
  minisign 公钥；旧的上游 updater 变量会从生成结果中移除，缺失、占位符、多行或
  不安全输入会在构建前失败。
- 同一生成器可以生成 `createUpdaterArtifacts=true` 的 Tauri overlay；overlay 只包含
  fork 的单一 `latest.json` 端点和对应公钥，不保留上游备用端点。
- 新增纯函数清单生成器，覆盖 Android universal/ARM64、Windows x64/ARM64、macOS
  Universal 和 Linux AppImage x64/ARM64；任何必需平台缺失、重复或没有 `.sig` 都会
  阻止发布。
- 测试严格按照红灯到绿灯执行：环境与 overlay 5 条、清单映射 3 条均通过；连同既有
  Release 元数据测试，全部 GitHub 脚本测试共 12 条通过。
- 第一阶段提交为 `0e209424 feat: prepare fork updater trust chain`；分支推送触发的
  `Fork Web and API Image`（Actions run `30337935839`）成功完成并发布不可变 SHA
  候选镜像。
- 尚未把新配置和清单生成器接入 `fork-release.yml`，也没有改变客户端端点、生成签名
  产物或发布 `latest.json`。在配置长期 Tauri 私钥前，不运行会发布更新的候选流程。

2026-07-28 第二阶段进展：

- GitHub 仓库已配置长期 updater 签名 Secret
  `TAURI_SIGNING_PRIVATE_KEY`、`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`，以及公开构建变量
  `NEXT_PUBLIC_UPDATER_BASE_URL`、`NEXT_PUBLIC_UPDATER_PUBKEY`；只核对了配置名称，
  没有读取或输出 Secret 内容。
- `Fork Release Installers` 会把 fork 更新端点和公钥写入原生应用环境，并在桌面构建时
  生成一次性 `fork-ci-tauri-config.generated.json`。该 overlay 开启 updater artifacts，
  只保留 fork 的一个 `latest.json` 端点；旧的静态禁用配置已删除，生成文件被
  `.gitignore` 排除。
- Android APK 在系统 APK 签名和对齐校验后，再用长期 Tauri/minisign 密钥生成相邻
  `.sig`；Windows NSIS、macOS `.app.tar.gz` 和 Linux AppImage 由 Tauri 构建器生成
  updater 签名。Release 汇总阶段要求恰好取得 7 份签名，缺失任何平台都会失败。
- Release 作业会收集各平台签名产物，生成带精确版本 Tag 下载 URL 的 `latest.json`，
  同时发布 `release-notes.json` 和 `SHA256SUMS`。清单覆盖 Android universal/ARM64、
  Windows NSIS x64/ARM64、macOS Universal 双架构键和 Linux AppImage x64/ARM64。
- 稳定版客户端的清单、发行说明和公开验证密钥改为由 fork 构建变量注入；fork CI 缺失
  配置会在编译前失败。Android、Linux AppImage 及既有 Windows portable 自定义下载
  路径均先验证 minisign 签名，验签失败会中止安装；macOS 和 Windows NSIS 继续由
  Tauri updater 完成验签和安装。
- 新增工作流契约与签名资产收集测试。Node 24 下，GitHub 脚本测试 17 条、updater 与
  constants 前端测试 183 条全部通过；受控全量测试覆盖 541 个文件，7263 条通过、
  3 条跳过，仅 `turso-node.test.ts` 的 3 条既有向量距离浮点精度断言失败。类型检查、
  Biome lint 和格式检查通过。本机未安装 Cargo，Rust 编译与现有验签单元测试交由
  跨平台候选 Actions 覆盖。
- 实现提交为 `5e014c22 feat: publish signed fork updates`。手动候选流水线
  `Fork Release Installers` 全部使用 `publish_release=false`，只验证各平台构建和签名
  产物，不创建 Release。
- 首次候选 run `30341766964` 发现 GitHub Variable
  `NEXT_PUBLIC_UPDATER_PUBKEY` 末尾误带一个 `%`；构建前校验按设计拒绝了无效 Base64，
  因而未使用错误信任链继续编译。修正公开变量且不输出私钥后，候选 run
  `30342573290` 成功验证 Windows x64/ARM64、Linux x64/ARM64 的构建、updater `.sig`
  收集与 artifact 上传；Android universal/ARM64 APK 也完成系统签名、对齐校验、两份
  minisign `.sig` 生成与 artifact 上传。
- run `30342573290` 进一步发现 macOS 矩阵把 bundles 强制限制为 `dmg`，Tauri 因没有
  构建 updater-enabled `app` 目标而不会生成 `.app.tar.gz`。提交
  `a92f41bf fix: build macOS updater bundle` 移除该限制，恢复与上游已验证 Universal
  构建参数一致的 `targets: all` 行为，并新增工作流回归断言。
- `5e014c22` 与 `a92f41bf` 对应的 Web/API 候选 runs `30341725849`、
  `30345475227` 均成功。包含 macOS 修复的最终非发布跨平台候选 run 为
  `30346451019`：Android、macOS Universal、Windows x64/ARM64、Linux x64/ARM64
  全部成功，Release 作业按预期跳过。
- macOS 在修复后生成并上传 updater-enabled Universal app 归档及签名；Android
  universal/ARM64 APK 完成长期系统签名、对齐校验和两份 minisign 签名。六组候选
  artifacts 均以提交 `a92f41bf3e09c349a587d90fdf8169dc0147f39a` 命名且未过期。
- 本轮只证明签名候选产物能在全部目标平台稳定生成，不代表正式更新链已经完成终端验收。
  合并前仍需用候选包验证应用功能；合并并提升版本号后，需再执行一次旧版本到新版本的
  `latest.json` 检查、下载、验签与安装升级测试。

2026-07-29 合并与首个正式 Release：

- 用户完成候选包基本功能验证后，`codex/self-hosted-updater` 通过
  `5ea031d2 merge: add fork-owned updater release chain` 合并到 `master` 并推送远端；
  应用版本按要求保持 `0.11.18`。
- 版本没有变化，因此 push 触发的 installer run `30412552352` 不具备自动发布条件。
  在相同提交的强制发布 run 排队后，该冗余非发布 run 被取消；这不影响独立的 Web/API
  run `30412552380`，后者成功发布 `master`、`latest` 和不可变 SHA 镜像。
- 手动以 `publish_release=true` 运行 `Fork Release Installers`
  （run `30413045061`）：Android、macOS Universal、Windows x64/ARM64、Linux
  x64/ARM64 和最终 Release 作业全部成功。
- 正式 `v0.11.18` Release 指向合并提交 `5ea031d2`，不是 draft 或 prerelease，并成为
  仓库 latest Release。20 个 Release assets 全部处于 uploaded 状态，包括各平台安装包、
  7 份 updater `.sig`、`latest.json`、`release-notes.json` 和 `SHA256SUMS`。
- 已解析正式 `latest.json`：版本为 `0.11.18`，Android universal/ARM64、Windows
  x64/ARM64、Linux AppImage x64/ARM64 以及 macOS x64/ARM64 共 8 个平台键均包含
  指向 `v0.11.18` 的精确下载 URL 和非空签名。GitHub latest Release API 也确认
  `latest.json` 的公开下载资产已上传。
- 本地通过 GitHub API 可以读取清单，但直接访问 GitHub Release CDN 时分别遇到
  HTTP/2 framing error 和 SSL connection timeout；这是本机到 CDN 的网络验证限制，
  不是 Release 资产缺失。后续仍应从真机网络打开公开下载地址做一次可达性检查。
- 已安装的 `0.11.18` 候选包不会把正式 `0.11.18` 判断为更高版本。本 Release 用作正式
  下载与信任基线；完整自动更新终端验收需要后续发布合法 SemVer `0.11.19`，再从
  `0.11.18` 执行检查、下载、验签和安装升级。

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

### 3.7 第三大需求：受控同步上游

开发分支：`codex/upstream-sync-20260729`

兼容合并提交：`3cf4cb67 merge: sync upstream 0.11.20 with fork compatibility`

本轮同步基线：

- fork 起点：`master` 的 `7042e8b5`
- 共同祖先：`c81547cd57a41a17688096338a27921e5690978d`
- 上游目标：`readest/readest:main` / `origin/upstream` 的
  `21e1ed5dfa7e9eaf7feb8fb1214df6251d96f27b`
- 相对共同祖先，fork 有 36 个独有提交，上游有 127 个独有提交；双方共同修改 37 个
  文件。

真实 merge 共产生 21 个文本冲突，主要分为云同步与设置界面、会员/支付访问策略、
依赖/锁文件三类。解决原则不是简单选择 ours/theirs，而是以上游新架构为基础，重新落实
fork 已验收的产品行为：

1. 接入上游多 provider 云同步：Readest Cloud、WebDAV、Google Drive、S3、OneDrive
   可以独立选择并同时运行；第三方 provider 使用稳定顺序、逐后端故障隔离和逐后端缓存。
2. 删除上游新架构带回的 `UserPlan`、套餐缓存、Premium badge 和同步暂停门槛。第三方
   同步与离线 TTS 音频下载均不读取会员状态。
3. 保留兼容旧设置的派生默认值：未出现 `readestCloud.enabled` 时，有第三方 provider
   则沿用旧的第三方-only 行为；一旦用户明确选择，`Readest Cloud + S3` 等组合可以同时
   生效。
4. 多后端上传会镜像到所有启用 provider；下载和书籍打开失败自动恢复会按稳定顺序尝试
   所有启用的第三方 provider。此前的 S3 文件完整性检查、自动恢复和诊断日志继续保留。
5. S3 endpoint、region、bucket、Access Key 和 Secret Key 的设置副本加密/回填能力
   保留；同时采用上游对连接元数据 push-hash 跟踪的改进，避免 WebDAV/S3 连接地址在
   登录前配置后滞留在单一设备。
6. Stripe、Apple/Google IAP 和支付实现继续保持删除；同步清理上游重新加入但已无调用
   的 Stripe 与 Google Auth 支付依赖。
7. 活动 GitHub Actions 仍只有 `fork-release.yml` 和 `fork-web-image.yml`。上游工作流
   继续位于 `.github/upstream-workflows-disabled/`，没有恢复上游部署、R2、商店或发布
   权限。
8. 应用代码版本随本轮上游基线进入 `0.11.20`。这只表示候选代码版本；在跨平台候选和
   真机验收完成前，不合并 `master`、不发布 `v0.11.20` Release。

本轮新增 `.github/scripts/fork-invariants.test.mjs`，持续检查：

- 活动工作流白名单；
- 会员、Quota、支付和 IAP 路径保持删除；
- 自建 Supabase、S3 自动恢复、诊断日志、设置副本和 fork updater 信任资产仍存在；
- fork Release 只使用自有更新端点、公钥和签名密钥。

截至 2026-07-29 的本地验证：

- fork 不变量测试：20/20 通过。
- 多 provider、设置状态、provider cache、同步编排、阅读器恢复、TTS 入口等定向
  Vitest：112/112 通过。
- TypeScript 与 Biome lint：通过，检查 1764 个文件。
- Biome format check：通过，检查 1798 个文件。
- 浏览器集成测试：27 个文件、321 条通过、1 条跳过。
- 浏览器扩展测试：6 个文件、44 条通过；生产 webpack 构建通过。
- 自建数据库 bootstrap/upgrade 生成测试均通过。
- `BUILD_STANDALONE=true` 的 Next.js 16.2.11 Web/API 生产构建通过。
- Turso 官方更新记录确认 SimSIMD 与 Rust 实现的 L2 距离存在平台级精度差异，并已在
  上游提高相关测试容差。本 fork 将 4 位小数的过严断言调整为 2 位小数，同时保留零
  距离、距离排序和向量类型行为验证；`turso-node` 53 条通过、1 条跳过。
- 全量 Vitest：603 个测试文件全部通过；7919 条通过、1 条跳过。
- 本机当前环境没有 `cargo` 和 `luajit`，因此 Rust fmt/clippy/test 与 KOReader Lua
  测试未在本机单独执行；不能把“工具未安装”写成测试通过。跨平台 Tauri/Rust 构建链
  已由下述 GitHub Actions 候选矩阵覆盖。

2026-07-29 的候选流水线验证：

- 开发分支已推送至 `origin/codex/upstream-sync-20260729`，候选提交为
  `fdd03ff823dbde35a0f65827b4ed7f90219487be`。
- `Fork Web and API Image` run
  [`30420126934`](https://github.com/caichang01/readest/actions/runs/30420126934)
  成功；仅推送该提交对应的不可变 `sha-*` 分支候选镜像，没有更新 `master` 或
  `latest` 标签。
- `Fork Release Installers` run
  [`30420151479`](https://github.com/caichang01/readest/actions/runs/30420151479)
  使用 `publish_release=false` 成功。Android、Windows x64/ARM64、Linux x64/ARM64、
  macOS Universal 六个构建任务全部通过，`Publish GitHub Release` 按候选模式正确跳过。
- 本次 run 生成并保留六组未过期 artifacts：
  `readest-android-fdd03ff8...`、`readest-windows-x64-fdd03ff8...`、
  `readest-windows-arm64-fdd03ff8...`、`readest-linux-x64-fdd03ff8...`、
  `readest-linux-arm64-fdd03ff8...` 和 `readest-macos-universal-fdd03ff8...`。
- 这次 CI 结果证明全部目标平台可完成编译、签名、打包和 artifact 上传，但不能替代
  Android/macOS 的账户、云同步、自动恢复及更新检查真机验收。

合并 `master` 前仍需完成：

1. 至少在 Android 与 macOS 验证登录/会话、Readest-only、S3-only、Readest + S3、
   跨设备书籍/进度/笔记/设置、删除本地副本后自动恢复和更新检查。
2. 用户确认候选验收并明确授权后，才以普通 merge commit 合并到 `master`。由于版本
   已从 `0.11.18` 变为 `0.11.20`，届时 master 流水线会创建新的正式 Release。

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

2026-07-29 已完成上述调查和测试修复。Turso 官方 changelog 明确记录了“提高 L2
测试容差以匹配 SimSIMD 与 Rust 精度”的同类修正；本项目实测误差最大约 `0.003`，
因此把相关 `toBeCloseTo` 从 4 位调整为 2 位，而没有改动数据库实现或放宽距离排序、
零距离等行为断言。修复后 `turso-node.test.ts` 为 53 条通过、1 条跳过；全量 Vitest
为 603 个测试文件、7919 条通过、1 条跳过、0 条失败。

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
| 设置副本发布与缺失字段回填 | `src/services/sync/replicaSettingsSync.ts` |
| 设置副本启动/增量拉取编排 | `src/hooks/useReplicaPull.ts` |
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
