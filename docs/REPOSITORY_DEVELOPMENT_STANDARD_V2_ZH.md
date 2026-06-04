# 仓库开发规范 v2（Token 出海仓库适配版）

适用范围：

- `.`
- 前端重点：`apps/web-admin`
- 后端重点：`apps/control-api`、`apps/gateway`、`apps/export-worker`
- 共享包重点：`packages/*`

本文档不是对外部“大厂规范”的复述，而是本仓库的正式落地版规范。

关系说明：

- `docs/BIGTECH_DEVELOPMENT_STANDARD_ZH.md` 继续保留，作为外部原则来源与 UI 结构收敛参考。
- 本文档是仓库执行标准，优先级高于“泛化的大厂经验整理”。
- 当外部原则与本仓库阶段冲突时，以“可维护、可验证、可交付”的仓库标准为准。

---

## 一、规范分层

本仓库规范分为三层：

1. **仓库级工程规范**
   - 测试、构建、类型检查、CI、产物、目录卫生
2. **产品实现规范**
   - `web-admin` 页面结构、文案、资源页主次
   - control plane / gateway / worker 的模块分层
3. **评审与整改规范**
   - PR 必答问题
   - 当前已知高优先级整治面

禁止再把纯 UI 规范误当成整个 monorepo 的完整开发规范。

---

## 二、仓库级工程规范

### 1. 根命令必须完整

根 `package.json` 必须长期保持以下能力：

- `lint`
- `typecheck`
- `test`
- `build`

要求：

- 所有活跃应用都必须纳入至少 `build + typecheck`
- 有业务逻辑的应用必须纳入 `test`
- 任何包如果参与线上路径，不能只靠“被别人间接 build 到”

### 2. 失败测试不得带病合入

以下情况默认阻塞合入：

- root test 失败
- 任一活跃应用测试失败
- 构建失败
- 类型检查失败

例外只能用于：

- 明确标记为废弃路径
- 本次 PR 同时删除该路径
- PR 描述写明例外原因

### 3. 必须有持续集成入口

仓库必须具备统一 CI，至少执行：

1. install
2. typecheck
3. test
4. build

没有 CI 的仓库，代码健康不可被制度化验证。

### 4. 构建产物不能污染源码树

必须遵守：

- `dist/`、`.next/`、`coverage/`、`*.tsbuildinfo` 不得作为源码资产长期留在工作树
- 测试文件不得进入生产构建产物
- 临时截图、QA 图片、扫描输出、一次性脚本不得堆在仓库根目录

推荐：

- QA 产物统一放到独立目录，例如 `qa-artifacts/` 或本地忽略目录
- 构建配置显式排除 `*.test.ts`、`*.spec.ts`

### 5. 仓库卫生必须可持续

禁止：

- 重复配置文件共存，例如 `next.config 2.mjs` 这类副本文件
- 语义不明的临时文件长期保留在根目录
- 生成文件混入 `src/` 并与源码并列维护，除非该包明确采用预编译分发策略

### 6. 共享逻辑不允许三处复制

当同一类逻辑在三个地方以上出现时，必须评估抽取：

- CORS / origin allowlist
- 安全 header
- URL / query 规范化
- 错误映射
- 过滤器序列化

允许有薄封装差异，不允许长期复制粘贴演化。

---

## 三、web-admin 页面规范

### 1. 本规范主要约束资源页

以下页面默认视为资源页：

- Workspaces
- Providers
- Virtual Keys
- Members
- Projects
- Budgets
- Alerts
- Usage Events
- Audit Logs
- Exports

以下页面不强行套用“单资源页顺序”：

- Home / Overview / Inbox
- 纯创建页
- 纯详情页
- 明确的工作流页

### 2. 资源页默认顺序

资源页默认使用以下顺序：

1. 页面标题与 scope
2. 过滤器
3. 4 个以内 summary
4. 当前主动作或主状态
5. 资源表格 / 资源列表
6. 批量动作
7. 次级治理信息、审计、导出、透镜、创建表单

说明：

- 如果页面是目录页，`filters + list` 优先级必须高于“解释页面”
- 如果页面是 inventory 页，表格必须是主角

### 3. 一个页面只能有一个主叙事

这里不是机械地限制“页面里只能有一个按钮”，而是要求：

- 用户进入页面后，能立刻判断“先做什么”
- 不允许多个同级 hero / queue / action deck 同时争夺首屏

允许存在：

- 行级操作
- 批量操作
- 次级跳转

不允许存在：

- 多个并列的“下一步”
- 多个并列的主风险模块
- 多个并列的解释性摘要区块

### 4. 表单默认后置

对于资源页：

- 创建表单默认在折叠区、抽屉、弹层、右栏或列表之后
- 只有在空状态且“创建就是唯一主任务”时，创建表单才能前置

### 5. 次级治理信息必须收敛

以下内容默认属于次级层：

- owner / team / service lenses
- queue pivots
- audit / export handoff
- lifecycle trail
- cross-page shortcuts

处理规则：

- 放在表格之后
- 或折叠
- 或放进 detail / advanced 模式

### 6. Home 是 overview，不是 dashboard collage

Home 页允许多信号，但仍需满足：

- 上半屏安静
- 状态结论先出现
- Inbox 与 Activity 不并列抢主线
- Setup / Readiness 只在需要时出现

### 7. 命名与文案规则

必须遵守：

- 类型 `PascalCase`
- 变量 / 函数 / 属性 `camelCase`
- 不使用 `I` 前缀接口
- 名称尽量用完整单词
- 页面内局部类型定义尽量前置

新增 UI 命名禁止继续扩散：

- `desk`
- `tower`
- `lane`

这些旧命名可以逐步整改，但新代码不得继续引入。

文案要求：

- 短
- 直接
- 先结论后补充
- 按钮使用动作词

避免：

- “This page helps you…”
- “Use this section to…”
- 解释性长句
- 同义词堆叠

### 8. 壳层默认参数

`web-admin` 资源页默认使用：

- `headerMode = "compact"`
- `sidebarVariant = "minimal"`
- `showSupportPanels = false`
- `showOperatorContextCards = false`

如果偏离，PR 必须说明：

- 页面类型为什么不同
- 为什么不能用默认壳层

### 9. 旧结构禁止继续扩散

以下结构视为旧范式：

- `legacy-grid`
- 大量 `card / metric-card / action-card` 拼贴
- 页面内多个“summary-row + metric-grid + action-card”段落反复出现

新改动不得复制这套结构到新的页面或新的区块。

---

## 四、后端与服务规范

### 1. 按职责分层，不写 God file

禁止把以下责任长期堆在一个文件中：

- 路由注册
- 鉴权
- 参数校验
- 领域决策
- 数据访问
- 副作用编排
- 外部服务调用
- 错误映射

### 2. 数据层必须按领域拆分

`packages/database` 不应继续把整个数据访问层维护成单一 `index.ts`。

应逐步拆为领域模块，例如：

- `organizations`
- `workspaces`
- `projects`
- `members`
- `providers`
- `virtual-keys`
- `budgets`
- `usage`
- `exports`
- `alerts`

可以保留一个顶层导出文件，但不应继续把实现全塞在一个文件内。

### 3. gateway 必须保持瘦而清晰

`apps/gateway` 重点是：

- 请求认证
- key 解析
- provider 选择
- policy / budget 判定
- upstream proxy
- usage / alert side effects

这些逻辑允许协作，但不应长期集中在一个超大 route 文件中。

推荐拆分为：

- auth / request guards
- provider resolution
- budget enforcement
- alert sync
- usage persistence
- upstream invocation
- error mapping

### 4. route 文件只负责 transport 层协调

route handler 应优先负责：

- 取请求
- 调 service
- 发响应

不应直接承载大段领域规则。

### 5. shared package 要有边界

`packages/contracts`、`packages/config` 这类共享包允许集中导出；
但其职责必须稳定：

- contracts：schema / type / pure helper
- config：env loading / parsing
- export-jobs：导出生成与 worker 共享逻辑

禁止把应用层杂逻辑塞进 shared package。

---

## 五、测试与验证规范

### 1. 变更必须对应验证

页面改动至少满足其一：

- 新增或更新测试
- 通过现有 smoke / build / typecheck 覆盖到
- 在 PR 描述写明人工验证步骤

后端逻辑改动默认应有自动化测试。

### 2. 回归优先修，不靠文档绕过

当发现失败测试时，优先做：

1. 确认失败是否真实
2. 修测试或修实现
3. 再继续新增功能

禁止把“已有失败”当作长期常态。

### 3. 评审不只看功能跑通

评审必须同时看：

- 结构是否更清晰
- 是否引入重复层
- 是否扩大了维护面
- 是否让后续更难测

---

## 六、PR 评审清单

每个 PR 至少回答：

1. 这次改动的主目标是什么？
2. 改动后页面 / 模块的主任务是否更清楚？
3. 是否减少了重复 summary、重复入口、重复状态表达？
4. 是否引入了新的临时文件、重复配置、无用产物？
5. 是否把逻辑继续堆进了超大文件？
6. 是否补了对应测试或验证说明？
7. root `build / test / typecheck` 是否应当通过？
8. 新文案是否更短、更直接？
9. 这次改动是在收敛复杂度，还是继续叠加复杂度？

---

## 七、当前仓库的高优先级整改项

### P0：工程门禁

优先补齐并稳定：

- root `lint`
- root `typecheck`
- CI
- 修复当前失败测试
- 清理重复配置与无关产物

### P1：高噪声资源页

优先整改：

- `apps/web-admin/app/virtual-keys/virtual-keys-workspace-view.tsx`
- `apps/web-admin/app/budgets/page.tsx`
- `apps/web-admin/app/members/page.tsx`

目标：

- 去掉 dashboard collage
- 收回主线
- 把治理、审计、导出、创建表单降到次级

### P1.5：超大文件拆分

优先拆分：

- `packages/database/src/index.ts`
- `apps/gateway/src/routes.ts`
- `apps/web-admin/app/components/app-shell.tsx`

### P2：仓库卫生

优先处理：

- QA 截图与临时文件归位
- `*.tsbuildinfo` 忽略规则
- 重复配置文件删除
- 构建产物排除测试文件

---

## 八、执行原则

本规范从下一次仓库结构改动起默认生效。

执行方式：

1. 新页面先写“页面主任务”
2. 新模块先回答“是否稀释主线”
3. 新服务逻辑先回答“应该放在哪一层”
4. PR 先回答“是否让仓库更健康”

核心原则只有一句：

**不再继续叠加复杂度；默认做收敛、分层、减噪和可验证。**
