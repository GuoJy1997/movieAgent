# P4 角色声音与口型接口核对

核对日期：2026-10-27。公开官方资料＋现有源码只读检查；未调用真实生成，未读取用户Key/配置/素材。本文是设计依据，不是服务质量或当前应用能力的验收报告。

## 当前代码

- `packages/providers/src/minimax-video.ts` 的 `MiniMaxVideoAdapter`，adapterId为 `minimax-video-v2`，已有V2视频提交，但body只有text/image_url；参数仅duration/resolution/ratio。没有音频参考。
- `generation.ts` 的参考类型只有图片，最多4张、每张10MiB、合计32MiB；`reference-inputs.ts`验证hash。新增音频必须贯穿contracts、prepared hash、任务快照、transport和收存。
- `creationFor.selectOutput`在外部事务里检查shotRevision/selectionRevision并写历史；新对白产物必须复用，不创建第二个镜头选择事实源。
- 角色与镜头文件为renderer `features/entities/EntityWorkspace.tsx`、`features/creation/{CreationWorkspace,ShotProductionPanel,CreationFields}.tsx`。dialogue/sound目前是字符串，不能自动得到逐句角色绑定。

## H3：声音参考，不是固定音轨口型服务

官方[视频API](https://platform.minimax.io/docs/api-reference/video-generation-v2-create)与[完整Markdown/OpenAPI](https://platform.minimax.io/docs/api-reference/video-generation-v2-create.md)确认：Bearer，POST `/v2/video_generation`，content含text与reference_image/reference_audio；图像首尾帧不能与reference角色混用。标准H3为4–15秒，声音≤3段、每段2–15秒、合计≤15秒、WAV/MP3，每文件≤15MB。

本次通过Node fetch读取完整OpenAPI的 `audio_url.properties.url.description`，确认允许公开URL、`mm_file://{file_id}`、`data:audio/<format>;base64,...`。本产品选固定WAV data URI；图片沿用data URI。官方请求体≤64MB，产品采用更小的48,000,000字节编码后上限、4张参考图和32MiB总原始输入。不能把文件大小当成Base64请求大小。

提交返回task_id；[查询](https://platform.minimax.io/docs/api-reference/video-generation-v2-query)为GET `/v2/query/video_generation/{task_id}`，读取task.status与task.content.url。queued/running/succeeded/failed/cancelled分别映射现有状态；文档查询最近7天任务，超期不能靠再次生成恢复文件。无已核实生成幂等契约时，未知提交不重发。

[官方发布说明](https://www.minimax.io/blog/minimax-h3)展示人物图像、镜头视频和声音参考组合；没有给出“整部短剧音色零漂移”或山东话专项质量承诺。模型中文支持与声音参考不能替代方言人工验收。

## MiniMax Speech：已有音色配音

[HTTP TTS](https://platform.minimax.io/docs/api-reference/speech-t2a-http)：POST `/v1/t2a_v2`，Bearer；model、text、stream:false、voice_setting.voice_id、output_format:hex。先检查base_resp.status_code为0及有效data.audio，再校验hex、解码、探测并收存；null data/异常hex不是成功。配置mp3输出；不把JSON当二进制audio响应，沿用本地TTS4000字符和16条批次限制。

[声音克隆](https://platform.minimax.io/docs/api-reference/voice-cloning-clone)是另一个接口，能创建voice_id；本期只消费已有ID，不开发克隆账户/训练流程。语言枚举不能证明山东话稳定可用。voice_id只属于对应服务账户，切换连接/凭据后需要重新验证。

## Sync：固定音轨口型修正

[本地文件生成](https://sync.so/docs/api-reference/api/generate-api/create-with-files)确认：POST `/v2/generate`，x-api-key，multipart的video/audio/model，options需JSON字符串；客户端生成boundary。首次201返回id，重放可能200。模型可配置，建议初始选择支持视频＋音频的lipsync-2，实际账户先测试；不是不可变默认。

[状态查询](https://sync.so/docs/api-reference/api/generate-api/get)：GET `/v2/generate/{id}`；PENDING/PROCESSING/COMPLETED/FAILED/REJECTED，成功outputUrl/outputDuration。结果必须经过本地文件校验及人工嘴形审核。[模式](https://sync.so/docs/developer-guides/sync-mode)的cut_off取较短时长、loop循环、remap改变视频速度。本期先生成等长输入再用cut_off，不隐式变速/截台词。

[幂等说明](https://sync.so/docs/api-reference/guides/idempotency)：首次即带持久Idempotency-Key，重试同键同载荷；multipart按文件字节/MIME/扩展名比较，boundary可不同。201与200原ID区别于新生成；409冲突/进行中、503结果未知不能换键绕过。保留至少7天，应用保守只允许7天内显式核对原提交，未知仍保持待核对。

[官方SDK说明](https://sync.so/docs/developer-guides/sdk-python)说明运行中任务不能取消；本地停止不保证停算/停费。本期不实现自动上传资产库、自动删除远端资产、webhook公开端口或Sync内置TTS，避免一个口型任务暗中增加第二次语音生成。

## 能力测试与费用

协议fixture验证字段、状态和请求次数；真实连通测试需用户明确连接和额度。H3音频参考、TTS配音、Sync口型分别有测试证据，Model ID列表不是能力证明。当前价格、配额、实际账单均未核验，计划不预填单价。真实质量样片和收费以执行时配置为准。
