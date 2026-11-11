# MovieAgent MCP（M1）

当前版本面向 Windows 本机。先打开 MovieAgent 的项目工作区，再启用 MCP。MCP 与桌面共用引擎、资产、画布和任务，关闭桌面后不能单独创作。

## 接入

1. 双击 `D:\\movieAgent\\启动MovieAgent.cmd`，打开已有短剧项目或新建项目。
2. 进入 **模型设置 → MCP · 外部 Agent 接入 → 启用 MCP**。
3. 点击 **复制 MCP 配置**，粘贴到客户端的 MCP 配置中。不同客户端的配置文件格式可能不同，填写其中的 command、args、env 即可。
4. 客户端调用 `system_instances` 选择工作区，再读取 `system_doctor`、`system_capabilities`。后续工具都显式传 instanceId；涉及作品的工具还传 libraryId、projectId、subprojectId。
5. 应用重开后重新发现 instanceId。重试原操作时保留原 requestId 和业务参数。

配置中的 env 必须保留 `ELECTRON_RUN_AS_NODE=1`。使用应用自带 Electron，不要求全局安装 Node.js。复制配置不会导出模型密钥。安装目录改变后重新复制配置。

根目录 `MovieAgent-MCP.cmd` 是当前版本的稳定 stdio 入口，可由 MCP 客户端通过 `cmd.exe /d /c D:\\movieAgent\\MovieAgent-MCP.cmd` 启动。默认发现当前 Windows 用户的 MovieAgent 工作区；自定义 launcher-data 的工作区请使用界面复制的配置。

## Agent 生成图片后怎么传入

MCP 本身不提供宿主生图能力。Agent 使用当前宿主可用的生图工具得到真实 PNG/JPEG/WebP 文件，然后：

1. 调用 `import_sources` 获取收件目录或用户已授权的图片目录。
2. 将图片写入收件目录；也可以在桌面点击“添加图片目录”，授权已有图片所在目录。
3. 调用 `assets_import`：用 importSourceId 加目录内相对路径；不要传任意绝对路径。
4. 用 `imports_get` / `imports_wait` 查看完成情况。拿到 asset.ref 后可通过 `assets_preview` 查看缩略图。
5. 按需要绑定角色、分镜或画布。导入操作也支持一次携带 bindings，返回每一步结果。
6. 若需要跨集使用，传 shared: true；默认归属当前子项目。

图片会收存到项目对象库。导入完成后删除原始临时图片不影响已导入的资产。固定 assetId/version 保证旧镜头不会随图片新版本自动改变。

示例参数（ID 从查询结果获取）：

```json
{
  "instanceId": "当前实例ID",
  "requestId": "episode1-character-zhuqing-v1",
  "scope": {
    "libraryId": "资料库ID",
    "projectId": "父项目ID",
    "subprojectId": "子项目ID"
  },
  "name": "朱清角色参考",
  "shared": true,
  "source": {
    "kind": "localFile",
    "importSourceId": "inbox",
    "path": "zhuqing.png"
  },
  "sourceInfo": {
    "sourceKind": "agent",
    "sourceApp": "Codex"
  }
}
```

requestId 必须是字母、数字、短横线或下划线，长度 1–128。上例请换成实际合法 ID。图片版本更新通过 assets_import 的 targetAsset 提交，并携带 expectedVersion；现有引用仍固定在旧版本。具体字段以工具 JSON schema 为准。

文件导入上限 32 MiB，图片最多 4000 万像素；只接受静态 PNG/JPEG/WebP。没有可共享路径时可用 source.kind: bytes，传 fileName、mimeType、base64，解码上限 8 MiB。文件链接、目录越界、正在变化的源文件会被拒绝。视频模型的图片输入还有其自身限制，导入成功不代表任意模型都接受。

## 用已有图片生成视频

桌面中，在分镜生产面板勾选“复用已选分镜图”，选择首帧或参考图用途。已复用的镜头不会建立生图步骤。

MCP 的顺序为：

`creation_get → models_list → production_prepare → production_apply → production_prepare_execution → production_execute`

- production_prepare 指定现有镜头和 reusedImages 的固定图片引用，同时选择 videoProfileRef。不必配置 imageProfileRef。
- production_apply 只更新画布；prepare_execution 只冻结工作流。
- production_execute 会在桌面显示模型、步骤数、费用估计、总上限和每步上限。取消不会提交任务；客户端不能靠 approved: true 绕过。
- 已提交任务使用 production_get / tasks_get / tasks_wait 查询；连接超时先核对同一个请求，不能换 requestId 盲目重发。
- tasks_reconcile 核对已有任务；取消不保证已受理的远端任务不收费。

M1 对接已有普通图片视频路径（minimax-video-v2），models_list 的 mcpImageReuse 标明适配情况。H3 声音参考专用路径需要音频输入，属于后续音频工作流，不在本批承诺范围内。模型真实可用性、计费和生成质量需使用自己的服务另行验证。

## 本批工具与边界

可用：工作区发现/打开、项目和子项目查询/创建、资产导入/版本/预览/标签/共用、实体参考与分镜图片绑定、画布图片节点/连接、已有镜头的视频生产、任务查询/取消/核对。

后续 M2/M3：完整剧本/分镜编辑、完整画布操作、声音和配音、时间线与成片导出 MCP。应用原有的这些桌面功能不等于已经有 MCP 工具。

新建独立项目目录仍使用桌面启动器。project_create 仅用于旧版未绑定目录的资料库，不能绕过短剧工作目录规则。

## 恢复和管理

- 同一个 requestId 和相同参数重试会返回原结果；换参数会报冲突。每个新意图使用新的 requestId。
- 导入 partial 表示原件已收存但部分绑定失败；不要重复上传。读取错误和已完成步骤，冲突时用最新版本号重新执行对应绑定工具。
- imports_resume 继续原导入未完成步骤；imports_cancel 停止后续步骤，保留已经收存的资产。
- 模型配置仍属于应用，MCP 只返回模型/预设和能力，不返回 API Key、请求头或服务 URL。
- “断开连接”结束当前会话；客户端仍可重新连接。“停用 MCP”阻止继续接入。已受理导入/生成可能继续完成。
- MCP 回执、来源说明和目录授权保存在当前用户应用数据的 mcp 目录，属于桌面客户端状态；项目备份包含已收存资产，但不包含该客户端日志。搬迁电脑后应重新授权并重新核对资产，不能依赖旧客户端回执。
- 目前导入暂存副本会保留用于恢复；不要在任务运行或恢复时手动删改应用状态。

## 本批已知小问题

- 批准前已停止的工作流，production_execute 可能返回 submitted: true，但 state 为 stopped 且没有任务。请结合 workflow.state 和任务列表判断，不能只看 submitted。
- production_prepare_execution 在已有工作流的快捷返回中，未拦截同一 requestId 被改用于其他 productionId；每个生产意图使用独立 requestId。此路径不提交付费任务。
- 以上两项列入后续修正，不影响本批图片导入、固定版本复用和一次性费用确认。

## 本地验收说明

验收记录见工作区 `verification/2026-11-02-spec004-m1/`。自动验收使用真实打包桌面、官方 MCP SDK 和本机假服务，验证导入、复用、确认、恢复与请求内容；不消耗真实模型额度。是否通过以该目录最终报告为准。宿主实际生图到 MCP、真实付费视频与人工效果单独验收。
