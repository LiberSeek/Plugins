import {
  AuthorizationType,
  basekit,
  FieldCode,
  FieldComponent,
  FieldType
} from "@lark-opdev/block-basekit-server-api";
import {
  DEFAULT_IMAGE_COUNT,
  DEFAULT_SIZE,
  BOFT_AUTH_ID
} from "./constants";
import { executeImageGeneration } from "./imageClient";

const shortcutIcon =
  "data:image/png;base64,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";

basekit.addDomainList([
  "api.boft.ai",
  "sub2api.we-token.cc",
  "openapi.junliai.org",
  "open.feishu.cn",
  "feishu.cn",
  "feishucdn.com",
  "larksuitecdn.com",
  "larksuite.com"
]);

basekit.addField({
  authorizations: [
    {
      id: BOFT_AUTH_ID,
      label: "BOFT API Key",
      platform: "connect_ai",
      type: AuthorizationType.HeaderBearerToken,
      required: true,
      instructionsUrl: "https://boft.ai",
      icon: {
        light: shortcutIcon,
        dark: shortcutIcon
      }
    }
  ],
  formItems: [
    {
      key: "model",
      label: "模型",
      component: FieldComponent.SingleSelect,
      props: {
        options: [{ label: "gpt-image-2", value: "gpt-image-2" }]
      },
      defaultValue: { label: "gpt-image-2", value: "gpt-image-2" }
    },
    {
      key: "prompt",
      label: "输入指令",
      component: FieldComponent.Input,
      props: {
        placeholder: "写入生成图片的完整指令，可在输入框中引用多维表字段",
        mode: "textarea"
      },
      validator: {
        required: true
      }
    },
    {
      key: "referenceImages",
      label: "参考图片（支持多图）",
      component: FieldComponent.FieldSelect,
      props: {
        supportType: [FieldType.Attachment],
        mode: "multiple"
      },
      validator: {
        required: false,
        maxItems: 16
      }
    },
    {
      key: "size",
      label: "图像比例",
      component: FieldComponent.SingleSelect,
      props: {
        options: [
          { label: "Auto", value: "auto" },
          { label: "1:1（1024x1024）", value: "1024x1024" },
          { label: "横图（1536x1024）", value: "1536x1024" },
          { label: "竖图（1024x1536）", value: "1024x1536" }
        ]
      },
      defaultValue: { label: "Auto", value: DEFAULT_SIZE }
    },
    {
      key: "imageCount",
      label: "最大生成图片数",
      component: FieldComponent.Input,
      props: {
        placeholder: "1-4"
      },
      defaultValue: String(DEFAULT_IMAGE_COUNT),
      validator: {
        required: false
      }
    },
    {
      key: "feishuAppId",
      label: "App ID",
      component: FieldComponent.Input,
      props: {
        placeholder: "用于获取 tenant_access_token，并上传飞书附件"
      }
    },
    {
      key: "feishuAppSecret",
      label: "App Secret",
      component: FieldComponent.Input,
      props: {
        placeholder: "用于获取 tenant_access_token，并上传飞书附件"
      }
    },
    {
      key: "feishuAppToken",
      label: "App Token",
      component: FieldComponent.Input,
      props: {
        placeholder: "多维表 URL 中 /base/ 或 /wiki/ 后面的 token"
      }
    },
    {
      key: "customBaseUrl",
      label: "自定义 Base URL",
      component: FieldComponent.Input,
      props: {
        placeholder: "可选，未填写时默认使用 https://api.boft.ai/v1"
      }
    }
  ],
  resultType: {
    type: FieldType.Attachment
  },
  execute: async (formItemParams, context) => {
    try {
      return await executeImageGeneration(formItemParams, context);
    } catch (error) {
      return {
        code: FieldCode.Error,
        msg: error instanceof Error ? error.message : String(error)
      };
    }
  }
});

export default basekit;
