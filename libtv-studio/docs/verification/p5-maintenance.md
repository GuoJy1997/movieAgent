# P5 本机维护验收

最终独立复审修复与发行验收完成。证据目录：`.superpowers/sdd/2026-10-29-p5-local-maintenance/`；源码起点是显式 P4 脏源码快照，而非未包含这些源码的 Git HEAD。累计源码与精确包哈希归档在 `deliveries/2026-10-29-p5-local/`。

已执行：

| 验证 | 结果及证据 |
| --- | --- |
| 原目录项目与启动基线 | 55 项通过，baseline.* |
| 首次完整核心集成 | 88 文件 / 763 项通过，task-4-core.* |
| 补充对象身份校验、备份与恢复暂停 | 18 项通过，task-4-object-identity-green.*；对应错误对象身份先有实际 RED |
| 实际打包程序维护与视频原件 | 2 项通过，task-4-desktop-3.*；恢复暂停、冷启用、视频字节一致 |
| IPC 窗口/iframe/路径保护 | launcher-security 在 task-3-green-2 / task-4-desktop 中通过 |
| 应用壳相关界面回归 | 21 项通过，task-4-renderer-2.*，使用已安装 Chrome；首次因缺少 Playwright 浏览器未进入测试，日志保留 |
| TypeScript | final-typecheck.* EXIT0 |
| 首次 P5 NSIS / 包内运行时 | task-4-package.* / task-4-package-verify.* EXIT0；最终修复后会重新打包复验 |
| 最终审查问题复现 | final-review-red.*：7 项中 5 项失败，覆盖实际状态、停用/占用、首次绑定和 DELETE 库字节变化；非问题的 WAL/无关绑定保护已有断言 |
| 最终审查修复回归 | final-review-green.*：25/25 通过 |
| 最终完整核心集成 | final-core.*：89 文件 / 771 项通过，303.10 秒 |
| 最终 TypeScript / 构建 | final-typecheck-2.* / final-build.* EXIT0 |
| 最终 NSIS / 包内运行时 | final-package.* / final-package-verify.* EXIT0 |
| 最终实际程序 | final-desktop.*：2 文件 / 3 项通过；含已启用目标重复恢复的真实界面提示、恢复视频原件与暂停/启用、IPC 边界 |

独立审阅由一次新上下文完成，报告 `final-review.md`；无 Critical/Minor，3 项 Important 由控制器集中修复，未追加第二轮审阅。修复分别验证：重复恢复读取当前维护状态并在占用时拒绝；文件型项目仅允许由自身 `directory-init-<workspaceId>` 事务回执证明的首次绑定；未来 schema 在只读检查后拒绝，DELETE 和已提交 WAL 字节均保持。

打包验证包含 Electron45、Node24.22、ABI150、SQLite3.53.4、Sharp 原生 PNG、FFmpeg/FFprobe 和中文字体，以及四个隔离 preload / HTML CSP。此验证不等于在无开发环境的干净机器上安装。

所有本轮媒体为已有或测试夹具，配置为自有空配置/虚构服务，不读取真实模型密钥，不新增真实调用费用。真实模型的声音、方言、口型质量、供应商账单、跨电脑任务停止证明、签名、公发行媒体材料不在本轮已验范围。
