# MovieAgent 完整 UI 重构图册
日期：2026-11-03。由内置 ImageGen 生成。
当前版本使用纯白、中性浅灰、墨色与少量蓝色，替代上一轮被否决的暖色背景草稿。

打开 index.html 可按顺序浏览、点击放大、用左右方向键翻页。所有 PNG 都是独立完整页面，可直接打开。
本轮是视觉设计交付，没有修改产品源码。静态图不包含真实动画；动画触发、时长及减少动态效果规则见 design-notes.md。

## 页面覆盖
- 01 · 项目启动器与维护 — 01-launcher.png
- 02 · 项目资料库 — 02-projects.png
- 03 · 分集与连续创作 — 03-episodes.png
- 04 · 自由制作画布 — 04-canvas.png
- 05 · 创作 Agent 与提案 — 05-agent.png
- 06 · 剧本与分镜 — 06-storyboard.png
- 07 · 镜头生产与结果 — 07-production.png
- 08 · 对白与口型审核 — 08-dialogue.png
- 09 · 角色场景资料 — 09-entities.png
- 10 · 角色声音工作室 — 10-voice.png
- 11 · 项目资产库 — 11-assets.png
- 12 · 剪辑成片工作台 — 12-timeline.png
- 13 · 声音与字幕编辑 — 13-audio-subtitles.png
- 14 · 导出与制品交付 — 14-export.png
- 15 · 项目任务中心 — 15-tasks.png
- 16 · 模型设置与凭据窗口 — 16-models.png
- 17 · 外部 Agent 接入 — 17-mcp.png
- 18 · 独立软件模型配置 — 18-global-config.png

## 配套资料
- design-notes.md：导航重构、组件规则、18页功能映射与动效分镜。
- prompts.json / prompt-revisions.json：完整提示词、后续修订及参考图路径。
- manifest.json：最终图片与原始生成文件对应关系。
- references/：用户提供的参考图、实际访问的导航与LibTV参考截图。

## 状态
覆盖当前十个主导航入口、启动器、独立模型与凭据窗口，以及对白、角色声音、导出等主要子工作区。此处“完整”指上述页面覆盖；没有为每种加载、报错或二级弹窗都单独出图。
图中人物、项目、费用、路径、日期和任务状态均为示例；布局与交互结构是重构建议。实施时逐项对照已有规格和实际业务契约，不把图中示例内容当成真实运行结果。
MCP外部接入图仅表达图片导入及素材复用，未声称未实现的外部自动剪辑/导出已可用。

## 实际参考
- X帖子：https://x.com/realxmanas/status/2115857530543054856 （正文已读取，视频未能播放）
- Inspora：https://www.inspora.design/
- Landbook：https://land-book.com/
- Prestige UI导航：https://prestigeui.com/components/navbar （已操作胶囊导航切换，未测实际动画时长）
- Elaya：https://elaya.design/
- LibTV：https://www.liblib.tv/ （已查看官网主体中性黑灰；本方案浅色外壳为本项目设计选择）

