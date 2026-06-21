import { describe, expect, it } from "vitest";
import { AuthorizationType, FieldComponent, FieldType } from "@lark-opdev/block-basekit-server-api";
import basekit from "../src/index";
import { YUNWU_AUTH_ID } from "../src/constants";

describe("field shortcut configuration", () => {
  it("declares Yunwu authorization, request domains, form items, and attachment result type", () => {
    expect(basekit.domainList).toEqual(
      expect.arrayContaining(["api.boft.ai", "sub2api.we-token.cc", "openapi.junliai.org", "open.feishu.cn", "feishu.cn"])
    );
    expect(basekit.field?.authorizations).toEqual([
      expect.objectContaining({
        id: YUNWU_AUTH_ID,
        platform: "connect_ai",
        type: AuthorizationType.HeaderBearerToken,
        required: true
      })
    ]);

    expect(basekit.field?.resultType).toEqual({ type: FieldType.Attachment });
    expect(basekit.field?.options).toBeUndefined();
    expect(basekit.field?.formItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "model",
          label: "模型",
          component: FieldComponent.SingleSelect
        }),
        expect.objectContaining({
          key: "prompt",
          label: "输入指令",
          component: FieldComponent.Input,
          validator: { required: true }
        }),
        expect.objectContaining({
          key: "referenceImages",
          label: "参考图片（支持多图）",
          component: FieldComponent.FieldSelect,
          props: expect.objectContaining({
            supportType: [FieldType.Attachment],
            mode: "multiple"
          })
        }),
        expect.objectContaining({
          key: "feishuAppId",
          label: "App ID",
          component: FieldComponent.Input
        }),
        expect.objectContaining({
          key: "feishuAppSecret",
          label: "App Secret",
          component: FieldComponent.Input
        }),
        expect.objectContaining({
          key: "feishuAppToken",
          label: "App Token",
          component: FieldComponent.Input
        }),
        expect.objectContaining({
          key: "customBaseUrl",
          label: "自定义 Base URL",
          component: FieldComponent.Input
        }),
        expect.objectContaining({
          key: "size",
          label: "图像比例",
          component: FieldComponent.SingleSelect
        }),
        expect.objectContaining({
          key: "imageCount",
          label: "最大生成图片数",
          component: FieldComponent.Input
        })
      ])
    );
  });
});
