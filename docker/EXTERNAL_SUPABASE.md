# 使用外部自建 Supabase 部署 Readest Web/API

本方案适用于 Supabase 已由 Pigsty 或其他平台独立运行的环境。它只启动一个 Readest
Web/API 容器，不会启动或停止 PostgreSQL、GoTrue、Kong、Realtime、Storage 等现有
Supabase 服务。

## 1. 获取 fork 镜像

`.github/workflows/fork-web-image.yml` 会在每次推送 `master` 后构建 Linux x64 镜像：

```text
ghcr.io/<GitHub 用户名>/readest:master
ghcr.io/<GitHub 用户名>/readest:latest
ghcr.io/<GitHub 用户名>/readest:sha-<短提交号>
```

推送 `codex/**` 开发分支时只发布不可变的 `sha-<短提交号>` 候选标签，不会更新
`master` 或 `latest`。因此可以先在真实环境验收候选镜像，再合并到 `master`。

部署时优先固定 `sha-*` 标签，验证完成后再更新到新提交。如果 GHCR Package 不是公开
可读，需要先在服务器上执行 `docker login ghcr.io`。

## 2. 准备仅服务端可读的环境文件

```bash
cd /path/to/readest/docker
cp .env.external-supabase.example .env.external-supabase
chmod 600 .env.external-supabase
```

至少填写：

- `READEST_IMAGE`
- `SUPABASE_URL`
- `SUPABASE_PUBLIC_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `API_BASE_URL`

`SUPABASE_SERVICE_ROLE_KEY` 会映射为应用当前使用的 `SUPABASE_ADMIN_KEY`，只存在于
Readest 服务端容器。它不得写入 GitHub Variables、`NEXT_PUBLIC_*`、APK、桌面安装包
或仓库文件。

这里的 Readest 服务端 S3 是分享、Send-to-Readest 和 Readest Cloud 文件接口使用的
部署级对象存储，与用户在应用设置页填写的自定义 S3 凭据是两套独立配置。只测试
Supabase 登录和账户元数据同步时可以暂不填写；启用上述服务端文件功能前应使用独立
bucket 填完整。

## 3. 启动与检查

默认只监听宿主机 `127.0.0.1:3000`，由现有 Caddy/Nginx 反向代理提供公网 HTTPS：

```bash
sudo docker compose \
  --env-file .env.external-supabase \
  -f compose.external-supabase.yaml \
  up -d

sudo docker compose \
  --env-file .env.external-supabase \
  -f compose.external-supabase.yaml \
  ps
```

检查运行时公开配置时只查看字段是否正确，不要把响应中的 anon key 发到公共日志：

```bash
curl -fsS http://127.0.0.1:3000/runtime-config.js
```

反向代理必须把整个站点和 `/api/*` 都转发到该容器，并保留 `Host`、
`X-Forwarded-Proto` 和客户端 IP 相关头。

## 4. 配置 Supabase Auth 回调

GoTrue 的站点 URL 应设为 Readest Web/API 公网 HTTPS origin。Redirect allowlist 至少
包含：

```text
https://readest.example.com/auth/callback
readest://auth-callback
```

第一项用于 Web 登录、密码恢复和邮件链接；第二项用于 Android、Windows、Linux 与
macOS 原生应用回调。只使用邮箱和密码登录时仍建议提前配置，避免以后启用邮件或 OAuth
流程时再次改动。

## 5. 配置原生安装包

在 GitHub 仓库设置中添加：

| 类型 | 名称 | 内容 |
| --- | --- | --- |
| Variable | `NEXT_PUBLIC_SUPABASE_URL` | Supabase/Kong 公网 HTTPS origin |
| Secret | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 客户端 anon key |
| Variable | `NEXT_PUBLIC_API_BASE_URL` | Readest Web/API 公网 HTTPS origin |

fork 安装包流水线会在构建前校验三项配置。缺失、仍为占位符、使用非 HTTPS 地址或包含
换行时，构建会明确失败，不再回退到上游 Readest 服务。

anon key 本质上是客户端公开凭据，即使放在 GitHub Secret 中，最终仍会进入安装包；
真正的安全边界是数据库 RLS。`service_role` key 则必须始终只留在服务端。

## 6. 最小验收顺序

1. 浏览器打开 Readest Web，使用已由管理员创建并确认的邮箱/密码登录。
2. 登出后重新登录，确认 token 刷新与会话恢复。
3. 安装新构建的 Android 测试 APK，完成同一账户登录。
4. 两台设备分别修改阅读进度、笔记和设置，确认增量同步。
5. 验证自定义 S3 书籍上传、另一设备恢复及直接打开。
6. 最后检查 Readest 与 Supabase 服务端日志中没有 401、403、RLS 或 JWT signature
   错误。
