# 当前方向：只从 GetLayers 选择灵感与素材

2026-10-24，用户明确纠正：V2 依靠指定图片形成视觉，不满足更换用户素材后的稳定设计；要求从 GetLayers 选现成动态设计来改。随后明确不转向 React Bits。

## 来源与使用位置

1. **AI Studio，主参考**：https://www.getlayers.ai/layer/ai-studio
   官方描述与已查看预览包括旋转铬金属主体、紫色光场、漂浮粒子和镜头穿越。用于入口、项目进入与 Agent 空间的统一动态语言。固定品牌场景和用户媒体内容分层；用户图片不参与决定界面材质和背景。
2. **Shader Backgrounds，背景获取入口**：https://www.getlayers.ai/tools/shader-backgrounds
   官方说明支持实时调整预设，并导出 shader 代码、独立 HTML 或重建提示词。下一步先取得官方导出，再做空白工作台验证；不能仅以宣传截图作为已运行证据。
3. **Mirror Hall，局部资产浏览候选**：https://www.getlayers.ai/layer/mirror-hall
   旋转环形卡片、惯性拖动、反射平面。仅作为可选浏览视图的参考，不让整个工作台依赖卡片中的具体图片。
4. **Vesper，整套备选**：https://www.getlayers.ai/layer/vesper
   官方描述为粒子球、星系与大脑形态的连续变化。若 AI Studio 不适合长时间工作，可比较此方向；本次未成功完成 Vesper 的实时预览验证，不把描述当作本机运行结果。

## 已知取得方式

依据 https://www.getlayers.ai/docs ：完整模板源码通过 Full Stack 下载，公开提示词与原版源码不是同一种交付。当前 AI Studio 页面显示未登录及锁定下载；尚未取得模板源码。Shader Backgrounds 的官方页面明确列出导出能力，实际导出尚待验证。

本次浏览器在页面切换和输入时多次超时，之后新网页未能附着；没有绕过登录、付费或导出限制，也没有抓取受限源文件。已向用户询问是否有 Full Stack 或已下载源码，尚未收到回复。

## 改造验收

- 先运行原版背景或模板，保留可核对来源与许可。
- 先用完全空白素材状态检验背景、导航、面板和过渡。
- 再换入明暗、横竖、普通内容混合的用户素材；容器、视觉层级与主要动效保持稳定。
- Image Gen 只替换内容槽位，不承担界面本身的动态视觉。
- 提供实际动画预览；将模拟任务、真实模型和 Electron 完成状态分别标明。

## 被替代的工作

`prototypes/motion-v2` 仍保留为旧版。`prototypes/motion-v3` 中 React Bits 方向已暂停，未构建验证，不作为当前交付或待集成方案。完整 LibTV 自配置模型、Electron、本机引擎与远程服务目标不变。
