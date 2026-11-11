# P4 媒体与音频接口技术核对

核对日期2026-10-27。只读查阅公开的一手资料和本地代码；没有下载/运行候选运行时、调用音频模型或检查用户凭据。以下是制定方案的依据，不是兼容服务实测证据。

## Windows 媒体运行时

FFmpeg官方网站只发布源码，Windows下载页指向第三方构建发行者。Gyan当前固定release9.0.2，候选 `ffmpeg-9.0.2-essentials_build.zip`，发布者声明Windows10+、x64、静态GPLv3；essentials列出libx264、libass、FreeType、FriBidi、HarfBuzz。[FFmpeg下载](https://ffmpeg.org/download.html)、[Gyan构建说明](https://www.gyan.dev/ffmpeg/builds/)、[固定release](https://github.com/GyanD/codexffmpeg/releases/tag/9.0.2)。

发布者的[版本化摘要](https://www.gyan.dev/ffmpeg/builds/packages/ffmpeg-9.0.2-essentials_build.zip.sha256)为 `60f467265b1e312373dbcd92200c2618a74850f98d3d078e94296bb3fa2047ba`。本次只读取摘要，**未下载验算**。实施须保存版本化URL、归档和每个EXE的实测hash、`-version/-buildconf/-L`、编码/filter能力探针；不得把在线摘要当作已经验证的本机产物。

仓库使用Electron45.0.0、electron-builder26.18.0，资源配置采用现有v26的 `extraResources` 语法；包内ffmpeg.dll不是CLI。安装包须附带两个EXE、固定字体、manifest和许可资料，从resourcesPath定位，不靠系统PATH。[electron-builder v26](https://www.electron.build/v26/docs/contents/)

Gyan所选构建包含GPL组件，不能按LGPL-only包处理。应保存对应版权、许可证、构建配置，以及FFmpeg和静态链接依赖的对应源码/构建材料取得方式；仅一个FFmpeg commit链接不足以证明材料齐全。独立进程不能自动推导为应用许可豁免。公开分发是独立核查门槛；此处不作法律结论。[FFmpeg许可说明](https://ffmpeg.org/legal.html)、[外部库许可](https://ffmpeg.org/doxygen/trunk/md_LICENSE.html)、[GNU聚合说明](https://www.gnu.org/licenses/gpl-faq.en.html#MereAggregation)

## 字体、时间与进程

字体候选为Noto Sans CJK SC Regular、Sans2.004静态OTF，保持原字体并附OFL。固定版本避免依赖系统字体或未经验证的变量字体路径。[固定字体](https://github.com/notofonts/noto-cjk/blob/Sans2.004/Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Regular.otf)、[OFL](https://github.com/notofonts/noto-cjk/blob/Sans2.004/LICENSE)

`fontsdir`会补充font provider的字体，不能独占字体查找。应固定family/hash、检查覆盖和实际font选择。`trim/atrim`不自动归零时间戳，`fps`按PTS丢/补帧；分别对音视频使用 `PTS-STARTPTS` 会破坏本来不同的起点。选择共同asset origin并保留跨流offset；24/25/30fps与48kHz timebase恰好整除。自动旋转与手工display matrix变换只能选一条路径，改颜色标签也不等于颜色转换。[FFmpeg滤镜](https://ffmpeg.org/ffmpeg-filters.html)

ffprobe输出采用JSON字段白名单；探测通过不代表完整可解码，read_intervals也不是帧精确seek保证。进度用 `-progress pipe:1`；退出0后仍完整解码校验。每个输入显式protocol_whitelist/format_whitelist/max_streams；file协议仍可访问本地文件，不是OS沙箱。限定输入归属、格式、流、像素、时长和资源，不接收任意filtergraph。[ffprobe](https://ffmpeg.org/ffprobe.html)、[CLI](https://ffmpeg.org/ffmpeg.html)、[协议](https://ffmpeg.org/ffmpeg-protocols.html)、[格式](https://ffmpeg.org/ffmpeg-formats.html)

## 可配置音频接口

TTS最小路径 `POST /v1/audio/speech`，JSON model/input/voice和显式WAV或MP3响应。OpenAI当前文档上限4096字符，速度0.25–4；方案保守限制4000字符、0.5–2，速度等可选字段需实际能力支持，不普遍发送instructions。[Speech reference](https://developers.openai.com/api/reference/resources/audio/subresources/speech/methods/create)

ASR最小路径 `POST /v1/audio/transcriptions`，multipart上传真实文件和model，带正确文件名/MIME；最小输出 `{text}`。官方上传指南列出25MB，因此产品保守上限为**24,000,000字节**而不是24MiB。超限不暗中多次分片计费。[转写指南](https://developers.openai.com/api/docs/guides/speech-to-text)、[API reference](https://developers.openai.com/api/reference/resources/audio/subresources/transcriptions/methods/create)

截至核对日，官方转写选型页推荐新接入使用gpt-transcribe，并将whisper-1、旧gpt-4o转写系列及audio/translations列为退役中，关闭日期2027-02-26。新模型使用languages数组，旧模型可能用language；换modelID不保证保留原时间戳能力。因此本产品不硬编码这些ID，默认省略可选语言和格式字段；能力测试确定后才使用相应参数。带时间戳的segment/word响应是单独能力，只有文本时形成待校时稿。[当前选型指南](https://developers.openai.com/api/docs/guides/transcription)

模型列表只辅助填写ID，不提供完整音频能力schema；voice、返回格式、时间戳和额度均要另验。同步POST超时也可能已经计费，没有查询或幂等契约时不自动重发；停止本地任务不能声称云端已取消。[Models API](https://developers.openai.com/api/reference/resources/models/methods/list)
