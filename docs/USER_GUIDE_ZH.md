# Modelyard 使用文档

## 1. 文档目标

这是一份给管理员和运营人员的简明使用文档，目标是帮助你用最短路径完成：

- 首次进入系统
- 完成 BYOK 接入
- 发放虚拟密钥
- 观察流量、预算、告警
- 导出审计与使用数据

本产品是一个 `AI Access & Governance Infrastructure / Control Plane`，用于统一管理团队的 AI 访问、路由、预算、审计与导出，不是 token 转售平台，也不是聊天站点。

---

## 2. 适用对象

- `Organization Owner`：创建组织、工作区，管理供应商连接、预算、导出
- `Workspace Admin`：管理项目、环境、成员、虚拟密钥与工作区级治理
- `Project Maintainer / Developer`：使用已签发的虚拟密钥接入 AI 工具
- `Finance / Viewer`：查看预算、审计日志、导出结果

---

## 3. 10 分钟快速上手

### 3.1 打开系统

如果你是在本地体验 demo，推荐直接使用：

```bash
cp .env.development.example .env.development
npm run dev:stack:seed
```

打开以下地址：

- Web Admin: `http://127.0.0.1:3001`
- Control API: `http://127.0.0.1:4001/healthz`
- Gateway: `http://127.0.0.1:4002/healthz`

如果你已经完成初始化，也可以直接查看种子数据说明：

- `.demo/demo-brief.md`

### 3.2 登录

- 进入 `/login`
- 本地开发环境可直接使用测试账号
- 已配置身份提供方时，按组织 slug 走 OIDC 登录

### 3.3 完成首次配置

推荐按这个顺序完成初始化：

1. `Organizations`：创建组织
2. `Workspaces`：创建工作区
3. `Projects`：创建项目与环境
4. `Providers`：添加供应商连接，先执行草稿测试，再保存
5. `Members`：邀请成员并分配范围
6. `Virtual Keys`：签发第一把虚拟密钥
7. `Usage Events`：确认第一条流量已经进入系统

如果你还没有完成这些步骤，可以先打开 `Home` 或 `Setup` 页面，系统会给出当前缺失项。

---

## 4. 页面职责

| 页面 | 用途 | 什么时候打开 |
| --- | --- | --- |
| `Home` | 总览、待处理事项、风险入口 | 每天先看这里 |
| `Setup` | 首次配置进度 | 新工作区刚创建时 |
| `Organizations` | 管理组织根节点 | 新租户初始化 |
| `Workspaces` | 工作区目录与切换 | 管理多个工作区时 |
| `Providers` | 管理 BYOK 供应商连接与路由健康 | 首次接入、重测、排查路由 |
| `Projects` | 项目与环境边界 | 按项目/环境拆分治理范围 |
| `Members` | 成员邀请、角色、分配 | 人员加入、离职、权限调整 |
| `Access` | 开发者自助申请个人开发密钥并查看接入代码片段 | 开发者接入 Claude Code / IDE / 脚本时 |
| `Virtual Keys` | 签发、轮换、撤销治理型虚拟密钥 | 给团队、服务、共享工具或运行时发访问凭证 |
| `Usage Events` | 查看请求、状态、模型、上下文 | 排查失败、确认流量 |
| `Budgets` | 预算策略与阈值 | 设置软/硬阈值，控制成本 |
| `Alerts` | 处理告警与阻断事件 | 预算超限、异常流量 |
| `Audit Logs` | 查看变更留痕 | 审计、复盘、权限检查 |
| `Exports` | 导出使用、账本、审计数据 | 财务对账、客户交付、事故复盘 |
| `Delivery` | 查看 Cloud / Hybrid / Self-host Preview 交付方式 | 对外说明部署形态 |

---

## 5. 核心使用流程

### 5.1 接入第一个供应商

进入 `Providers` 页面后：

1. 选择工作区
2. 点击 `添加供应商`
3. 选择合适模板
4. 填写标签、API Key、Base URL 等信息
5. 先执行 `测试草稿`
6. 测试通过后执行 `保存连接`

建议：

- 公有模型使用 `Anthropic` 或 `OpenAI` 模板
- 私有模型或客户网关使用 `OpenAI 兼容` 模板
- 有多条连接时，优先保证默认通道清晰，减少重叠路由

### 5.2 签发虚拟密钥

进入 `Virtual Keys` 页面后：

1. 选择工作区
2. 点击 `发放虚拟密钥`
3. 选择工作负载类型（服务或共享）
4. 填写标签、服务标识、负责人标签、团队
5. 绑定供应商连接
6. 选择项目、环境、运行时
7. 设置到期时间和附加范围
8. 创建后立即复制令牌

说明：

- `Virtual Keys` 更适合服务、共享工具、自动化、运行时凭据
- 这里的“负责人”是治理标签，用于审计、检索与分摊，不表示个人领取主体
- 不建议长期使用工作区级宽权限密钥

### 5.3 让开发者自助接入网关

开发者应优先通过 `Access` 页面为自己申请短期个人开发密钥，不要让管理员逐个代发。

进入 `Access` 页面后：

1. 选择工作区
2. 查看当前成员已分配的项目
3. 选择一个项目
4. 点击申请个人开发密钥
5. 复制代码片段或 `.env` 配置接入工具

说明：

- 只有当前成员已分配的项目会出现在 `Access`
- `Access` 只用于个人开发接入
- 服务、共享或长期凭据应改用 `Virtual Keys` 页面治理

### 5.4 兼容调用示例

开发者应使用平台签发的 `virtual key`，不要直接持有上游 provider key。

OpenAI 兼容调用示例：

```bash
curl -X POST http://127.0.0.1:4002/v1/chat/completions \
  -H "Authorization: Bearer <VIRTUAL_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4.1-mini",
    "messages": [
      {
        "role": "user",
        "content": "Summarize the current workspace status."
      }
    ]
  }'
```

Anthropic 兼容调用示例：

```bash
curl -X POST http://127.0.0.1:4002/v1/messages \
  -H "Authorization: Bearer <VIRTUAL_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-sonnet-4-20250514",
    "messages": [
      {
        "role": "user",
        "content": "Summarize the current workspace status."
      }
    ]
  }'
```

调用成功后，回到 `Usage Events` 页面确认：

- 请求是否成功
- 使用了哪个 provider / model
- 是否命中了预算或阻断规则

### 5.4 配置预算与处理告警

进入 `Budgets` 页面后：

1. 为工作区、项目或环境创建预算策略
2. 设置月度美元上限
3. 设置 `soft limit` 作为提醒阈值
4. 设置 `hard limit` 作为阻断边界

进入 `Alerts` 页面后：

1. 优先处理 `blocked` 或 `critical` 告警
2. 打开关联 `Usage Events`
3. 必要时继续打开 `Audit Logs`
4. 确认是否需要调整预算、路由或密钥范围

建议把 `Alerts` 当作处理队列，而不是只看状态。

### 5.5 做审计与导出

进入 `Audit Logs` 页面可查看：

- 工作区初始化
- 供应商连接创建、测试、撤销、轮换
- 虚拟密钥创建、轮换、撤销
- 导出任务创建与后续动作

进入 `Exports` 页面可导出三类数据：

- `usage-events`：逐条请求明细
- `usage-ledger`：更稳定的账本视图，适合财务与经营分析
- `audit-logs`：审计事件与变更证据

推荐使用方式：

- 财务对账：优先导出 `usage-ledger`
- 故障复盘：导出 `usage-events` + `audit-logs`
- 客户交付：使用工作区或项目范围做一次性导出

---

## 6. 高频操作建议

### 新团队接入

推荐顺序：

1. 创建工作区
2. 创建项目与环境
3. 接入至少一个可用供应商
4. 邀请成员
5. 发放范围化虚拟密钥
6. 发起第一条请求
7. 确认 `Usage Events`、`Audit Logs`、`Exports` 都可用

### 定期治理

建议每周至少检查一次：

- `Home`：待处理事项和风险入口
- `Providers`：失败或未测试的连接
- `Virtual Keys`：即将到期、从未使用、宽权限密钥
- `Budgets`：预测超限、阻断趋势
- `Alerts`：未关闭告警
- `Exports`：失败任务和待交付文件

### 人员离职或权限调整

建议操作：

1. 在 `Members` 调整角色或移除成员
2. 检查其名下虚拟密钥
3. 对相关密钥执行 `轮换` 或 `撤销`
4. 在 `Audit Logs` 确认留痕

---

## 7. 常见问题

### 为什么不能签发虚拟密钥？

通常是因为当前工作区还没有可用的供应商连接。先到 `Providers` 完成一条通过测试的连接。

### 为什么创建后再也看不到完整 token？

这是安全设计。虚拟密钥只在创建或轮换成功后完整显示一次，请当场复制并交付到安全位置。

### 为什么请求被阻止？

先去 `Alerts` 和 `Usage Events` 检查是否命中了预算硬阈值、无效密钥、过期密钥或路由问题。

### 为什么看不到流量？

重点检查：

- 调用是否真的走了网关地址
- 请求头是否携带正确的 `Authorization: Bearer <virtual key>`
- 供应商连接是否与请求协议匹配
- 工作区、项目、环境绑定是否正确

### 导出为什么还不能下载？

导出任务可能还在排队或处理中。进入 `Exports` 查看任务状态，只有 `completed` 后才可下载。

---

## 8. 最佳实践

- 始终给成员和服务发 `virtual key`，不要下发原始 provider key
- 优先发项目级、环境级密钥，不要长期保留工作区级宽权限密钥
- 给密钥设置到期时间，定期轮换
- 为生产环境设置明确预算和阻断边界
- 用 `Audit Logs` 保存操作证据，用 `Exports` 做复盘和对账

---

## 9. 相关文档

- [README](../README.md)
- [API Reference](./API_REFERENCE.md)
- [Deployment Guide](./DEPLOYMENT.md)
- [Architecture](../ARCHITECTURE.md)
- [Product Requirements (ZH)](./PRODUCT_REQUIREMENTS_ZH.md)
