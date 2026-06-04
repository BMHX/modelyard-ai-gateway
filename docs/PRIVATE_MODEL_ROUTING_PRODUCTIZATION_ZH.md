# 私有模型与路由产品化设计

## 1. 目标

这部分不是继续强调“支持 OpenAI-compatible”。

真正要卖给企业的是一组一眼能懂、能落地、能交付的能力包：

- Private Model Cluster
- Customer Gateway
- Qwen / DeepSeek / Internal Endpoint 模板
- 路由策略模板
- Provider health / failover / fallback

产品表达要从“协议兼容”升级为“企业接入方案”。

---

## 2. 产品一句话

把公有模型、私有模型、客户自有网关和内部推理集群，统一包装到一个可治理、可审计、可切换、可故障转移的 routing plane 里。

---

## 3. 为什么现在要做

当前仓库已经具备这些基础能力：

- gateway 已有 provider selection 与 OpenAI-compatible / Anthropic-compatible 路由
- control-api 已有 provider connection 管理、测试、撤销与审计
- web-admin 已有 provider 模板、默认路由、model prefix / exact model 配置

当前缺口不在“能不能接”，而在“企业是否一眼看懂”：

- `openai-compatible` 仍然偏技术术语
- 私有模型、客户网关、内部 endpoint 没有被包装成标准交付模板
- 路由策略还停留在隐式 metadata，而不是产品模板
- 健康检查、failover、fallback 还没有形成标准操作叙事

---

## 4. 标准模板

### 4.1 Private Model Cluster

适用对象：

- 企业自建 GPU 集群
- VPC 内推理服务
- 统一暴露一个基础 URL 的模型池

对外表达：

- Self-hosted or VPC
- Internal model fleet
- Governed private inference lane

最小配置：

- base URL
- API key / service token
- 默认协议
- model prefixes 或 exact models

典型模型：

- `qwen-`
- `deepseek-`
- `llama-`
- 企业内部别名模型

### 4.2 Customer Gateway

适用对象：

- 客户已经有自己的 API Gateway / Kong / APISIX / Envoy 边界
- 客户要求 egress 留在自己网络
- 客户要求凭证不出域

对外表达：

- Customer-owned edge
- Hybrid-ready routing boundary
- Hosted governance, customer-run traffic path

最小配置：

- customer gateway base URL
- OpenAI 语义兼容或标准适配层
- 健康检查与 SLA 责任边界

### 4.3 Qwen Template

适用对象：

- 阿里系 / 开源 Qwen 推理服务
- 企业内部常见中文与代码模型接入

默认建议：

- provider kind: `openai-compatible`
- default routing: protocol default
- model prefixes: `qwen-`

产品意义：

- 让销售、实施、客户成功不需要解释“你填一个 OpenAI-compatible endpoint”
- 直接说“这是 Qwen 私有模型模板”

### 4.4 DeepSeek Template

适用对象：

- DeepSeek 官方或私有部署
- 混合推理池里的 reasoning / coding lane

默认建议：

- provider kind: `openai-compatible`
- default routing: protocol default
- model prefixes: `deepseek-`

### 4.5 Internal Endpoint Template

适用对象：

- 内部统一模型网关
- 第三方适配层
- 公司自有 inference facade

默认建议：

- provider kind: `openai-compatible`
- base URL 必填
- 不强制默认路由，先通过 prefix / exact model 精准接入

---

## 5. 路由策略模板

### 5.1 Public-first

定义：

- 公有云 provider 作为默认路由
- 私有模型只接特定模型前缀或精确模型

适合：

- 先求上线速度
- 公有模型覆盖主流流量
- 私有模型只承接特定成本优化或数据边界场景

推荐配置：

- public provider 标记为 protocol default
- private cluster 用 `deepseek-` / `qwen-` / `llama-` 等 prefix 承接定向流量

### 5.2 Private-first

定义：

- 私有模型集群作为默认路由
- 公有 provider 作为 fallback lane

适合：

- 企业优先要求数据边界
- 自有 GPU 池有明确容量规划
- 公有模型只在私有容量不足、模型缺失或特殊任务时启用

推荐配置：

- private cluster 标记为 protocol default
- public provider 通过 exact model 或例外前缀承接特殊模型

### 5.3 Env-based

定义：

- 不同环境绑定不同 routing posture
- dev / staging / prod 各自拥有不同默认 provider 和 fallback 规则

适合：

- 开发环境先用低成本或公有模型
- 生产环境切到私有或客户网关
- 需要把环境边界说清楚的 enterprise 场景

推荐配置：

- dev: public-first
- staging: mixed verification
- prod: private-first 或 customer gateway first

---

## 6. Health / Failover / Fallback 设计

### 6.1 Health

建议拆成两层：

- Connection health
  - 能否访问 `/v1/models`
  - 最近测试是否通过
  - 最近测试延迟
- Routing health
  - 是否存在多个默认路由
  - 是否存在 prefix 冲突
  - 是否存在 active 连接但 generic request 无默认路由

控制台应优先展示：

- passed / failed / stale / untested
- ambiguous overlaps
- default tie-breaks

### 6.2 Failover

Failover 是“主路由不可用时自动切到备用路由”。

建议产品层先定义标准行为，再逐步实现自动化：

- 手动 failover
  - 运维确认主 provider 异常
  - 切换 protocol default 到备路由
- 半自动 failover
  - 连续健康检查失败后触发建议切换
  - 控制台给出推荐默认路由
- 自动 failover
  - 需等后续引入 provider health score、窗口期、熔断与恢复阈值

V1 推荐先卖：

- health-aware operator failover
- default conflict resolution
- guided fallback playbook

不要过早承诺：

- 完整自愈式自动故障转移

### 6.3 Fallback

Fallback 是“请求不满足主路由条件或主路由不承接该模型时，退到次优路由”。

建议先定义 3 种 fallback：

- Model fallback
  - 请求模型不存在时，退回到兼容模型或公有默认模型
- Provider fallback
  - 私有 provider 不可用时，退到 public provider
- Environment fallback
  - 仅在指定环境允许 fallback，避免生产误切到不合规路由

---

## 7. 对 UI 的产品化要求

providers 页面不应只显示 provider kind，而应明确显示：

- Operating model
  - Managed public route
  - Private model cluster
  - Customer gateway
- Routing strategy
  - Public-first
  - Private-first
  - Env-based
- Health posture
  - Healthy
  - Needs retest
  - Ambiguous routing
  - Fallback only

模板卡片的目标不是“减少填写步骤”，而是：

- 帮销售和客户成功快速讲清楚方案
- 帮运维知道当前 workspace 属于哪种接入模式
- 帮企业采购和安全团队快速理解责任边界

---

## 8. 对数据模型的建议增量

现有 metadata 已经能表达一部分策略。

下一步建议把这些字段显式化，而不是长期埋在 metadata 里：

- `operatingModel`
  - `managed-public`
  - `private-cluster`
  - `customer-gateway`
- `routingStrategy`
  - `public-first`
  - `private-first`
  - `env-based`
- `healthMode`
  - `manual`
  - `observed`
  - `auto-failover-ready`
- `failoverTarget`
- `fallbackTarget`

V1 可以先保留在 metadata。

V2 再升级成明确字段与界面控件。

---

## 9. 推荐落地顺序

### Phase 1: 表达层产品化

- 扩展 provider onboarding 模板
- 增加 routing strategy 模板说明
- 在控制台中明确 operating model 与 health posture
- 用文档和销售话术统一命名

### Phase 2: 配置层产品化

- 保存 routing strategy
- 为连接建立主备关系
- 引入 health score 与 stale threshold
- 输出 failover recommendation

### Phase 3: 执行层产品化

- provider health poller
- 熔断与恢复窗口
- 自动 failover
- 审计化 fallback 事件

---

## 10. 对外销售话术建议

不要说：

- 我们支持 OpenAI-compatible

优先说：

- 我们支持公有模型、私有模型集群和客户自有网关统一接入
- 你们可以按 public-first、private-first、env-based 三种策略来运营路由
- 我们把 provider health、fallback 和治理操作放在同一个控制面里

---

## 11. 当前仓库中的直接映射

当前已有能力可直接映射到这套产品化表达：

- `apps/gateway/src/provider-selection.ts`
  - 已有 provider selection
- `packages/contracts/src/index.ts`
  - 已有 model prefix / exact model / default routing 分析
- `apps/control-api/src/provider-connections.ts`
  - 已有 provider connection test
- `apps/web-admin/app/providers/providers-workspace-view.tsx`
  - 已有 provider onboarding、routing preview、health summary

因此这项工作不是重写网关，而是把现有技术底座包装成标准产品模板与运营模型。
