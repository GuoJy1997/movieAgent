# 短剧项目模板 v1

运行时模板位于 `apps/desktop/src/main/drama-template.ts`，随主进程打包；不读取工作目录、开发机路径或这些示例文件。这里保留可编辑的创作文档示例。调整模板时同步修改 TypeScript 模板和示例；不兼容变动需要新 templateVersion。

共享接口为 `packages/contracts/src/directory-projects.ts`：清单固定 format=movieagent.project、schemaVersion=1、templateVersion=1，含 workspaceId、name、createdAt、binding（初始 null）。首次引擎初始化后写入 libraryId/projectId 绑定；模板本身不建立数据库。

默认目录：scripts/episodes、storyboards、assets/characters、assets/scenes、assets/props、assets/imports、shots/episode-001、audio/voice、audio/music、audio/sfx、exports、.movieagent/library。空目录由代码创建，不需要占位文件。分镜示例只有版本号和空 shots 列表。

新建时 directory 是父目录，name 是安全的子目录名称；从已有目录创建时 directory 是项目根目录。只补缺失模板项，已有文件不覆盖。manifest 在模板填充前发布，因此中断后可用同一 workspaceId 续接。普通 inspect 只读，绝不初始化未知文件夹。
