# 后端工程师编码测试 — GraphQL API 服务器（TypeScript）

> **语言 / Language:** [English](README.md) · **简体中文**

基于 **Apollo Server 5** + **TypeScript**（Node.js + Express 5）的 GraphQL API：严格实现
`Backend_Coding_Test/code_test_v1.pdf` 中的 schema，以题目提供的 JSON 文件作为内存数据源。所有请求
都必须携带 `Authorization: Bearer <token>`。共享类型声明集中在 [`src/types.ts`](./src/types.ts)；
`npm run build` 输出 `dist/`（JS + `.d.ts`）。更多文档：[数据源映射](./docs/data-mapping.md) ·
[Apollo Server 5 笔记](./docs/apollo-notes.md) · [测试说明](./tests/README.md)。

---

## 1. 快速开始

```bash
npm install
npm start        # prestart 先执行 `tsc`，再运行 node dist/index.js
```

然后访问 `http://localhost:4000/graphql`（也支持 `/`），Sandbox 在 `/`，健康检查在 `/health`，
token 为 `backend-test-token`。要求 Node.js **>= 20**；`npm start` 会自动构建，全新 clone 无需其他步骤。

| 命令 | 作用 |
|---|---|
| `npm start` | `tsc` 构建 + 运行 `dist/index.js` |
| `npm run build` / `npm run typecheck` | 编译到 `dist/` / 仅严格类型检查 |
| `npm run dev` | `tsx watch src/index.ts`（热重载） |
| `npm test` / `npm run smoke` | 构建 + 测试 / 端到端冒烟检查 |

## 2. Token 与 Apollo Sandbox

| | |
|---|---|
| **Bearer token** | `backend-test-token` |
| 请求头 | `Authorization: Bearer backend-test-token` |
| 覆盖方式 | `AUTH_TOKEN=my-secret npm start`（支持逗号分隔多 token） |

启动时 `npm start` 会打印 token，[`.env.example`](./.env.example) 也记录了它。浏览器打开
<http://localhost:4000/>，点击 **⚙ Connection settings → Shared headers** 填入：

```json
{ "authorization": "Bearer backend-test-token" }
```

只有 Sandbox 的 HTML 页面是公开的 —— **所有** GraphQL 操作（含 introspection）都需要该 header。
不走 Sandbox 的快速验证：`curl -s localhost:4000/graphql -H 'content-type: application/json' -H 'authorization: Bearer backend-test-token' -d '{"query":"{ node { _id name } }"}'`

## 3. HTTP API

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| `POST` | `/graphql`（也支持 `/`） | Bearer | GraphQL 端点 |
| `GET` | `/graphql` | Bearer | GraphQL-over-HTTP 查询（`?query=...`） |
| `GET` | `/` | 公开 | Apollo Sandbox HTML（`Accept: text/html`） |
| `GET` | `/health` | 公开 | 存活探针 + 集合数量 |

token 缺失/错误 → **HTTP 401**，`extensions.code = "UNAUTHENTICATED"`（body 解析前先拦截，GraphQL
context 中再校验一次）。未知路径 → `404` JSON，code 为 `NOT_FOUND`。

## 4. Schema

与 PDF 逐字一致（权威副本：[`src/schema/typeDefs.ts`](./src/schema/typeDefs.ts)），另含 schema 声明的
两个自定义标量：

```graphql
scalar Long   # 64 位整数 → 安全整数范围内为 JSON number，否则十进制字符串
scalar JSON   # 任意 JSON，原样透传

type Action            { _id: ID!  createdAt: Long!  updatedAt: Long  name: String!  description: String  functionString: String  resourceTemplateId: ID  resourceTemplate: ResourceTemplate }
type Trigger           { _id: ID!  createdAt: Long!  updatedAt: Long  name: String!  description: String  functionString: String  resourceTemplateId: ID  resourceTemplate: ResourceTemplate }
type Response          { _id: ID!  createdAt: Long!  updatedAt: Long  name: String!  description: String  platforms: [ResponsePlatform] }
type ResponsePlatform  { integrationId: ID  build: Int  localeGroups: [ResponseLocaleGroup] }
type ResponseLocaleGroup { localeGroupId: ID  variations: [ResponseVariation] }
type ResponseVariation { name: String!  responses: JSON }
type ResourceTemplate  { _id: ID!  createdAt: Long!  updatedAt: Long  name: String!  description: String  schema: JSON  integrationId: String  functionString: String  key: String }
type NodeObject        { _id: ID!  createdAt: Long!  updatedAt: Long  name: String!  description: String  parents: [NodeObject]  parentIds: [ID]  root: Boolean  trigger: Trigger  triggerId: ID  responses: [Response]  responseIds: [ID]  actions: [Action]  actionIds: [ID]  priority: Float  compositeId: ID  global: Boolean  colour: String }
type Query             { node(nodeId: ID): NodeObject }
```

`node(nodeId)` → 先按 `_id` 查，再按 `compositeId` 查；省略/`null` → 根节点（`root: true`）；查不到
→ `null`。

## 5. 数据源 → Schema 要点

[`json/`](./json) 由 [`src/data/store.ts`](./src/data/store.ts) 启动时一次性载入并按 `_id` 建立索引；
resolver 负责把存储的 id 引用解析为对象。

| GraphQL 字段 | 数据源 | 映射 |
|---|---|---|
| `parentIds` / `parents` | `node.parents` | 原样 `compositeId` 字符串 / 解析为节点 |
| `triggerId` / `trigger` | `node.trigger` | 原始 trigger id / 从 `trigger.json` 解析 |
| `responseIds` / `responses` | `node.responses` | 原始 id / 从 `response.json` 解析 |
| `actionIds` / `actions` | `preActions` + `actions` + `postActions` | 合并去重（schema 只暴露一组 `actions`） |
| `localeGroupId` | `localeGroups[].localeGroup` | 字段重命名 |
| `Long` / `JSON` 字段 | epoch 毫秒 / JSON | JSON number / 原样透传 |
| `ResourceTemplate.createdAt`、`priority`、`colour` | 部分缺失 | `createdAt` 回退 `updatedAt`（schema 要求 `Long!`）；其余为 `null` |

schema 未暴露的键一律丢弃，引用无法解析时返回 `null`。完整逐字段映射表 + 8 个带期望结果的验收查询：
[`docs/data-mapping.md`](./docs/data-mapping.md)。

## 6. 项目结构

```
Backend_Coding_Test_Demo/
├── json/                 # 数据源（从 Backend_Coding_Test/ 复制）
├── src/
│   ├── index.ts          # 入口：监听 + 优雅退出
│   ├── server.ts         # Apollo 5 + Express 5 装配、鉴权、健康检查、404/错误处理
│   ├── types.ts          # 全部共享类型声明（纯类型模块）
│   ├── config.ts         # AUTH_TOKEN / PORT / HOST / DATA_DIR / LANDING_PAGE
│   ├── auth.ts           # Bearer token 提取、常量时间比较、401 helper
│   ├── scalars.ts        # 自定义 Long + JSON 标量（无额外依赖）
│   ├── data/store.ts     # 载入 + 索引 + 标注 JSON 数据
│   └── schema/           # typeDefs.ts（SDL）+ resolvers.ts（以 `Resolvers` 类型约束）
├── tests/                # node:test 测试（81 个），针对 dist/，`npm test`
├── scripts/              # smoke.mjs + probe-http.mjs
├── docs/                 # data-mapping.md、apollo-notes.md、probes/
├── tsconfig.json
└── package.json
```

`src/types.ts` 集中声明数据记录类型、`DataStore`、`AppConfig`、`GraphQLContext`、`Resolvers` 契约与
`AppServer`（各模块用 `import type` 引用，运行期被擦除）。`package.json` 的 `main`/`types` 指向
`dist/server.js`，因此可以 import `createApp()` 做嵌入。

## 7. 测试与类型检查

```bash
npm run typecheck   # 严格 tsc —— 零错误
npm test            # pretest 先构建，再跑 81 个测试 / 7 个 suite —— 全部通过（约 0.5 s）
npm run smoke       # 对进程内实例做 18 项端到端检查
```

测试会为每个文件在随机端口启动独立的 `createApp()`（无需预先启动服务），并 import 编译后的 `dist/`。
覆盖：token 矩阵、introspection/字段集、按 `_id` 与 `compositeId` 查询每个节点、嵌套遍历、
`Long`/`JSON` 保真、HTTP/CSRF/CORS、生命周期 —— 详见 [`tests/README.md`](./tests/README.md)。

## 8. 配置项

| 环境变量 | 默认值 | 作用 |
|---|---|---|
| `AUTH_TOKEN` | `backend-test-token` | API 接受的 Bearer token（逗号分隔多个） |
| `PORT` / `HOST` | `4000` / `0.0.0.0` | HTTP 端口 / 绑定地址 |
| `DATA_DIR` | `./json` | 数据源目录 |
| `LANDING_PAGE` | `true` | `false` 关闭 Sandbox HTML |
| `NODE_ENV` | — | `production` 关闭 introspection / 堆栈信息 |

`.env` 不会自动加载（未引入 `dotenv`）：`cp .env.example .env && npm run start:env`（Node 的
`--env-file`），或直接导出环境变量。
