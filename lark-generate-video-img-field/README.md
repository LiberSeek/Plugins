# 生成视频 img 字段捷径

飞书多维表 FaaS 字段捷径插件，基于图片字段捷径改造成视频生成版本：按行读取提示词与参考图片，调用异步视频生成链路，最终把视频直链作为附件结果回填。

## 当前定位

- 输出类型仍是 `FieldType.Attachment`。
- 当前目标不是上传飞书视频二进制，而是直接回传视频 URL。
- 配置面板按视频语义提供模型、提示词、参考图片、分辨率、时长、自定义 Base URL。
- 参考链路来自 `Seedance / Happyhorse` 的异步视频生成方案。

## 生成链路说明

本插件准备替换原来的 `image/gen...`、`image/edits` 图像接口，改为视频任务接口：

- `Happyhorse`
  - 提交：`POST /v1/videos/generations`
  - 轮询：`GET /v1/tasks/{taskId}`
  - 典型模型：
    - `qwen/happyhorse-1.0-i2v`
    - `qwen/happyhorse-1.0-t2v`
- `Seedance`
  - 提交：`POST /api/saas/plugin-u/v1/exec/Multimodal-live-video`
  - 轮询：`POST /api/saas/plugin-u/v1/exec/query-task`
  - 典型模型：
    - `Doubao-Seedance-2.0`

设计约束：

- 如果选择 `i2v`，会使用参考图片作为首帧或图生视频输入。
- 如果选择 `t2v`，则参考图片可为空。
- 插件在任务成功后直接返回 `video_url`，不再要求填写飞书 `App ID / App Secret / App Token` 做二进制上传。

## 字段配置

- `模型`
  - 默认 `qwen/happyhorse-1.0-i2v`
  - 同时暴露 `qwen/happyhorse-1.0-t2v` 与 `Doubao-Seedance-2.0`
- `提示词`
  - 支持多维表字段引用
- `参考图片`
  - 附件字段，多图可选
- `分辨率`
  - `480P / 720P / 1080P`
- `时长`
  - `5 / 10 / 15 秒`
- `自定义 Base URL`
  - Happyhorse 默认 `https://model-router.edu-aliyun.com/v1`
  - Seedance 默认 `https://agentrs.jd.com`

## 开发

```bash
npm install
npm test
npm run typecheck
npm run build
npm run pack
```

本地调试授权在 `config.json` 中配置。可以先复制示例文件：

```bash
cp config.example.json config.json
```

然后把 `config.json` 中的占位 token 改成自己的视频网关 Key：

```json
{
  "authorizations": [
    "sk-video-local-debug-token"
  ]
}
```

## 验收建议

- 纯提示词走 `t2v` 成功返回视频 URL。
- 单张参考图走 `i2v` 成功返回视频 URL。
- 自定义 `Base URL` 指向 Happyhorse 兼容网关时可以正常提交与轮询。
- Seedance 模型可以完成提交、轮询、读取 `content[].video_url.url`。
- 线上字段创建面板展示「生成范围」和「自动更新」，避免整列误触发。

## 注意事项

- `自定义 Base URL` 只能使用已经写入 `basekit.addDomainList` 的域名；新增域名时需要先加入白名单后再发布。
- `i2v` 对首帧图非常敏感，参考图片与提示词不一致时，结果通常更接近首帧图。
- Seedance 实际返回的视频时长可能与提示词中的理想时长不同，需要以后端返回值为准。
