# 微信视频号内容处理

## 流程

1. 接收 `object_id`、`export_id` 或 `share_url`，优先级为 `object_id > export_id > share_url`。
2. 通过服务端的视频详情适配器获取元数据，建议使用精简响应，超时至少 30 秒。
3. 64 位作品 ID 全程按字符串传递，禁止经过 JavaScript `Number`。
4. 使用同一次响应中的 `media.full_url`（或 `url + url_token`）下载加密媒体，并用同一次响应的 `decode_key` 解密。
5. 解密后优先使用本地 faster-whisper 转写；无语音时抽帧并识别画面字幕。
6. 输出标题、作者、发布时间、互动数据、来源链接、转写文本和处理状态，隐藏 API Key、CDN token 和解密密钥。

## 配置

```text
VIDEO_DETAIL_PROVIDER_KEY=仅放在本机或云函数环境变量
VIDEO_DETAIL_PROVIDER_URL=仅放在服务端配置，不写入小程序或公开文档
WHISPER_MODEL=small
```

不把密钥写入小程序前端、Markdown 示例、日志或提交记录。视频内容也应遵守版权、隐私和平台条款，只处理用户有权使用的内容。

## 参考实现

优先复用 `wechat-latest-video-transcriber` Skill 的 `process_wechat_video.py` 和 `derive_keystream.js`，本工作台只负责业务编排和安全的详情获取。解密原理可参考公开的微信视频文件解密项目，但不要复制其密钥或用户数据。
