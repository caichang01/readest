# 每周受控同步上游

## 执行边界

建议时间：每周三 10:00，Asia/Shanghai。定时任务只推进到待验收候选版本；用户验收并明确授权后，才能合并 master、推送主线及发布 Release。

2026-09-02：本次会话的定时任务创建接口不可用，因此本文是可复用的任务说明，**不代表定时任务已启用**。可在 Codex 的 Scheduled/定时任务界面创建本地项目任务，选择本仓库并粘贴下方说明。运行时需要电脑开机、Codex 运行、仓库可访问；网络、GitHub 和测试权限也必须可用。不要为无人值守执行而关闭安全审批或扩大凭据权限。

官方说明：https://learn.chatgpt.com/docs/automations?surface=app

## 可复用任务说明

在 Readest fork 仓库执行每周上游兼容同步。先阅读 AGENTS.md、项目规则和 apps/readest-app/docs/fork-development-handoff.md，遵循其约定。

1. 检查工作区、未完成 merge、已有待验收候选分支和远端状态。不得覆盖用户修改，不得叠加多轮未验收候选。已有候选时先报告其状态和新的上游差异，等待验收，不另开重叠开发。
2. 获取 origin/master 和官方 readest/readest 的 main；核对来源及共同祖先。origin/upstream 只做官方 main 的纯快进镜像，不混入 fork 提交，不强推。没有新提交时简短记录检查结果，不触发构建。
3. 有新提交时从最新已验收 origin/master 建立独立 codex/upstream-sync-YYYYMMDD 候选分支，用普通 merge 保留祖先关系。遵守项目 worktree 规则；若现有 worktree 脚本仍硬编码 origin/main 或自动 rebase，不擅自使用它改变历史。工作区不安全时停止并报告。
4. 审查文本冲突与自动合并后的语义变化。必须保留：无会员/套餐/用户配额/支付 IAP；自建 Supabase Auth/Web/API；自定义 S3、凭据加密同步与缺失字段回填；下载完整性校验、打开自动恢复、生产化脱敏诊断；S3-only、Readest Cloud + S3 和多 provider 能力；fork 更新服务器、公钥、Android 长期签名和确定性 AppImage 构建。
5. 新增上游功能与 fork 行为冲突时优先保留已验收行为；重大产品差异明确说明并征求用户决定。不得静默更换数据存储位置、下载策略或更新信任来源。
6. 上游工作流先放入 .github/upstream-workflows-disabled/，活动工作流保持审核过的白名单。审查新依赖、部署服务、端点、权限和数据库需求；不得启用上游生产设施。
7. 数据库只编写向前、幂等、事务化迁移及独立验证，不能重写已部署迁移编号。保持 RLS 和最小权限。不得连接生产库、备份、执行迁移或部署容器；交付时提醒用户先运行 sudo -iu postgres pig pb backup，再使用 SSH/SCP 升级脚本。
8. 执行 fork 不变量测试、目标回归、完整单元测试、类型/lint/格式、受影响 Rust/Lua 检查及适当集成/构建验证。跳过、失败和环境限制必须如实记录，不得计为通过。失败时先修复或报告，不能绕过测试合并。
9. 检查通过后提交并推送候选分支；按既有流程触发 publish_release=false 的 Fork Release Installers，跟踪候选 Web/API 镜像和各平台构建。不得创建版本标签、Release 或更新 latest，不得合并或推送 master，不得修改线上部署。
10. 更新交接文档，记录 master/共同祖先/目标 SHA、新功能、冲突决策、测试证据、候选产物及用户验收清单。用中文报告有意义的新进展、失败或需决定的事项；对未变化的等待状态不反复通知。

## 本轮验收后

确认当前候选已合并发布并更新交接文档后，下次任务才从新的 master 开始。定时任务不能替代真机验收，也不能保证任意上游变化均可无人工决策地兼容。
