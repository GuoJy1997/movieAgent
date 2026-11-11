# P4 MiniMax 音频最小实测

日期：2026-10-27。用户授权使用之前配置的Base URL和Key。测试使用已保存的MiniMax订阅Key；没有写入或展示凭据，没有切换按量Key，没有自动重试。

- Origin：`https://api.minimax.cn`。
- TTS：`speech-2.8-hd`，`POST /v1/t2a_v2`；文本“你好，这是短剧配音测试。”；HTTP200、base_resp.status_code=0；MP3 50,676字节、3.06秒；SHA256 `a634a782ff5c20168f867b1afac86b20315c35a17bd3a3d10a06982c426680ee`。
- ASR：`asr-1.0`，`POST /v1/speech_to_text`，输入上述MP3，verbose_json/句段时间戳；HTTP200；全文一致；S1，起止0.16–2.82秒，总时长3.06秒。
- 计数：各1次。实际账单或套餐额度扣减未核实。测试仅证明这两个接口在此次配置下可用，不能证明P4产品接入、长期可用性、方言/音色/口型质量。
- TTS 返回 `usage_characters=22`。同日核对[官方计价说明](https://platform.minimax.cn/docs/pricing/overview)：汉字按2个单位计，字母、标点、空格等按1个单位计，与本句12个 Unicode 字符、22个计费单位一致。该单位规则用于配置单价后的本地估算，不能据此推算 Token Plan 实际额度扣减。
- 脱敏原始记录与样音：`D:/movieAgent/verification/p4-minimax-audio-20261027-2233e666/`。

官方协议：[TTS](https://platform.minimax.cn/docs/api-reference/speech-t2a-http)、[ASR](https://platform.minimax.cn/docs/api-reference/speech-to-text)。ASR供应商上限500秒，产品通用上限600秒，接入时取较严格值；模型列表未列出音频模型不等于不可调用。
