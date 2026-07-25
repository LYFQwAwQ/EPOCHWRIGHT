# 参与 EPOCHWRIGHT 开发

本项目仍处于垂直切片阶段。贡献应优先形成可运行、可观察、可复现的闭环，而不是一次铺开多个尚未验证的系统。

## 环境

- Node.js `22.x`，最低版本以 Vite 当前要求为准。
- 使用 `npm` 和已提交的 `package-lock.json`。
- 本地端到端测试默认使用 Microsoft Edge；CI 使用 Playwright Chromium。

```powershell
npm ci
npm run dev
```

## 阅读方式

首次参与项目先读 [文档上下文与阅读指南](./docs/00-context-guide.md) 和 [当前实现状态](./docs/09-implementation-status.md)。需要领取工作时查看 [开发 TODO](./docs/14-todo.md)，然后按任务选择领域文档。不要顺序通读全部文档：`01-08` 包含大量长期目标，范围清晰的改动只需读取相关章节。

自动化开发代理从 [AGENTS.md](./AGENTS.md) 开始，并遵循其中的任务路由；人类开发者可以从 [文档索引](./docs/README.md) 选择入口。

## 日常工作流

1. 从 `14-todo.md` 选择任务并标记 `in-progress`；紧急修复可直接建立任务上下文。
2. 用固定 seed 重现问题或建立最小场景。
3. 确认改动所属模块及边界契约。
4. 先补纯规则或场景测试，再实现行为。
5. 需要展示的新状态通过 `RenderFrame`、事件或按需检查结果公开。
6. 运行与风险相匹配的验证。
7. 完成后更新实现状态、删除 TODO 条目并同步必要接口文档。

## 命令

```powershell
npm test             # 纯模拟与确定性测试
npm run build        # TypeScript 与生产构建
npm run test:e2e     # 真实 Worker、WebGL 和响应式界面
npm run docs:check   # 文档头、索引和本地链接
npm run check        # docs:check + test + build
npm run verify       # check + e2e
```

可以使用查询参数固定观察场景：

```text
http://localhost:5173/?seed=defense-bravo&mode=defense
http://localhost:5173/?seed=my-case&mode=conflict&autostart=0&e2e=1
```

`e2e=1` 暴露的 `window.__battleTest` 仅用于测试和调试，不是产品 API。

## 分支与提交

- 分支建议使用 `feat/`、`fix/`、`docs/`、`test/` 或 `chore/` 前缀。
- 提交信息使用祈使句并说明结果，例如 `feat: add marsh movement costs`。
- 一个提交应保持可构建；规则变更、测试和必要文档应放在同一提交中。
- 不把无关格式化、依赖升级或生成文件混入功能提交。

## Pull Request 最低信息

- 改变了什么行为，为什么改变。
- 哪些规则或边界契约受到影响。
- 使用了哪些固定 seed 或场景验证。
- 执行过的命令及结果。
- 对 UI 改动提供桌面与窄屏截图。
- 已知限制、性能影响和后续工作。

## 代码审查重点

审查优先级依次是：战斗语义正确性、确定性、有限情报隔离、数据契约兼容、线程边界、测试覆盖、性能和视觉表现。仅凭“画面看起来正常”不能证明模拟规则正确。
