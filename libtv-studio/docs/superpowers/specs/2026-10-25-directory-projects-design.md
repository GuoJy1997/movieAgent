# 本机目录式短剧项目与模型配置

## 用户目标

直接在本机运行 MovieAgent；用可编辑配置文件填写 baseURL、apiKey 与模型 ID。像目录式开发工具一样新建、从已有文件夹创建、打开和重新进入短剧项目。一部短剧一个目录，内置可识别、可扩展的项目结构。此次不增加视频/Agent/时间线能力，不自动调用付费模型。

## LibTV 参考的证据边界

已有研究覆盖 LibTV 的可见界面、功能和交互，不证明其服务端实现或内部目录结构。不能据此声称 LibTV 使用本文的文件布局。本文的模板是针对本机选目录、独立保存短剧、搬迁与备份需求作出的实现选择。可编辑创作文件放在项目目录中，业务关联、画布状态和任务记录由项目内资料库管理；不要求每种业务实体都对应一个文件夹。

## 当前实现与实现选择

当前 P1 是单个资料库内多个 project；启动先打开引擎，默认数据在旧 `%APPDATA%/@libtv/desktop`，支持 `--library-root` / `--user-data-dir`。密钥使用 main 的 vault，工作台不拿到可读 Key。

本次选择增加一个无引擎的项目启动器，每个目录项目由独立工作台进程打开，复用已验证的库锁、退出、重连及 IPC。各项目使用独立的应用 profile/outbox/vault，统一读取用户指定的全局模型文件。这样切换项目不需要替换正在执行任务的引擎。启动器关闭不会强制关闭已打开的工作台。此为实施选择，未把它描述为用户另行批准的内部技术细节。

默认不带工作区参数时进入启动器。既有 `--library-root` 或明确 `--legacy-workspace` 仍运行旧工作台；旧资料库入口保留，不迁移、删除或自动拆分已有库。项目工作台提供返回项目启动器及打开本项目目录的入口。

## 内置模板

```text
短剧名称/
  movieagent.project.json
  scripts/outline.md
  scripts/episodes/episode-001.md
  storyboards/episode-001.json
  assets/characters/
  assets/scenes/
  assets/props/
  assets/imports/
  shots/episode-001/
  audio/voice/
  audio/music/
  audio/sfx/
  exports/
  .movieagent/library/
```

manifest 包含固定 format=`movieagent.project`、schemaVersion=1、templateVersion=1、workspaceId、name、createdAt、binding。binding 初始 null，首次工作台初始化后绑定固定 `{libraryId,projectId}`；正常打开不得重新创建丢失的已绑定数据库。资料库和已收存原件由现有引擎管理，位于 `.movieagent/library`，全部跟随短剧目录。assets 等可见目录存放创作源文件和人工整理素材；不冒充已实现角色实体、文件自动索引或音视频导出。

脚本模板仅含可编辑标题；分镜 JSON 为版本化空镜头列表，不包含虚假制作结果。采用新目录时生成模板；从已有目录创建时只补缺失项，保留已有内容，不搬移原文件。普通“打开项目”只识别有效 manifest，不悄悄初始化陌生目录。未来版本 manifest 拒绝写入，不降级。初始化中断可重新打开续接；利用固定初始化 commandId 避免重复数据库 project。

目录操作仅由 main 在用户系统目录选择/已保存最近项目中执行；校验绝对本地路径、目录内保留路径、类型冲突及链接。不得沿保留子路径的符号链接/junction 写出项目边界。不得覆盖已有 manifest、同名文件或删除用户数据。新建时选择父目录并输入项目名；已有文件夹创建使用选定目录本身。

## 最近项目与隔离

启动器显示最近项目名称、目录和可用状态，提供新建、从已有文件夹创建、打开项目、打开旧版资料库。最近项目按 workspaceId/canonical root 去重，丢失目录可重新定位。相同项目目录再次打开聚焦已有工作台。不同短剧允许分别打开窗口；库、任务、凭据引用与 outbox 不能串用。

最近项目界面显示最近 50 条；内部注册表保留最多 10000 条身份记录，文件上限 4 MiB。隐藏的旧记录仍参与相同 workspaceId 的复制冲突检查，不自动驱逐身份；达到记录数或文件大小上限时明确报错并保留原索引。全局启动器是注册表唯一写者，项目工作台只读核对；正常命令行打开项目也需经过启动器登记。启动器负责单写者进程约束，注册表自身只串行化同一进程内的原子写入，不声称支持多个工作台并发写同一 JSON。

项目 profile 位于启动器用户数据目录的 `directory-workspaces/<workspaceId>`，不放入短剧目录。目录搬走且旧目录确实不存在时，可保留同 workspaceId/profile 重新定位；发现两个存在目录声称同一 workspaceId 时拒绝自动当成两个独立项目，防止复制了待执行任务后重复调度。注册表/manifest 不含 Key。

## 可编辑模型配置

按用户后续纠正，本机模型配置存放在软件项目内部的 `D:/movieAgent/libtv-studio/config/models.json`；`D:/movieAgent/启动MovieAgent.cmd` 明确传入该配置路径。旧外层配置仅保留备份，新位置已有文件优先，不覆盖用户内容。实际 `config/` 不提交 Git，空值模板保留在 `configs/models.example.json`。安装程序其他位置默认使用其启动器用户数据目录中的 models.json，UI 显示当前实际路径；显式配置路径可在启动器本地设置中记住，并传递给所启动项目。路径不能来自短剧项目 manifest。已有配置文件不覆盖，不打印其内容。

后续模型配置页面应通过主进程统一读写这份软件全局配置，Key 保留或替换且不回显；各短剧引用导入后的版本。当前页面的连接/模型/预设编辑仍只写资料库版本，文件到资料库是单向导入，双向页面保存尚未实现，不能宣称已经统一。

配置格式：

```json
{
  "schemaVersion": 1,
  "providers": [
    {
      "id": "image-default",
      "name": "默认图像服务",
      "kind": "image",
      "baseURL": "",
      "apiKey": "",
      "modelId": "",
      "allowPrivateEndpoint": false
    }
  ]
}
```

支持当前已有 openai-image-v1 单图协议；不把任意填入的服务或视频/文本模型声称兼容。全部空的条目为未配置，不妨碍打开/编辑项目；部分填写或非法字段产生可操作但不包含字段值的错误。支持 UTF-8 BOM，文件最多64KiB，条目最多8个，id去重。私网需显式 allowPrivateEndpoint=true，再按实际 host/port 构造既有精确授权；公共明文 HTTP 仍拒绝。

main 读取配置，校验全部条目后，在选定工作区生成/更新 file-owned connection、model、profile；Key 只经过 main 的 vault，普通 IPC、renderer、业务数据库、manifest、日志无 Key。用户要求的原配置文件仍在项目外保留，可直接编辑，不擅自删除。对应空白 example 可进 Git，实际 models.json 不进仓库。受控 vault 不可用时明确报导入失败，不静默明文降级。

重复导入相同配置不新增修订/凭据；变化新增不可变修订，保留正在运行任务引用的旧凭据。使用稳定 file-owned ID，不覆盖用户手工配置项。通过已有命令/receipt及 vault/status 顺序更新，不直接用 main 写业务 SQL。工作台显示配置文件来源/状态，并有“重新载入配置”；配置或启动本身不发 HTTP 测试、不新建生成任务。现有历史批准任务的正常恢复语义保持，但本次最终展示使用新建空项目或仅启动器。

## 验收

1. 本机启动到最近项目界面，不启动默认库或付费调度；本机配置空白可运行。
2. 新建目录、已有素材目录初始化、打开/重开、搬移重新定位、双项目隔离、重复打开、初始化中断和异常路径均有真实文件/SQLite或打包测试。
3. 模拟 Key 通过配置导入后，provider/model/profile 可见、Key 在工作台/业务库/注册表/manifest/错误中不可见；重复/修改配置与私网策略测试；零网络调用。
4. 打包实际启动器→项目工作台、保存画布、退出重开，原文件不变；三个窗口/预加载职责独立，原P1回归保持。
5. 最终重新构建本机可运行包，创建不覆盖用户内容的配置与启动脚本，实际启动到可见启动器供用户使用。真实模型接入仍等用户填写后有限验证。
