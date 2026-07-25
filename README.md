# EPOCHWRIGHT / 拓世纪

一个面向长期扩展的网页策略游戏项目。目标形态包含城市建造、角色与部队养成、自动沙盘战斗以及跨时代文明演进。

当前仓库实现了战斗系统的可玩垂直切片：两方步兵在随机高度地图上根据有限情报自主搜索、移动、交火、换弹、减员、压制、溃散和撤离，并支持冲突与单目标防守模式。玩家目前只能观察、暂停和操作镜头。

## 技术栈

- React 19 + TypeScript + Vite
- Three.js + React Three Fiber + Drei
- Web Worker 固定步长模拟
- EasyStar.js 路径搜索 + simplex-noise 地图生成
- Vitest + Playwright

## 运行

```powershell
npm ci
npm run dev
```

使用 seed 和模式复现战斗：

```text
http://localhost:5173/?seed=my-battle&mode=conflict
http://localhost:5173/?seed=defense-bravo&mode=defense
```

## 验证

```powershell
npm test             # 纯模拟、确定性和战斗规则
npm run build        # TypeScript 与生产构建
npm run test:e2e     # Worker、WebGL、控制和响应式界面
npm run docs:check   # 文档头、索引和本地链接
npm run check        # docs:check + test + build
npm run verify       # check + e2e
```

## 文档

- [设计与工程文档索引](./docs/README.md)
- [文档上下文与阅读指南](./docs/00-context-guide.md)
- [当前实现状态](./docs/09-implementation-status.md)
- [开发 TODO](./docs/14-todo.md)
- [工程约束](./docs/10-engineering-constraints.md)
- [模块参考](./docs/11-module-reference.md)
- [扩展手册](./docs/12-extension-playbook.md)
- [测试、调试与发布](./docs/13-testing-debugging-release.md)
- [贡献指南](./CONTRIBUTING.md)

## 目录

| 路径 | 职责 |
| --- | --- |
| `src/sim` | 不依赖浏览器的确定性战斗核心 |
| `src/worker` | Worker 节拍和线程消息协议 |
| `src/client` | React 与 Worker 的会话适配 |
| `src/render` | Three.js 战场表现 |
| `src/ui` | 观察、控制和检查界面 |
| `tests/e2e` | 真实浏览器端到端测试 |
| `docs` | 产品设计、架构、扩展与运维文档 |

实现范围和长期设计并不等价。开始开发前先阅读 [当前实现状态](./docs/09-implementation-status.md)，自动化开发代理还必须遵循 [AGENTS.md](./AGENTS.md)。
