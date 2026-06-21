# 上架提交信息

## 基础信息

- 插件名称：生成视频 img
- 插件类型：飞书多维表字段捷径 FaaS 插件
- 字段结果类型：附件
- 一句话介绍：在多维表中调用异步视频生成模型，将提示词和参考图生成的视频直链写回附件字段。

## 上传材料

- 打包产物：`output/output_5_29_2026__7_20_47_PM.zip`
- 图标 SVG：`assets/icon.svg`
- 图标 PNG：`assets/icon.png`

## 授权说明

插件使用飞书托管的 API Key 授权。用户在字段配置面板中关联账号后，插件通过 `context.fetch(..., "video_gateway_auth")` 自动携带 Bearer Token，请求视频生成接口。当前结果直接回传视频 URL，不要求用户再提供飞书上传凭据。

## 外部域名

- `model-router.edu-aliyun.com`
- `model-router-console.edu-aliyun.com`
- `agentrs.jd.com`
- `open.feishu.cn`
- `feishu.cn`
- `feishucdn.com`
- `larksuitecdn.com`
- `larksuite.com`

## 验收场景

- 纯提示词走 `t2v` 生成 1 条视频 URL。
- 单张参考图走 `i2v` 生成 1 条视频 URL。
- 多张参考图时验证首帧选择与任务提交是否符合预期。
- Seedance 链路生成 1 条视频 URL。
- 创建字段时选择「生成范围」为自定义行数，确认不会误触发整列生成。
