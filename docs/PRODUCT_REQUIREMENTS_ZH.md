# Modelyard 产品需求文档

## 1. 文档目标

本文档用于定义 `Modelyard` 的完整产品需求。

它回答 5 个核心问题：

1. 我们到底在做什么产品
2. 这个产品解决谁的什么问题
3. 第一版必须做哪些功能
4. 每个功能模块应该拆成哪些可执行的小块
5. 后续如何逐步演进成一个可卖给海外团队和企业的产品

本文档会尽量详细，目标不是“写概念”，而是为后续研发排期、任务拆分、原型设计、定价和对外销售提供统一依据。

---

## 2. 产品定义

### 2.1 产品一句话定义

`Modelyard` 是一个给团队使用 Claude Code 和其他 AI coding tools 的 **控制层 / 治理层 / 管理层**。

它不是 token 代充平台，也不是账号转售平台。

它的核心定位是：

- BYOK
- 团队接入
- 成本治理
- 使用日志
- 预算控制
- 审计追踪
- 导出与对账
- 管理员控制面板

### 2.2 产品边界

本产品 **不做**：

- 不做低价 token reseller
- 不做账号号池
- 不做消费级“代登录”型产品
- 不做完整 IDE
- 不做纯 prompt playground
- 不做泛 AI Chat 网站

本产品 **要做**：

- 让团队更安全地接入 Claude Code / OpenAI-compatible 工具
- 让管理员控制预算、权限、日志、导出、项目和环境
- 让团队可以按组织、工作区、项目、环境维度使用 AI
- 让财务、安全、技术负责人都能看懂和管住这套系统

---

## 3. 愿景与价值主张

### 3.1 产品愿景

让任何一个使用 Claude Code 或 AI coding agent 的团队，都能像管理云资源一样管理 AI 调用。

### 3.2 价值主张

对开发团队：

- 更容易接入
- 更少手动配置
- 更少泄露真实 provider key 的风险

对团队管理员：

- 看得见谁在用
- 管得住谁能用什么
- 控得住预算和模型权限

对财务和管理层：

- 知道钱花在哪
- 能导出报表
- 能做项目/客户/部门分账

对企业客户：

- 有审计
- 有权限
- 有部署形态可选
- 可做合规治理

---

## 4. 目标用户

## 4.1 用户分层

### A. 小型技术团队

特征：

- 3-15 人
- 开始系统性使用 Claude Code / ChatGPT / coding agents
- 还没有正式的 AI 管理系统

核心需求：

- 快速接入
- 可见成本
- 可控预算

### B. AI 产品团队 / 工程平台团队

特征：

- 多项目并行
- 可能接入多个 provider
- 需要项目、环境、成员隔离

核心需求：

- 统一网关
- 路由和控制
- 日志与成本归因

### C. Agency / 外包团队

特征：

- 服务多个客户
- 需要按客户、项目拆账
- 成员流动大

核心需求：

- 客户维度分账
- 成员权限收放
- 项目隔离

### D. 企业 IT / 安全 / 平台团队

特征：

- 重视审计、权限、合规、数据边界
- 可能要求私有部署或混合部署

核心需求：

- 审计
- SSO / RBAC
- 区域与部署形态
- key 安全控制

---

## 5. 角色定义

## 5.1 平台角色

### Super Admin

平台最高管理员。

能力：

- 管理所有组织
- 查看系统级指标
- 管理全局配置
- 管理部署和支持配置

### Organization Owner

组织拥有者。

能力：

- 创建工作区
- 邀请成员
- 管理账单
- 管理 provider 连接
- 管理预算和导出

### Workspace Admin

工作区管理员。

能力：

- 创建项目
- 创建环境
- 创建虚拟 key
- 管理项目成员
- 查看日志与导出

### Project Maintainer

项目维护者。

能力：

- 使用被授权的虚拟 key
- 查看本项目日志和预算
- 管理项目级配置

### Developer

普通开发者。

能力：

- 使用平台提供的虚拟 key
- 查看自己可见的项目和基础用量

### Finance / Viewer

财务或只读角色。

能力：

- 查看成本报表
- 导出财务数据
- 不能修改配置

---

## 6. 核心业务场景

## 6.1 场景 1：团队统一接入 Claude Code

现状问题：

- 团队成员各自配置 key
- 有人直接持有真实 provider key
- 无法统一限制预算

目标：

- 管理员在平台连接 Anthropic / OpenAI provider
- 平台为团队生成虚拟 key
- 团队成员使用虚拟 key 接入 Claude Code
- 真实 provider key 不下发给成员

成功标准：

- 成员不直接接触真实上游 key
- 所有请求都能被标记到 workspace / project / environment

## 6.2 场景 2：按项目和环境隔离使用

现状问题：

- 开发、测试、生产混在一起
- 月底很难知道哪个项目在烧钱

目标：

- 项目独立
- 环境独立
- 可以设置不同预算和模型白名单

成功标准：

- 使用记录能按 project / environment 查询
- 环境切换不影响其他环境

## 6.3 场景 3：预算控制和告警

现状问题：

- 一段脚本跑飞或者 agent 无限调用，可能短时间烧掉大量成本

目标：

- 支持 workspace/project/environment 级预算
- 到达阈值时告警
- 到达硬阈值时阻断

成功标准：

- 平台能实时或准实时触发预算事件
- 预算达到阈值后请求行为符合策略

## 6.4 场景 4：财务导出与对账

现状问题：

- 月底财务拿不到清晰数据
- 不知道哪个团队、哪个客户、哪个项目用了多少

目标：

- 生成按时间范围的导出报表
- 支持 CSV / XLSX
- 支持项目、成员、模型、provider 维度

成功标准：

- 财务人员不需要写 SQL 也能拿到报表

## 6.5 场景 5：成员离职与外包权限回收

现状问题：

- 离职人员还持有 key
- 外包可能拿到过大的权限

目标：

- 通过平台禁用成员、撤销虚拟 key、调整 scope

成功标准：

- 回收权限后，对应虚拟 key 不能继续使用

---

## 7. 产品模块总览

V1 主要由以下 12 个模块组成：

1. 组织与工作区管理
2. 成员与权限管理
3. 项目与环境管理
4. Provider 连接管理
5. 虚拟 Key 管理
6. Gateway 路由与认证
7. 使用日志与事件记录
8. 预算与策略控制
9. 导出与报表
10. 审计日志
11. 管理后台 Web Admin
12. 部署与运维能力

下面将逐个详细展开。

---

## 8. 模块详细需求

## 8.1 模块一：组织与工作区管理

### 8.1.1 目标

支持多租户结构，作为整个产品的最上层业务单位。

### 8.1.2 功能拆解

#### P0

- 创建组织
- 编辑组织名称
- 组织 slug 自动生成
- 列出组织
- 创建工作区
- 编辑工作区名称
- 工作区 slug 自动生成
- 工作区列表查询

#### P1

- 组织状态：active / suspended
- 工作区状态：active / archived
- 组织 logo / branding
- 组织时区、默认货币

#### P2

- 多组织切换
- 组织级 usage summary

### 8.1.3 数据对象

- organization
- workspace

### 8.1.4 验收标准

- 组织 slug 唯一
- 同组织下 workspace slug 唯一
- 可通过 organizationId 查询所有工作区

---

## 8.2 模块二：成员与权限管理

### 8.2.1 目标

控制谁能看什么、改什么、用什么。

### 8.2.2 功能拆解

#### P0

- 邀请成员
- 成员列表
- 成员角色分配
- 禁用成员
- 移除成员

#### P1

- 自定义角色
- 按工作区授予角色
- 按项目授予角色
- 只读财务角色

#### P2

- SSO
- SCIM
- 登录审计

### 8.2.3 默认角色建议

- organization_owner
- workspace_admin
- project_maintainer
- developer
- finance_viewer

### 8.2.4 验收标准

- 禁用成员后，不能继续通过该成员签发的访问路径继续管理控制面
- 未授权角色不能看到不属于自己的工作区和项目

---

## 8.3 模块三：项目与环境管理

### 8.3.1 目标

支持按项目和环境隔离 AI 使用。

### 8.3.2 功能拆解

#### P0

- 创建项目
- 编辑项目
- 删除/归档项目
- 创建环境：development / staging / production
- 环境绑定预算策略

#### P1

- 环境级模型白名单
- 环境级 provider 允许列表
- 环境级日志筛选

#### P2

- 项目模板
- 环境配置克隆

### 8.3.3 数据对象

- project
- environment

### 8.3.4 验收标准

- 虚拟 key 可明确绑定 project + environment
- 日志可以按 project + environment 过滤

---

## 8.4 模块四：Provider 连接管理

### 8.4.1 目标

安全接入 Anthropic、OpenAI-compatible、Bedrock、Vertex 等 provider。

### 8.4.2 功能拆解

#### P0

- 新建 provider connection
- 输入 label
- 选择 provider 类型
- 输入 API key
- metadata 保存
- 状态 active / revoked
- 连接列表展示

#### P1

- 测试连接
- 标记默认 provider
- 轮换 key
- 撤销连接

#### P2

- 多 provider fallback 配置
- 基于模型的 provider 路由

### 8.4.3 安全要求

- API key 仅密文存储
- 后台不可明文回显
- 所有 key 操作写入 audit log

### 8.4.4 验收标准

- 保存后数据库中没有明文 key
- 被 revoke 的 provider connection 不能再用于新请求

---

## 8.5 模块五：虚拟 Key 管理

### 8.5.1 目标

让团队使用平台发放的虚拟 key，而不是直接暴露上游 provider key。

### 8.5.2 功能拆解

#### P0

- 创建虚拟 key
- 自动生成 token
- 存储 hash，不存明文
- 记录 key prefix
- 绑定 workspace
- 可选绑定 project
- 指定 environment
- 状态 active / revoked
- last_used_at

#### P1

- 虚拟 key scopes
- 按成员签发
- 按项目签发
- 按用途签发（ci / local-dev / bot / agent）

#### P2

- key 过期时间
- key 自动轮换
- key 使用频率限制

### 8.5.3 验收标准

- 创建时只返回一次明文 token
- 后续只能看到 prefix，不能再次看到明文
- 已 revoke 的虚拟 key 不能通过 gateway 验证

---

## 8.6 模块六：Gateway 路由与认证

### 8.6.1 目标

承接 Claude Code / SDK 的请求，完成虚拟 key 校验、策略检查和 provider 转发。

### 8.6.2 功能拆解

#### P0

- `POST /v1/messages`
- `POST /v1/chat/completions`
- Bearer token 解析
- 虚拟 key 解析
- workspace/project/environment 绑定
- 请求基础校验
- provider passthrough
- 记录请求开始和结束事件

#### P1

- streaming passthrough
- model allow list
- provider fallback
- 超时控制
- 幂等 request id 透传

#### P2

- rate limit
- region-aware routing
- cache
- queueing

### 8.6.3 运行要求

- 低延迟
- 尽可能无状态
- 控制面变更不影响运行中请求

### 8.6.4 验收标准

- 有效虚拟 key 能正常通过
- 无效或 revoked key 返回 401
- provider 不可用时返回结构化错误

---

## 8.7 模块七：使用日志与事件记录

### 8.7.1 目标

把每次调用变成可查询、可导出、可审计的数据。

### 8.7.2 记录字段

每条 usage event 至少应包含：

- workspace_id
- project_id
- virtual_key_id
- provider_connection_id
- request_id
- provider_request_id
- provider
- model
- prompt_tokens
- completion_tokens
- total_tokens
- cost_usd
- latency_ms
- status
- created_at
- metadata

### 8.7.3 功能拆解

#### P0

- 每次请求写 usage event
- 列表查询
- 时间范围过滤
- 按 workspace / project / model / provider 查询

#### P1

- 按成员查询
- 按虚拟 key 查询
- 按环境查询
- 请求详情页

#### P2

- 聚合看板
- 日/周/月 rollup
- top cost drivers

### 8.7.4 验收标准

- 每次成功请求必须写日志
- 失败请求也应有状态记录
- 日志能够稳定按时间倒序查询

---

## 8.8 模块八：预算与策略控制

### 8.8.1 目标

防止失控花费，并把 AI 成本控制变成一个可配置系统。

### 8.8.2 预算层级

- workspace budget
- project budget
- environment budget
- virtual key budget（P1）
- member budget（P2）

### 8.8.3 功能拆解

#### P0

- 创建 budget policy
- monthly_usd_limit
- soft_limit_percent
- active / paused
- 查询预算策略

#### P1

- 预算消耗看板
- soft limit alert
- hard limit blocking
- 预算周期自动刷新

#### P2

- 按 provider 或 model 单独预算
- 自定义策略引擎

### 8.8.4 验收标准

- 当月预算消耗可被计算
- 超过软阈值有告警
- 超过硬阈值时请求按策略阻断

---

## 8.9 模块九：导出与报表

### 8.9.1 目标

为财务、管理层、运营团队提供对账和分析能力。

### 8.9.2 功能拆解

#### P0

- CSV 导出
- XLSX 导出
- 时间范围筛选
- 按 workspace / project / model 导出

#### P1

- 保存导出任务记录
- 异步导出
- 大文件下载链接

#### P2

- 定时报表
- 按客户/部门对账模板

### 8.9.3 导出字段建议

- 日期
- 工作区
- 项目
- 环境
- provider
- model
- prompt_tokens
- completion_tokens
- total_tokens
- cost_usd
- latency_ms
- 状态

### 8.9.4 验收标准

- 导出结果字段稳定、可重复
- 同一筛选条件导出的总量和页面查询结果一致

---

## 8.10 模块十：审计日志

### 8.10.1 目标

记录所有关键管理动作，满足安全和内部审查需求。

### 8.10.2 需要记录的动作

#### P0

- organization 创建
- workspace 创建
- provider connection 创建 / 撤销
- virtual key 创建 / 撤销
- budget 创建 / 修改 / 暂停

#### P1

- 成员邀请 / 移除 / 角色变更
- 项目创建 / 归档
- 环境策略修改

#### P2

- 登录审计
- SSO 事件

### 8.10.3 字段建议

- actor_type
- actor_id
- action
- subject_type
- subject_id
- payload
- created_at

### 8.10.4 验收标准

- 所有高风险配置操作都有审计记录
- 审计日志不可被普通用户篡改

---

## 8.11 模块十一：管理后台 Web Admin

### 8.11.1 目标

提供操作员和管理员可视化控制界面。

### 8.11.2 信息架构

#### P0 页面

- Dashboard
- Organizations
- Workspaces
- Provider Connections
- Virtual Keys
- Budgets
- Logs
- Exports
- Audit Logs

#### P1 页面

- Projects
- Environments
- Members & Roles
- Alerts

#### P2 页面

- Billing
- SSO / SCIM
- Deployment / Region

### 8.11.3 页面细分

#### Dashboard

- 本月总调用数
- 本月总成本
- 最近 7 天趋势
- top models
- top projects
- 最近告警

#### Provider Connections

- 列表
- 新建弹窗/页面
- revoke 操作
- 连接测试

#### Virtual Keys

- 列表
- 创建
- revoke
- 查看 prefix
- 查看 last used

#### Logs

- 时间过滤
- workspace / project / model / provider 过滤
- 表格
- 请求详情抽屉

#### Budgets

- 列表
- 创建预算
- 查看当前消耗和剩余额度

### 8.11.4 验收标准

- 管理员能在 UI 内完成 V1 主要操作
- 页面加载逻辑与 API 一致

---

## 8.12 模块十二：部署与运维能力

### 8.12.1 目标

保证产品可以以 SaaS / Hybrid / Self-hosted 形态交付。

### 8.12.2 功能拆解

#### P0

- Docker 本地开发环境
- 环境变量模板
- 健康检查
- 数据库迁移

#### P1

- Docker 镜像构建
- 分环境配置
- metrics / logging

#### P2

- Kubernetes 部署模板
- Self-host 文档
- Region 配置

### 8.12.3 验收标准

- 本地开发环境可一键拉起
- 服务有健康检查
- 迁移可重复执行

---

## 9. API 需求概览

## 9.1 Control API

V1 需要至少有这些接口：

- `GET /healthz`
- `GET /v1/organizations`
- `POST /v1/organizations`
- `GET /v1/workspaces`
- `POST /v1/workspaces`
- `GET /v1/provider-connections`
- `POST /v1/provider-connections`
- `GET /v1/virtual-keys`
- `POST /v1/virtual-keys`
- `GET /v1/budgets`
- `POST /v1/budgets`

后续扩展：

- members
- projects
- environments
- exports
- audit logs

## 9.2 Gateway API

V1 需要至少支持：

- `POST /v1/messages`
- `POST /v1/chat/completions`
- `GET /healthz`

后续扩展：

- streaming
- provider fallback
- request tagging
- budget enforcement
- rate limiting

---

## 10. 数据对象清单

V1 最少需要这些核心实体：

- organization
- workspace
- project
- provider_connection
- virtual_key
- budget_policy
- usage_event
- audit_log

后续实体：

- member
- role
- environment_policy
- alert
- export_job
- customer
- chargeback_rule

---

## 11. 核心业务规则

1. 真实 provider key 不直接下发给团队成员
2. 虚拟 key 只在创建时返回一次明文
3. 所有管理动作必须可审计
4. 所有请求必须可归属到 workspace
5. budget policy 应可在 workspace / project / environment 级别生效
6. 被 revoke 的虚拟 key 和 provider connection 不允许继续使用
7. 导出的数据必须和查询结果一致

---

## 12. 非功能性需求

## 12.1 安全

- provider key 加密存储
- 虚拟 key 哈希存储
- 审计日志
- 最小权限原则

## 12.2 性能

- Gateway 应优先低延迟
- Control API 更重稳定性和一致性
- Logs 查询要支持分页和筛选

## 12.3 可观测性

- 服务健康检查
- 结构化日志
- 错误追踪
- 使用事件完整落库

## 12.4 可维护性

- 控制面和数据面分离
- 使用共享 contracts
- 使用统一环境变量和 migration 机制

## 12.5 可商用开源要求

- 仅允许 MIT / Apache-2.0 / BSD / PostgreSQL License / ISC 等宽松许可
- 不引入 AGPL / SSPL / BSL / 带商业限制的 source-available 依赖作为产品核心

参考：

- [docs/OSS_COMPONENTS.md](./OSS_COMPONENTS.md)
- [docs/OSS_REUSE_PLAN.md](./OSS_REUSE_PLAN.md)

---

## 13. V1 / V2 / V3 版本拆分

## 13.1 V1：可用的团队治理最小版本

必须完成：

- organization / workspace
- provider connection
- virtual key
- gateway auth
- usage events
- budgets
- export
- audit logs
- web admin 基础页面

目标：

- 一个小团队可以真正通过平台接入 Claude Code
- 管理员可以看到日志、导出、预算、key 管理

## 13.2 V2：中型团队可用版本

新增：

- members & roles
- projects & environments
- alerts
- better dashboards
- per-customer / per-user chargeback

目标：

- 适合 agency 和平台团队

## 13.3 V3：企业版能力

新增：

- SSO / SCIM
- self-hosted
- regional data
- policy engine
- enterprise audit package

目标：

- 面向企业采购和安全审查

---

## 14. 功能开发优先级建议

## 14.1 第一优先级（立刻开发）

- 数据库迁移稳定
- organization / workspace API
- provider connection API
- virtual key API
- gateway key 校验
- usage event 入库
- budgets 基础逻辑

## 14.2 第二优先级（V1 完整度）

- logs 查询页
- export
- audit logs 页面
- provider passthrough
- error handling

## 14.3 第三优先级（增长和销售）

- project/environment 视图
- onboarding 页面
- dashboard 趋势图
- alerts

## 14.4 第四优先级（企业化）

- SSO
- self-host
- region / compliance

---

## 15. 验收口径

一版是否成功，不看“页面是否好看”，而看以下几个问题是否能回答：

1. 团队是否可以不用共享真实 provider key？
2. 管理员是否可以生成、撤销、追踪虚拟 key？
3. 每次请求是否能写 usage event？
4. 是否可以按时间范围导出数据？
5. 是否可以设置预算并看到预算策略？
6. 是否可以追踪关键管理行为？
7. 是否能支撑一个真实小团队试用？

如果这 7 个问题都能回答“能”，那 V1 就成立了。

---

## 16. 当前项目与本文档的映射

当前代码仓已经具备这些基础：

- monorepo 结构
- contracts 包
- config 包
- database 包
- control-api skeleton
- gateway skeleton
- web-admin skeleton
- docker 本地依赖
- migration 机制

当前还缺这些关键能力：

- project / environment 完整 API
- member / role
- provider passthrough
- usage event 真正落库
- export 任务
- budget enforcement
- UI 业务页

---

## 17. 结论

本产品不是“卖 token”的平台，而是“团队使用 Claude Code 和 AI coding 工具时的管理操作系统”。

它的第一性问题不是“怎么买到模型”，而是：

- 如何安全接入
- 如何控制预算
- 如何追踪使用
- 如何导出报表
- 如何审计和管理团队

所以研发顺序必须围绕这几个核心展开，而不是先做花哨 UI 或者泛模型市场。

