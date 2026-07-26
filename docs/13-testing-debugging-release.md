# 测试、调试与发布

> **文档角色**：验证策略、问题定位、CI 和发布操作
> **权威性**：工程流程规范；当前命令以 `package.json` 为准
> **何时阅读**：选择测试、定位确定性/AI/Worker/WebGL 问题、修改 CI 或准备发布时
> **可跳过**：尚未进入验证阶段且测试路径已由相邻用例明确的微小改动
> **相关代码**：`src/**/*.test.ts`、`tests/e2e`、`scripts/run-e2e.mjs`、`.github/workflows`

## 1. 验证层级

### 1.1 纯规则测试

位置：`src/sim/*.test.ts` 与 `src/demo/*.test.ts`，运行环境为 Node.js。

适合：

- 坐标、通行、视线和寻路；
- 命中、伤情、士气和占领纯函数；
- 输入验证；
- 单个 AI 决策条件。

纯规则测试应使用最小输入，避免依赖完整随机地图造成难以解释的失败。

### 1.2 确定性场景测试

使用固定地图或固定 seed，运行多个 tick 后断言事件、检查结果、最终结果和状态哈希。

至少覆盖：

- 相同 setup 的两个模拟逐 tick 或最终哈希一致；
- 终止后继续 `step()` 不改变结果和哈希；
- 延迟情报按观察 tick 和送达 tick 生效；
- 同时交火不受遍历先后影响；
- 模式任务真实推进并以正确原因结束。

AI 回归优先断言事实，例如“进入目标并产生占领进度”，不要绑定每个中间路径点，除非路径本身就是待测规则。

### 1.3 浏览器端到端测试

位置：`tests/e2e/battle.spec.ts`。

真实启动 Vite、Web Worker 和 WebGL，用于验证：

- 运行、暂停、显式步进和会话切换；
- Canvas 非空、地形与关键效果可见；
- 镜头缩放、复位和选中检查；
- 桌面与 `390x844` 窄屏不溢出或遮挡；
- 目标区、曳光等特征像素实际出现；
- 页面错误和控制台错误为空。

不要仅断言 Canvas 元素存在。Three.js 场景可能在空白或资源失败时仍创建 Canvas。

## 2. 命令

```powershell
npm test
npm run test:watch
npm run build
npm run test:e2e
npm run perf
npm run docs:check
npm run check
npm run verify
```

| 命令 | 内容 | 何时必须运行 |
| --- | --- | --- |
| `npm test` | 全部 Vitest | 任意模拟、类型或规则改动 |
| `npm run build` | `tsc -b` + Vite production | 任意可提交改动 |
| `npm run test:e2e` | Playwright + Worker + WebGL | UI、Worker、协议、渲染改动 |
| `npm run perf` | 生产构建上的固定中型/大型 Playwright 基准 | 性能优化前后、规模验收和发布候选 |
| `npm run docs:check` | 文档头、索引登记和本地链接 | 任意文档改动 |
| `npm run check` | docs:check + test + build | 文档以外的普通提交 |
| `npm run verify` | check + e2e | 跨模块功能、发布和主分支合入 |

纯文档改动至少检查链接、命令和当前实现描述；如果同时修改配置，运行 `npm run build`。

## 3. 固定场景调试

URL 参数：

| 参数 | 示例 | 作用 |
| --- | --- | --- |
| `seed` | `seed=defense-bravo` | 固定地图和战斗随机输入 |
| `mode` | `mode=defense` | 选择 `conflict` 或 `defense` |
| `autostart` | `autostart=0` | 初始化后保持暂停 |
| `e2e` | `e2e=1` | 安装测试调试桥 |

示例：

```text
http://localhost:5173/?seed=defense-bravo&mode=defense&autostart=0&e2e=1
```

浏览器控制台可在该模式下使用：

```js
window.__battleTest?.getTick();
window.__battleTest?.getStateHash();
window.__battleTest?.getObjectives();
window.__battleTest?.step(200);
```

测试桥不保证向后兼容，不得被正式游戏系统调用。

## 4. 确定性问题定位

出现相同 seed 不同结果时：

1. 确认 setup 和 `rulesVersion` 完全相同。
2. 在两个模拟上逐 tick 比较 `getStateHash()`，找到第一个分叉 tick。
3. 检查该 tick 新增或修改的集合遍历顺序、随机键和冲突优先级。
4. 检查新权威字段是否遗漏在哈希或克隆中。
5. 检查是否把真实时间、渲染帧率或异步完成顺序带入模拟。
6. 用最小固定地图固化回归测试。

不要通过删除哈希字段或放宽断言掩盖分叉。

## 5. AI 问题定位

1. 固定 seed 和模式，暂停后按较小 tick 批次推进。
2. 使用 `inspect(groupId)` 查看 `decisionReason`、目标、路径、接触和防守阵位。
3. 分清真实敌军位置、直接接触、本地最后已知位置和势力共享情报。
4. 检查决策是否被更高优先级状态永久覆盖，例如高压制、直接接触或撤离。
5. 长程运行到模式结束，确认任务不是只在开局看起来正确。
6. 回归断言任务事实和终止原因。

AI 行为“看起来不聪明”可能是数值问题，也可能是状态机死锁。连续没有任务进度时优先排查逻辑覆盖关系，而不是先调数值。

## 6. Worker 问题定位

- 初始化后没有帧：检查 Worker `error`、setup 验证和会话 ID。
- 切换模式后旧画面闪回：检查消息的 `sessionId` 过滤。
- 暂停仍推进：检查 timer 清理和是否有调试 step 命令。
- 后台回来追赶过多：检查累积时间 250ms 钳制和 4 tick catch-up 上限。
- 页面正常但结果丢失：检查最后一批 pending events 和 `finished` 消息顺序。

协议问题应在真实 Worker E2E 中验证，仅直接调用模拟不能覆盖线程生命周期。

## 7. WebGL 和 UI 问题定位

- 先收集 `pageerror` 与 console error。
- Canvas 检查不透明比例、亮度范围和量化颜色数。
- 曳光、目标圈等使用颜色阈值或局部像素特征，避免整图快照因地形细节频繁变化。
- 动态 Three.js 资源必须 `dispose()`，长时间观察内存是否持续增长。
- UI 检查 bounding box，不只看截图；工具栏、势力卡和目标 HUD 应有明确间隔。
- 镜头位置和显示质量变化后，固定 seed 的状态哈希必须不变。

## 8. 测试选择矩阵

| 改动 | Unit | 场景/确定性 | E2E | 文档 |
| --- | --- | --- | --- | --- |
| 纯数学或局部规则 | 必须 | 视影响 | 否 | 数值语义变化时 |
| AI、情报、伤害、目标、终止 | 必须 | 必须 | 有用户可见行为时 | 必须 |
| `BattleSetup` / `BattleResult` | 必须 | 必须 | 接入变化时 | 必须 |
| Worker 协议或节拍 | 视情况 | 必须 | 必须 | 必须 |
| Three.js 表现 | 否 | 哈希不变 | 必须 | 重要表现规范时 |
| React UI / 响应式 | 否 | 否 | 必须 | 操作变化时 |
| 性能优化 | 必须 | 哈希对比 | 性能/视觉相关时 | 记录基准 |
| 纯文档 | 否 | 否 | 否 | 检查链接与事实 |

## 9. 性能基线

`npm run perf` 在 `4174` 端口启动生产预览，依次运行固定的 `medium` 和 `large` 场景。可用 `$env:PERF_PROFILE='medium'` 或 `large` 只运行一个档位。每个场景暂停启动，每 2 tick 推进一次并等待两个 RAF，共采集 120 tick；第二个会话一次性重放相同 tick 数并断言最终哈希一致。输出中的 `PERF_RESULT` 是可机器读取的单行 JSON。

固定场景：

| 档位 | seed | 地图 | 编组 | 成员 |
| --- | --- | --- | --- | --- |
| 中型 | `perf-medium-stage-2` | `256 x 256` | 75 | 600 |
| 大型 | `perf-large-stage-2` | `512 x 512` | 252 | 2016 |

参考设备为 Windows 11 Pro `10.0.26200`、Intel Core i5-14600KF、20 逻辑处理器、31.8 GiB 内存、NVIDIA GeForce RTX 4070 Ti SUPER、Microsoft Edge `150.0.4078.83`，视口 `1440 x 900`。`2026-07-26` 的 headless 生产构建基线如下；时间单位为毫秒，消息体积按数值、布尔值、TypedArray buffer 及 UTF-8 字段名/字符串估算，不含浏览器结构化克隆对象头：

| 档位 | 初始化 | tick P95 / P99 | 投影 P99 | 常规帧消息 | RAF P95 / P99 | 主页面堆增长 | 120 tick 哈希 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 中型 | 197.1 | 1.1 / 1.5 | 0.2 | 91,146 B | 5.7 / 16.7 | 1.82 MiB | `e3ed66bc` |
| 大型 | 1052.7 | 13.8 / 23.2 | 0.6 | 306,554 B | 16.6 / 22.3 | 3.19 MiB | `820a26f7` |

设备验收预算：

| 指标 | 中型标准档 | 大型高负载档 |
| --- | ---: | ---: |
| 初始化 | 不超过 2 s | 不超过 5 s |
| tick P99 | 不超过 25 ms | 不超过 50 ms，保持 20Hz 模拟余量 |
| RAF P99 | 不超过 20 ms，目标 60 FPS | 不超过 33.3 ms，允许 30 FPS 表现 |
| 常规帧消息 P99 | 不超过 128 KiB | 不超过 384 KiB |
| 120 tick 主页面堆增长 | 不超过 16 MiB | 不超过 32 MiB |

大型档超过表现、消息或主页面内存预算但 tick 仍合格时，按 `WEB-001` 的低质量档依次降低 DPR、关闭阴影、减少非权威曳光/粒子和装饰物，并保持单位、权威静态对象与模拟规则不变。若 tick P99 超过 50 ms，表现降级不能解决模拟瓶颈：不得降低模拟 Hz 或停止离屏战斗，应阻止该设备自动进入大型档并先优化感知、寻路或空间查询。当前质量档位尚未实现，因此低于预算的设备暂不承诺大型体验。

浏览器 `performance.memory` 只作为 GC 后主页面 JS 堆趋势，不覆盖 Dedicated Worker 独立堆；长时间运行和 Worker 总内存仍是后续发布采样项。基准不是 CI 默认步骤，不能用不同设备的一次波动直接修改预算；性能改动需在同一设备、浏览器和 seed 上比较，并保存前后 `PERF_RESULT`。

## 10. CI

`.github/workflows/ci.yml` 在 push 和 Pull Request 上执行：

1. Node.js 22 + `npm ci`；
2. 安装 Playwright Chromium；
3. `npm run verify`。

本地 Playwright 默认使用系统 Microsoft Edge，CI 使用 Chromium。测试不能依赖仅某一浏览器通道存在的私有行为。

CI 失败时不得只重新运行直到偶然通过。先用相同 seed 和测试名称本地复现；需要重试的网络或资源步骤应与确定性战斗断言分开。

## 11. 发布检查表

### 代码与规则

- [ ] `npm ci` 在干净环境成功。
- [ ] `npm run verify` 全部通过。
- [ ] schema/rules 版本与行为变更匹配。
- [ ] 固定基准场景的哈希变化已解释。
- [ ] 最终结果包含外部系统需要的稳定 ID 和状态。

### 体验

- [ ] 冲突和防守模式各手动观察至少一个完整战斗。
- [ ] 暂停、重开、模式切换、自由镜头和选择可用。
- [ ] 桌面与窄屏无文字溢出和面板遮挡。
- [ ] Canvas、目标区、单位、曳光和结果提示可见。
- [ ] 浏览器控制台无错误。

### 文档与交付

- [ ] `docs/09-implementation-status.md` 已更新。
- [ ] 新契约、命令和迁移步骤已记录。
- [ ] 已知限制和非阻塞警告已记录。
- [ ] 未提交生成目录、测试产物、日志或本地配置。
- [ ] 发布提交能够从 lockfile 重建。

## 12. 当前非阻塞警告

生产构建目前会提示主前端包超过 500KB。它不影响当前垂直切片正确性，但在城市建造界面和更多战场资产接入前，应按场景或路由做代码拆分并建立加载性能预算。
