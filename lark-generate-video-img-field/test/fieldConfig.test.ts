import { describe, expect, it } from "vitest";
import { AuthorizationType, FieldComponent, FieldType } from "@lark-opdev/block-basekit-server-api";
import basekit from "../src/index";
import { VIDEO_AUTH_ID } from "../src/constants";

describe("field shortcut configuration", () => {
  it("declares video authorization, video domains, form items, and attachment result type", () => {
    expect(basekit.domainList).toEqual(
      expect.arrayContaining([
        "model-router.edu-aliyun.com",
        "model-router-console.edu-aliyun.com",
        "agentrs.jd.com",
        "open.feishu.cn",
        "feishu.cn"
      ])
    );
    expect(basekit.field?.authorizations).toEqual([
      expect.objectContaining({
        id: VIDEO_AUTH_ID,
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
          label: "提示词",
          component: FieldComponent.Input,
          validator: { required: true }
        }),
        expect.objectContaining({
          key: "referenceImages",
          label: "参考图片",
          component: FieldComponent.FieldSelect,
          props: expect.objectContaining({
            supportType: [FieldType.Attachment],
            mode: "multiple"
          })
        }),
        expect.objectContaining({
          key: "resolution",
          label: "分辨率",
          component: FieldComponent.SingleSelect
        }),
        expect.objectContaining({
          key: "duration",
          label: "时长",
          component: FieldComponent.SingleSelect
        }),
        expect.objectContaining({
          key: "customBaseUrl",
          label: "自定义 Base URL",
          component: FieldComponent.Input
        })
      ])
    );
  });
});
