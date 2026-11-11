# MovieAgent · Windows 本地测试版

MovieAgent 是内置本机引擎的个人创作工作台。P2 已实现文本、文生图、参考图编辑、MiniMax 视频、软件全局模型配置、资产版本/标签/回收站、类型化画布和一次批准的依赖工作流。Agent、音频时间线、成片导出、远程服务和完整备份迁移仍在后续阶段。

当前交付是 **0.1.0 未签名 Windows x64 本地测试 beta**。P2 新能力使用本机原生 HTTP fixture 验证；真实服务兼容性与干净 Windows 安装验收单独记录。已有 MiniMax 文生视频真实验收属于历史证据，本轮未重新发起收费任务。

- 最终 P2 解包程序：`apps/desktop/release-p2-final/win-unpacked/MovieAgent.exe`。
- 本机入口：`D:/movieAgent/启动MovieAgent.cmd`，保留全局模型文件及项目启动器参数。
- [P2 使用与验证边界](docs/verification/p2-desktop.md)。
- [运行、开发及有限接口验证说明](docs/development.md)。
- [交付路线图](docs/superpowers/plans/2026-10-25-product-delivery-roadmap.md)。

显示名已统一为 MovieAgent；`studio.libtv.desktop` appId、工作区包名与历史数据位置保留。默认资料库仍在 `%APPDATA%/@libtv/desktop/library`，凭据和客户端状态仍在其同级 profile 中。`--user-data-dir` 和 `--library-root` 可显式选择路径。请勿同时用两个实例打开同一资料库，也勿用旧程序直接打开已升级的新 schema 数据库。

先运行本地编辑/导入测试。连接配置与 Key 在程序内通过独立凭据入口设置；任何真实生成都需要用户另行确定连接、模型、提示词和有限风险额度。本地额度不能保证供应商实际账单。关闭窗口时有活动/未知任务可选择托盘继续、完全退出或返回；云端取消需单独请求。

研究资料和原型保留作参考，不是产品功能验收证明。应用自身许可证为 UNLICENSED；第三方许可证随包保留。
