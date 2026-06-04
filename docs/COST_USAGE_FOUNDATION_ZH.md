# 成本与使用数据底座

这份文档冻结后续 `forecast / burn rate / 分账 / 管理层 summary` 依赖的成本与使用数据口径。

## 1. 核心原则

- `usage_events` 继续承担产品侧 request-level 观测职责。
- `usage_ledger_entries` 是财务/经营分析的稳定账本层，一条 `usage_event` 最多对应一条 ledger。
- 成本归因统一走同一组维度：`organization / workspace / project / environment / provider / virtual key / owner`。
- 价格必须以快照形式落库，不能只保留运行时计算结果。
- forecast 不直接从原始请求表起算，而是基于日粒度聚合层 `usage_forecast_daily`。
- 稳定导出优先走 `usage-ledger.v1`，避免下游每次跟随 request 细节变更。

## 2. 表职责

### `model_mappings`

- 保存 provider model 到 canonical model 的映射。
- 解决同一模型存在 provider 后缀、日期后缀、别名时的口径漂移问题。
- 作为后续模型族、迁移策略、价格变更分析的维表基础。

### `price_snapshots`

- 保存某次写账时采用的价格快照。
- 字段包含 `provider / provider_connection_id / provider_model / canonical_model / input/output usd per million / pricing_source`。
- 支持后续做价格追溯、账单对账、价格版本差异分析。

### `usage_ledger_entries`

- 冻结财务口径的一次使用记录。
- 同时保存归因维度、canonical model、price snapshot 引用，以及写账时采用的 input/output rate。
- 这是后续 chargeback、burn-rate、管理层 summary 的主事实表。

### `usage_forecast_daily`

- 以天为粒度保存按统一维度聚合后的请求数、token、cost。
- 这是 forecast / burn rate / threshold ETA 的基础层。
- 计算模型可以继续演进，但聚合粒度和维度先固定下来。

## 3. 冻结口径

### 账本 grain

- 一条上游调用或被阻断调用，对应一条 `usage_event`。
- 一条 `usage_event`，对应最多一条 `usage_ledger_entry`。

### 成本口径

- `cost_usd` 以写入时的价格快照计算结果为准。
- `pricing_source` 标记来源，当前支持 `builtin / connection-metadata / manual / unknown`。
- 后续价格规则变更，不回写历史 ledger，只产生新的 snapshot。

### 归因口径

- `organization_id` 来自 `workspace -> organization`。
- `workspace / project / environment / provider_connection / virtual_key` 直接来自请求解析结果。
- `owner` 当前从 `virtual_keys.owner` 冻结到 ledger。
- `provider_model` 保留原始模型名的归一化结果，`canonical_model` 用于跨 provider / 版本聚合。

## 4. 稳定导出

新增稳定导出 schema：`usage-ledger.v1`

字段目标：

- 账本主键与来源追踪：`ledger_entry_id / usage_event_id / price_snapshot_id`
- 统一归因：`organization_id / workspace_id / project_id / environment_id / provider_connection_id / virtual_key_id / owner`
- 模型与价格：`provider / provider_model / canonical_model / model_family / pricing_source / input_usd_per_million / output_usd_per_million`
- 核算指标：`prompt_tokens / completion_tokens / total_tokens / cost_usd / status`
- 排障追踪：`request_id / provider_request_id / metadata_json`

这份 schema 的目标不是替代产品调试导出，而是给财务、经营和管理层报表提供不轻易变更的基础数据面。

## 5. 常用报表模板

当前在 contracts 中冻结了以下模板定义：

- `daily-burn-rate`
- `weekly-chargeback`
- `monthly-management-summary`
- `provider-reconciliation`
- `forecast-watchlist`
- `workspace-cost-breakdown`

这些模板先作为稳定定义存在，后续 UI 可以直接消费。

## 6. 后续推荐顺序

1. 让财务/运营先使用 `usage-ledger.v1` 导出做对账和试算。
2. 基于 `usage_forecast_daily` 增加 burn-rate、forecast ETA 和月末预测查询。
3. 再把常用模板接到 `exports` 页和 scheduled report preset。
