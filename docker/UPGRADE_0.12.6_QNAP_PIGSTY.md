# Readest 0.12.6：QNAP 镜像更新与 Pigsty 数据库迁移

适用：Readest Web/API 部署在 QNAP Container Station；Supabase 位于独立 Rocky Linux
虚拟机。先迁移数据库，再更新 Readest。无需停止或重建 Supabase。
本教程不表示生产操作已经执行。

## 1. 准备与备份

确认 master 对应的 **Fork Web and API Image** Actions 构建成功后再部署。
保存现有 Container Station 应用的 YAML、环境配置和旧镜像精确标签/摘要，供回退使用。
这些文件可能包含密钥，只在本地安全保存，不要提交或粘贴到聊天中。
升级期间退出客户端，可暂时停止 Readest Web/API 容器以减少写入；不要停止 Supabase。

在 Mac 终端执行：

```bash
ssh -t rockyadmin@192.168.31.18 'sudo -iu postgres pig pb backup'
```

确认备份成功才继续。`--backup-completed` 是人工确认标志，不会替你执行或检查备份。

## 2. 从 Mac 上传并执行数据库迁移

```bash
cd /Users/caiminxing/Code/readest
git switch master
git pull --ff-only origin master
docker/volumes/db/self-hosted/deploy-remote-upgrade.sh \
  --host rockyadmin@192.168.31.18 \
  --backup-completed
```

脚本通过 SSH/SCP 上传迁移与验证文件，在远端调用 PostgreSQL，不需要服务器 git clone。
会提示 SSH/sudo 认证。请逐行复制，不要加入 Markdown 星号或转义 `--host`。

原数据库已经执行 019 时，本次新增：

| 编号 | 内容 |
| --- | --- |
| 020 | 阅读统计批量 upsert RPC |
| 021 | 可选统计归档表/RPC 和权限 |
| 022 | 归档批次行数限制 |
| 023 | 书籍分组更新时间 |
| 024 | Audiobookshelf 副本类型 |

成功应显示 `Readest database upgrade and verification completed successfully.`，
迁移记录包含 020–024，验证的 Readest 表数为 15。已经执行过的迁移会跳过；
`already current; no changes made` 表示无需重复修改。保留打印出的远端审计目录。
仅安装归档基础结构，不会自动启用统计归档。

遇到 ERROR 或验证失败时，停止后续部署并保留脱敏输出。
不要对现有数据库运行初始化/bootstrap，不要删除或重建用户、书籍表。

## 3. 更新 QNAP Container Station 镜像

在 Mac 仓库中取得本次主线对应的不可变镜像标签：

```bash
git rev-parse origin/master
git rev-parse --short=7 origin/master
```

确认此提交的镜像构建成功，使用 `ghcr.io/caichang01/readest:sha-` 加上第二条命令的
7 位结果。也可使用 `ghcr.io/caichang01/readest:master`，但该标签会随以后主线推送移动。

在 QNAP Container Station 中打开现有 Readest 应用配置：

1. 如果由 Compose 管理，只更新原 YAML 的 `image` 或其 `READEST_IMAGE` 变量。
2. 保留现有端口、网络、反向代理、卷与环境变量，不要套用默认网络配置覆盖已工作的配置。
3. 拉取新镜像，并使用更新/重新创建容器功能应用它；只点击“重启”不会更新镜像。
4. 等待容器启动及健康检查通过。不同 Container Station 版本的按钮名称可能不同。

本次没有新增必填环境变量。保留 Supabase、API 域名、S3 和密钥配置；
仓库 Compose 的 `SUPABASE_SERVICE_ROLE_KEY` 会映射为容器内的 `SUPABASE_ADMIN_KEY`。
无需重新生成 JWT、签名密钥或修改 Supabase 域名。

如果原部署使用仓库提供的 Compose 文件，也可在 **NAS 的实际部署目录**执行
以下命令（先更新其 `.env.external-supabase` 中的 `READEST_IMAGE`）：

```bash
sudo docker compose --env-file .env.external-supabase -f compose.external-supabase.yaml pull readest
sudo docker compose --env-file .env.external-supabase -f compose.external-supabase.yaml up -d --no-deps readest
sudo docker compose --env-file .env.external-supabase -f compose.external-supabase.yaml ps
sudo docker compose --env-file .env.external-supabase -f compose.external-supabase.yaml logs --tail=100 readest
```

不要在 Supabase VM 上运行这些 Readest 容器更新命令，也不要执行 `down -v`。

## 4. 验收

从 Mac 检查 HTTPS 入口：

```bash
curl -sS -o /dev/null -w 'http=%{http_code}\n' https://readest.caichang01.cn/runtime-config.js
```

预期 HTTP 200；这只是服务可达检查，不能代替登录和同步验证。
检查 Readest 日志无新增数据库缺表/缺列/缺 RPC 错误，然后验证：

- 登录、重启恢复、登出，以及跨设备进度、笔记、设置和 S3 凭据同步。
- 普通同步建立书架与封面，正文打开时下载；这是本轮确认采用的按需下载行为。
- “仅从设备移除”后普通同步不立即下载，点击打开能自动恢复；下载后离线重开正常。
- 分组和书籍元数据跨设备修改，以及 fork 更新检查。

客户端安装包由独立的 Fork Release Installers 流水线发布；镜像成功不代表所有安装包
已经发布，待对应 Release 构建成功再安装升级。

## 5. 异常回退

优先将 Readest 换回记录的旧镜像，保持原环境变量与数据卷。
不要直接删除新增数据库对象或回滚整个 Supabase 数据库：PITR 会影响备份之后的其他数据。
如需数据库恢复，先保存错误、核对影响范围，再单独制定恢复步骤。
