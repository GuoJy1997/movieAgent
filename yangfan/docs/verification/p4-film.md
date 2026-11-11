# P4 成片工程验收 · 2026-10-29

精确发行目录：`apps/desktop/release-p4/win-unpacked`。独立安装包：`apps/desktop/release-p4/MovieAgent-0.1.0-local-test-Setup.exe`。这是未签名、仅供本机私用的工程版本；真实音色、方言、口型和公开发行分别未验。最终独立审阅与外层启动入口切换由控制器完成。

## 源码与发行身份

Git HEAD仍为`10250b71f6ff23a076fd2267c89123241e8bec93`，不能代表本轮未提交源码。交付包含明确清单的累计源码覆盖层、Task8相对起点快照、SHA256和原始测试日志；不包含真实模型配置或用户项目。

| 文件 | SHA256 |
| --- | --- |
| MovieAgent.exe | 6d3de8dd5619fcd3e6731fc759fe731e0865b04495950cfda5e41ad4f5e8ab75 |
| resources/app.asar | a308b5a847bfb2b5d9d7f7aad4b51d598aad53da359121e6e8b66e93e62a4c5f |
| NSIS Setup.exe（200200885字节） | e497e16e628671e908833b58097ab4e6502f4ef116c715d130bf00678e7ece19 |
| FFmpeg 9.0.2 | 3256173f3f8bffd7df12227c68adf68025edb1832273a9530688a7bb1ed8edec |
| FFprobe 9.0.2 | f0d36ecbbdd3bcfac3efa078c96c7271c2e68b3810595552ac3b7f17e9a65c52 |
| NotoSansCJKsc-Regular.otf | 2c76254f6fc379fddfce0a7e84fb5385bb135d3e399294f6eeb6680d0365b74b |

安装布局运行时hash为`50c3f76c0610c5c4a97bd9e8e6620f39f548a45637b16de3733a5fde10ec6539`。精确包验证Electron45.0.0、Node24.22.0、ABI150、x64及SQLite3.53.4/Sharp原生调用，四个隔离preload与CSP入口通过。

## 已执行范围

原始stdout/stderr、命令与EXIT保存在`.superpowers/sdd/2026-10-27-p4-audio-timeline/task-8-*`，最终副本在交付archive/evidence。重跑有重叠，以下数量不可相加为唯一测试总数。

| 检查 | 实际结果 |
| --- | --- |
| schema14/19/22真实旧表逐级迁移23 | 3通过；旧行、模型配置、TaskRef、对象字节和升级前备份保持 |
| 独立旁白公共命令 | RED2→GREEN2；真实本地HTTP TTS、审核、音轨采用、同字节别名、撤销恢复、重开和过期来源 |
| 独立旁白mounted界面 | RED2→GREEN2；原角色声音界面5通过 |
| 完整core一次，maxWorkers2 | 85文件734例，732通过2失败；两个旧fixture修正后受影响2文件7通过 |
| 串行原生媒体 | 11文件25通过1跳过；跳过唯一600秒用例，保留Task4既有真实600秒证据 |
| 串行renderer一次 | 16文件79例，74通过5冷启动失败；只修fixture首个浏览器导航预热，受影响5文件27通过 |
| H3/Sync实际收存提交修复 | RED2→GREEN2；既有image/minimax/recovery依赖3文件66通过 |
| 同步对白拒绝与outbox恢复 | 原缺陷RED2→command-delivery24通过；扩大同类审计后2文件30通过，私有批次授权再RED→GREEN1；代表12种实际handler拒绝及持久化重开 |
| 类型检查 | 显式`-p tsconfig.base.json`的typecheck-freeze通过；一次漏配置命令仅打印帮助，保留原记录 |
| build、NSIS、包验证、安装布局媒体验证 | 最终freeze构建、NSIS、包验证、安装布局媒体验证全部EXIT0 |

Task8发现的重要集成缺陷：H3/Sync视频输出已落盘，但旧ProviderVerification映射/校验不接受它们，提交事务回滚为GENERATION_COMMIT_FAILED。现在共享严格映射H3→textToVideo、Sync→lipSync，均使用provider-task-id核对；读、写和安全查询一致，未伪造质量通过状态。修复后重建精确包。

## 精确包连续工程场景

使用自有临时项目`movieagent-p4-owned-KXdXbW/自有验收项目`、dummy凭据和本地HTTP，不打开用户库。完整场景`tests/electron/p4-film.test.ts`的第4次执行已完成生成、编辑、预览及最终渲染；在导出fixture创建阻挡文件时停止。随后同项目的`p4-film-continuation.test.ts`检查原task/take/review、时间线、输出对象hash，并在asar `fc74f70c…cde9d48`完成导出、解码、UNKNOWN与重开。该阶段未重新执行生成/渲染，且未保留更早asar `1ecf89ce…995b80bb`的engine/compiler精确身份，不能证明跨包实现相同，也不能称为一次从零全绿。R5修复使用最终修复包重新执行限定的H3、Sync成功发布及新渲染，详见下方记录。

第4次场景完成：两角色各三情绪及组合试镜共7次，正式H3两次；固定音频公开确认、起点0和1秒真实PCM对齐（10秒、480000采样，前后静音与信号已断言）；手工修正版与一次真实Sync提交/查询/收存；逐take四维工程标记；选择CAS冲突；真实AudioTake旁白及每输出三项审核；本地TTS/ASR和手改文本；三镜头粗剪、独立旁白/BGM、中文三字幕、分割成4cut、移位复原、并发保存CAS、未保存草稿取消导航、播放器时间实际推进、本机活动渲染取消、最终30秒MP4/WAV。

H3/Sync POST及已知ID GET经过精确包utility→main→本地HTTP，记录真实headers和次数。仅远程视频响应文件下载由测试预置的自有不可变spool字节替代，响应content hash与预置字节核对；正常收存、探测、技术验证及take发布仍执行。没有生产网络白名单或测试开关。此fixture不证明远程CDN下载或真人质量。

样片及截图保留在`test-results/p4-film`。连续验收最终核对MP4/WAV/SRT/CSV/原件ZIP、目录复制失败后同请求重试、无新增渲染、逐cut色彩/中文字幕白像素、FFmpeg全流解码、1080p/30秒、PCM音量、未知Sync断链及重开后零自动POST。真人听感、嘴形、方言判断不在这些合成图像/正弦波断言内。

## 未验证边界

2026-10-29最终修复R1–R5：保留同媒体兄弟片段时，新旁白插入/替换/恢复仍验证当前审核；普通已回收历史素材可恢复；两个旁白审核入口复用草稿保存/放弃/取消协议；旧声音修订的明确拒绝不再堵塞outbox。针对性结果：旁白/历史4通过，时间线依赖22通过，mounted审核4通过，命令恢复30通过另加真实旧修订持久化1通过；数量有重叠，不累计。最终类型检查、构建、NSIS、包/运行时检查全部EXIT0。

`final-fix-packaged-check`先成功发布H3，再因旧UNKNOWN占满Sync连接的并发1而停止（QUEUED/unsubmitted/CONCURRENCY_LIMIT，无Sync POST）。按Ruling46，`final-fix-packaged-continuation`在同一精确包/项目复核原H3身份，只公开停止新未提交批次；新增独立dummy本地Sync连接后正常准备/审批/提交/查询/收存，原UNKNOWN状态保持。续行1例通过（EXIT0，19.95秒），两阶段总计H3/Sync各1次POST，两个会话正常退出、强制清理0。没有重做七次试镜。

最终包重新创建渲染作业`df0a528f-3c3e-4e82-b7c5-e1ae1d978d0d`，消费原r7固定四cut时间线；实际新编码后完整视频/音频解码为30秒、1920×1080、30fps/900帧。新输出SHA256仍为`a1750dc765cbc4fd1731a0bf2676600895d9f53ce11bf71b7309f3a50b1143d1`，相同字节不替代新作业/开始结束记录。样片及新截图在`test-results/p4-final-fix`；精确21个build/138个发行文件身份与累计源码清单在`final-fix-*`记录。新档案为`deliveries/2026-10-29-p4-reviewed`，旧档案保留。初次独立审阅的5项Important已完成修复，范围复审及外层入口仍待控制器决定。

早期连续验收`task-8-packaged-continuation-5`通过（1例，EXIT0，11.39秒）。原生成/渲染包asar为`1ecf89ce5e8a087330c1bd7ce9c62cdd6bee912d15d91d082f2963ed995b80bb`；恢复修复包`fc74f70c2ae44fe7d9a02b9499292333a5a13c6c9747a65924aa9eb33cde9d48`正常恢复原待确认命令，继续既有输出的导出/解码/UNKNOWN/重开，未重做生成/渲染。两包运行时/字体相同已知，engine/compiler精确连续性无证据。先前“首个CDP上下文”猜测被推翻，原失败记录保留。

最终MP4为30秒、1920×1080、30fps/900帧，SHA256 `a1750dc765cbc4fd1731a0bf2676600895d9f53ce11bf71b7309f3a50b1143d1`。WAV全流解码确认30秒48kHz双声道；ZIP7条目及6个固定来源CRC/hash/大小校验通过。编辑代理在本场景从未准备，重开页面明确提示缺少代理；已通过的是正式渲染预览播放器推进与最终文件解码，不宣称重开即可播放编辑代理。

- 公共GPL对应源码及完整构建材料尚未组装，`publicDistributionReady=false`。字体OFL与本机运行资料已随运行时附带。
- 未在无系统FFmpeg/额外字体的干净Windows或独立非管理员账户安装；中文临时项目路径实测，中文安装路径未验。安装包已构建，未以开发机运行代替安装验收。
- 真实H3音色、山东话、三情绪表演和Sync口型未验。历史已授权MiniMax单次TTS/ASR记录单列，未重复付费调用。
- 相同字节TTS历史使用保守的全匹配审核策略，可能拒绝来源不同但字节完全相同的合法结果；按Ruling45保留为非阻塞可用性限制。
- 失败会话的强制清理：journey3仅对已核对root/命令行的child与launcher两个PID执行Stop-Process；continuation2/3各对捕获的一个child执行kill，共4个显式进程目标。journey1使用CDP关测试窗口。第4次正常teardown通过；强制清理不计入优雅退出证据。
