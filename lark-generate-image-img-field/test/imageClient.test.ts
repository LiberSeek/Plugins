import { describe, expect, it, vi } from "vitest";
import { FieldCode } from "@lark-opdev/block-basekit-server-api";
import { executeImageGeneration } from "../src/imageClient";
import { YUNWU_AUTH_ID } from "../src/constants";

const pngBytes = Buffer.from("fake image");

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function makeContext(fetchImpl: any, logID = "log_test", token = "base_app_token") {
  return {
    logID,
    token,
    fetch: fetchImpl
  };
}

describe("executeImageGeneration", () => {
  it("serializes prompt and generation options into the provider request", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        created: 1710000000,
        data: [{ url: "https://yunwu.ai/result/task_1.png" }]
      })
    );

    const result = await executeImageGeneration(
      {
        prompt: "生成一张产品海报",
        model: { value: "gpt-image-2", label: "gpt-image-2" },
        referenceImages: [],
        size: { value: "16:9", label: "16:9" },
        customSize: "",
        resolution: { value: "4k", label: "4K" },
        imageCount: "1",
        outputFormat: { value: "webp", label: "webp" },
        officialFallback: { value: "true", label: "是" }
      },
      makeContext(fetchImpl),
      { initialPollDelayMs: 0, pollIntervalMs: 0, taskTimeoutMs: 100 }
    );

    expect(result.code).toBe(FieldCode.Success);
    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      "https://api.boft.ai/v1/images/generations",
      expect.objectContaining({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify({
          model: "gpt-image-2",
          prompt: "生成一张产品海报",
          n: 1,
          size: "1536x1024",
          response_format: "b64_json"
        })
      }),
      YUNWU_AUTH_ID
    );
  });

  it("uses a custom provider base url when configured", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        created: 1710000000,
        data: [{ url: "https://custom.example.com/result/task_1.png" }]
      })
    );

    const result = await executeImageGeneration(
      {
        prompt: "生成一张产品海报",
        model: { value: "gpt-image-2", label: "gpt-image-2" },
        referenceImages: [],
        customBaseUrl: "https://openapi.example.com/v1/",
        size: { value: "1:1", label: "1:1" },
        imageCount: "1"
      },
      makeContext(fetchImpl)
    );

    expect(result.code).toBe(FieldCode.Success);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://openapi.example.com/v1/images/generations",
      expect.any(Object),
      YUNWU_AUTH_ID
    );
  });

  it("accepts a full generations endpoint in custom base url and trims it automatically", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        created: 1710000000,
        data: [{ url: "https://custom.example.com/result/task_2.png" }]
      })
    );

    const result = await executeImageGeneration(
      {
        prompt: "生成另一张海报",
        model: { value: "gpt-image-2", label: "gpt-image-2" },
        referenceImages: [],
        customBaseUrl: "https://openapi.example.com/v1/images/generations",
        size: { value: "auto", label: "Auto" },
        imageCount: "1"
      },
      makeContext(fetchImpl)
    );

    expect(result.code).toBe(FieldCode.Success);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://openapi.example.com/v1/images/generations",
      expect.any(Object),
      YUNWU_AUTH_ID
    );
  });

  it("adds /v1 automatically when custom base url only contains the host", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        created: 1710000000,
        data: [{ url: "https://custom.example.com/result/task_3.png" }]
      })
    );

    const result = await executeImageGeneration(
      {
        prompt: "生成第三张海报",
        model: { value: "gpt-image-2", label: "gpt-image-2" },
        referenceImages: [],
        customBaseUrl: "https://openapi.example.com/",
        size: { value: "auto", label: "Auto" },
        imageCount: "1"
      },
      makeContext(fetchImpl)
    );

    expect(result.code).toBe(FieldCode.Success);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://openapi.example.com/v1/images/generations",
      expect.any(Object),
      YUNWU_AUTH_ID
    );
  });

  it("uses the direct gpt-image-2-all API without task polling", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        created: 1710000000,
        data: [{ revised_prompt: "一张海报", url: "https://yunwu.ai/result/all.png" }]
      })
    );

    const result = await executeImageGeneration(
      {
        prompt: "生成一张产品海报",
        model: { value: "gpt-image-2-all", label: "gpt-image-2-all" },
        referenceImages: [],
        size: { value: "16:9", label: "16:9" },
        imageCount: "1"
      },
      makeContext(fetchImpl)
    );

    expect(result).toEqual({
      code: FieldCode.Success,
      data: [
        {
          name: "gpt-image-2-all-direct-1.png",
          content: "https://yunwu.ai/result/all.png",
          contentType: "attachment/url"
        }
      ]
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.boft.ai/v1/images/generations",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          model: "gpt-image-2-all",
          prompt: "生成一张产品海报",
          n: 1,
          size: "1536x1024",
          response_format: "b64_json"
        })
      }),
      YUNWU_AUTH_ID
    );
  });

  it("sends reference image URLs directly in the gpt-image-2-all image field", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          created: 1710000000,
          data: [{ url: "https://yunwu.ai/result/ref-all.png" }]
        })
      );

    const result = await executeImageGeneration(
      {
        prompt: "融合参考图",
        model: { value: "gpt-image-2-all", label: "gpt-image-2-all" },
        referenceImages: [
          { name: "a.png", type: "image/png", tmp_url: "https://feishu.cn/a.png" },
          { name: "b.jpg", type: "image/jpeg", tmp_url: "https://feishu.cn/b.jpg" }
        ],
        size: { value: "9:16", label: "9:16" },
        imageCount: "1"
      },
      makeContext(fetchImpl)
    );

    expect(result.code).toBe(FieldCode.Success);
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.size).toBe("1024x1536");
    expect(body.image).toEqual([
      "https://feishu.cn/a.png",
      "https://feishu.cn/b.jpg"
    ]);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("flattens nested reference image arrays from multi-field selection", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        created: 1710000000,
        data: [{ url: "https://yunwu.ai/result/nested-ref.png" }]
      })
    );

    const result = await executeImageGeneration(
      {
        prompt: "融合多字段参考图",
        model: { value: "gpt-image-2", label: "gpt-image-2" },
        referenceImages: [
          [{ name: "a.png", type: "image/png", tmp_url: "https://feishu.cn/a.png" }],
          [{ name: "b.jpg", type: "image/jpeg", tmp_url: "https://feishu.cn/b.jpg" }]
        ],
        size: { value: "1:1", label: "1:1" },
        imageCount: "1"
      },
      makeContext(fetchImpl)
    );

    expect(result.code).toBe(FieldCode.Success);
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.image).toEqual([
      "https://feishu.cn/a.png",
      "https://feishu.cn/b.jpg"
    ]);
  });

  it("retries transient socket hang ups for the direct model", async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new Error("request to https://yunwu.ai/v1/images/generations failed, reason: socket hang up"))
      .mockResolvedValueOnce(
        jsonResponse({
          created: 1710000000,
          data: [{ url: "https://yunwu.ai/result/retry.png" }]
        })
      );

    const result = await executeImageGeneration(
      {
        prompt: "重试测试",
        model: { value: "gpt-image-2-all", label: "gpt-image-2-all" },
        referenceImages: [{ name: "a.png", type: "image/png", tmp_url: "https://feishu.cn/a.png" }],
        size: { value: "16:9", label: "16:9" },
        imageCount: "1"
      },
      makeContext(fetchImpl)
    );

    expect(result.code).toBe(FieldCode.Success);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("retries 502 provider responses for the direct model", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          {
            error: {
              message: "temporary upstream failure"
            }
          },
          502
        )
      )
      .mockResolvedValueOnce(
        jsonResponse({
          created: 1710000000,
          data: [{ url: "https://yunwu.ai/result/retry-502.png" }]
        })
      );

    const result = await executeImageGeneration(
      {
        prompt: "502 重试测试",
        model: { value: "gpt-image-2", label: "gpt-image-2" },
        referenceImages: [],
        size: { value: "1:1", label: "1:1" },
        imageCount: "1"
      },
      makeContext(fetchImpl)
    );

    expect(result.code).toBe(FieldCode.Success);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("downloads single and multiple attachment inputs as base64 data URIs", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          created: 1710000000,
          data: [{ url: "https://yunwu.ai/result/ref.png" }]
        })
      );

    const result = await executeImageGeneration(
      {
        prompt: "把参考图融合成插画",
        model: { value: "gpt-image-2", label: "gpt-image-2" },
        referenceImages: [
          { name: "a.png", type: "image/png", tmp_url: "https://feishu.cn/a.png" },
          { name: "b.jpg", mimeType: "image/jpeg", tmp_url: "https://feishu.cn/b.jpg" }
        ],
        size: { value: "custom", label: "custom" },
        customSize: "2048x1152",
        resolution: { value: "2k", label: "2K" },
        imageCount: 1,
        outputFormat: { value: "png", label: "png" },
        officialFallback: { value: "false", label: "否" }
      },
      makeContext(fetchImpl),
      { initialPollDelayMs: 0, pollIntervalMs: 0, taskTimeoutMs: 100 }
    );

    expect(result.code).toBe(FieldCode.Success);
    const taskBody = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(taskBody.size).toBe("2048x1152");
    expect(taskBody.image).toEqual([
      "https://feishu.cn/a.png",
      "https://feishu.cn/b.jpg"
    ]);
  });

  it("requests multiple images in one synchronous provider call", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        created: 1710000000,
        data: [
          { url: "https://yunwu.ai/result/1.png" },
          { url: "https://yunwu.ai/result/2.png" }
        ]
      })
    );

    const result = await executeImageGeneration(
      {
        prompt: "四宫格变体",
        model: { value: "gpt-image-2", label: "gpt-image-2" },
        referenceImages: [],
        size: { value: "1:1", label: "1:1" },
        customSize: "",
        resolution: { value: "1k", label: "1K" },
        imageCount: 2,
        outputFormat: { value: "png", label: "png" },
        officialFallback: { value: "false", label: "否" }
      },
      makeContext(fetchImpl),
      { initialPollDelayMs: 0, pollIntervalMs: 0, taskTimeoutMs: 100 }
    );

    expect(result).toEqual({
      code: FieldCode.Success,
      data: [
        {
          name: "gpt-image-2-direct-1.png",
          content: "https://yunwu.ai/result/1.png",
          contentType: "attachment/url"
        },
        {
          name: "gpt-image-2-direct-2.png",
          content: "https://yunwu.ai/result/2.png",
          contentType: "attachment/url"
        }
      ]
    });
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.n).toBe(2);
  });

  it("maps validation failures and provider errors to field codes", async () => {
    const invalidPrompt = await executeImageGeneration(
      { prompt: "   ", imageCount: 1, referenceImages: [] },
      makeContext(vi.fn())
    );
    expect(invalidPrompt.code).toBe(FieldCode.ConfigError);

    const unauthorizedFetch = vi.fn().mockResolvedValueOnce(jsonResponse({ error: { message: "bad key" } }, 401));
    const unauthorized = await executeImageGeneration(
      { prompt: "test", imageCount: 1, referenceImages: [] },
      makeContext(unauthorizedFetch),
      { initialPollDelayMs: 0, pollIntervalMs: 0, taskTimeoutMs: 100 }
    );
    expect(unauthorized.code).toBe(FieldCode.AuthorizationError);

    const rateLimitedFetch = vi.fn().mockResolvedValueOnce(jsonResponse({ message: "too many" }, 429));
    const rateLimited = await executeImageGeneration(
      { prompt: "test", imageCount: 1, referenceImages: [] },
      makeContext(rateLimitedFetch),
      { initialPollDelayMs: 0, pollIntervalMs: 0, taskTimeoutMs: 100 }
    );
    expect(rateLimited.code).toBe(FieldCode.RateLimit);

    const quotaFetch = vi.fn().mockResolvedValueOnce(jsonResponse({ message: "insufficient balance" }, 402));
    const quota = await executeImageGeneration(
      { prompt: "test", imageCount: 1, referenceImages: [] },
      makeContext(quotaFetch),
      { initialPollDelayMs: 0, pollIntervalMs: 0, taskTimeoutMs: 100 }
    );
    expect(quota.code).toBe(FieldCode.QuotaExhausted);
  });

  it("uploads b64_json image responses to Feishu and returns attachment tokens", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          created: 1710000000,
          data: [{ b64_json: `data:image/png;base64,${pngBytes.toString("base64")}` }]
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          code: 0,
          tenant_access_token: "tenant_token"
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          code: 0,
          data: {
            app: {
              app_token: "real_base_app_token",
              name: "Test Base"
            }
          }
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          code: 0,
          data: {
            file_token: "file_token_1"
          }
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          code: 0,
          data: {
            tmp_download_urls: [
              {
                file_token: "file_token_1",
                tmp_download_url: "https://internal-api-drive-stream.feishu.cn/tmp/file_token_1"
              }
            ]
          }
        })
      );

    const result = await executeImageGeneration(
      {
        prompt: "test",
        model: { value: "gpt-image-2", label: "gpt-image-2" },
        imageCount: 1,
        referenceImages: [],
        outputFormat: { value: "png", label: "png" },
        feishuAppId: "cli_xxx",
        feishuAppSecret: "secret_xxx"
      },
      makeContext(fetchImpl, "log_b64")
    );

    expect(result).toEqual({
      code: FieldCode.Success,
      data: [
        {
          name: "gpt-image-2-direct-1.png",
          content: "https://internal-api-drive-stream.feishu.cn/tmp/file_token_1",
          contentType: "attachment/url"
        }
      ]
    });

    expect(fetchImpl).toHaveBeenCalledTimes(5);
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          app_id: "cli_xxx",
          app_secret: "secret_xxx"
        })
      })
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      3,
      "https://open.feishu.cn/open-apis/bitable/v1/apps/base_app_token",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          Authorization: "Bearer tenant_token"
        })
      })
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      4,
      "https://open.feishu.cn/open-apis/drive/v1/medias/upload_all",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer tenant_token",
          "Content-Type": expect.stringContaining("multipart/form-data; boundary="),
          "Content-Length": expect.any(String)
        })
      })
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      5,
      "https://open.feishu.cn/open-apis/drive/v1/medias/batch_get_tmp_download_url?file_tokens=file_token_1",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          Authorization: "Bearer tenant_token",
          Accept: "application/json"
        })
      })
    );
    const uploadBody = fetchImpl.mock.calls[3][1].body as Buffer;
    expect(uploadBody.toString("utf8")).toContain('name="parent_type"');
    expect(uploadBody.toString("utf8")).toContain("bitable_file");
    expect(uploadBody.toString("utf8")).toContain('name="parent_node"');
    expect(uploadBody.toString("utf8")).toContain("real_base_app_token");
    expect(uploadBody.toString("utf8")).toContain('filename="gpt-image-2-direct-1.png"');
  });

  it("treats data image URLs from the provider as base64 and uses configured app token", async () => {
    const dataImageUrl = `data:image/png;base64,${pngBytes.toString("base64")}`;
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          created: 1710000000,
          data: [{ url: dataImageUrl, revised_prompt: "provider put base64 in url" }]
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          code: 0,
          tenant_access_token: "tenant_token"
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          code: 0,
          data: {
            app: {
              app_token: "real_WwQubSwlUaBAZ4s1V07cYQCfnAb",
              name: "Real Base"
            }
          }
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          code: 0,
          data: {
            file_token: "file_token_from_data_url"
          }
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          code: 0,
          data: {
            tmp_download_urls: [
              {
                file_token: "file_token_from_data_url",
                tmp_download_url: "https://internal-api-drive-stream.feishu.cn/tmp/file_token_from_data_url"
              }
            ]
          }
        })
      );

    const result = await executeImageGeneration(
      {
        prompt: "test",
        model: { value: "gpt-image-2", label: "gpt-image-2" },
        imageCount: 1,
        referenceImages: [],
        outputFormat: { value: "png", label: "png" },
        feishuAppId: "cli_xxx",
        feishuAppSecret: "secret_xxx",
        feishuAppToken: "WwQubSwlUaBAZ4s1V07cYQCfnAb"
      },
      makeContext(fetchImpl, "log_data_url", "")
    );

    expect(result).toEqual({
      code: FieldCode.Success,
      data: [
        {
          name: "gpt-image-2-direct-1.png",
          content: "https://internal-api-drive-stream.feishu.cn/tmp/file_token_from_data_url",
          contentType: "attachment/url"
        }
      ]
    });

    expect(fetchImpl).toHaveBeenCalledTimes(5);
    expect(fetchImpl).toHaveBeenNthCalledWith(
      3,
      "https://open.feishu.cn/open-apis/bitable/v1/apps/WwQubSwlUaBAZ4s1V07cYQCfnAb",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          Authorization: "Bearer tenant_token"
        })
      })
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      5,
      "https://open.feishu.cn/open-apis/drive/v1/medias/batch_get_tmp_download_url?file_tokens=file_token_from_data_url",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          Authorization: "Bearer tenant_token"
        })
      })
    );
    const uploadBody = fetchImpl.mock.calls[3][1].body as Buffer;
    expect(uploadBody.toString("utf8")).toContain("real_WwQubSwlUaBAZ4s1V07cYQCfnAb");
    expect(uploadBody.toString("utf8")).toContain('filename="gpt-image-2-direct-1.png"');
  });

  it("uses a built-in mock image when debug mode is enabled and returns a Feishu tmp download url", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          code: 0,
          tenant_access_token: "tenant_token"
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          code: 0,
          data: {
            app: {
              app_token: "real_debug_app_token",
              name: "Debug Base"
            }
          }
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          code: 0,
          data: {
            file_token: "debug_file_token"
          }
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          code: 0,
          data: {
            tmp_download_urls: [
              {
                file_token: "debug_file_token",
                tmp_download_url: "https://internal-api-drive-stream.feishu.cn/tmp/debug_file_token"
              }
            ]
          }
        })
      );

    const result = await executeImageGeneration(
      {
        prompt: "test",
        model: { value: "gpt-image-2", label: "gpt-image-2" },
        imageCount: 1,
        referenceImages: [{ name: "ignored.png", tmp_url: "https://feishu.cn/ignored.png" }],
        outputFormat: { value: "png", label: "png" },
        feishuAppId: "cli_xxx",
        feishuAppSecret: "secret_xxx",
        feishuAppToken: "debug_app_token",
        debugMockImage: { value: "true", label: "是" }
      },
      makeContext(fetchImpl, "log_debug_mock", "")
    );

    expect(result).toEqual({
      code: FieldCode.Success,
      data: [
        {
          name: "gpt-image-2-mock-1.png",
          content: "https://internal-api-drive-stream.feishu.cn/tmp/debug_file_token",
          contentType: "attachment/url"
        }
      ]
    });
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it("still uploads mock b64 data to Feishu when bitable return format is selected", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          code: 0,
          tenant_access_token: "tenant_token"
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          code: 0,
          data: {
            app: {
              app_token: "real_debug_app_token",
              name: "Debug Base"
            }
          }
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          code: 0,
          data: {
            file_token: "debug_file_token"
          }
        })
      );

    const result = await executeImageGeneration(
      {
        prompt: "test",
        model: { value: "gpt-image-2", label: "gpt-image-2" },
        imageCount: 1,
        referenceImages: [{ name: "ignored.png", tmp_url: "https://feishu.cn/ignored.png" }],
        outputFormat: { value: "png", label: "png" },
        feishuAppId: "cli_xxx",
        feishuAppSecret: "secret_xxx",
        feishuAppToken: "debug_app_token",
        debugMockImage: { value: "true", label: "是" },
        attachmentReturnFormat: { value: "bitable", label: "Bitable file_token" }
      },
      makeContext(fetchImpl, "log_debug_mock_bitable", "")
    );

    expect(result).toEqual({
      code: FieldCode.Success,
      data: [
        {
          file_token: "debug_file_token",
          name: "gpt-image-2-mock-1.png",
          size: expect.any(Number),
          type: "image/png",
          url: "https://open.feishu.cn/open-apis/drive/v1/medias/debug_file_token/download",
          tmp_url: "https://open.feishu.cn/open-apis/drive/v1/medias/batch_get_tmp_download_url?file_tokens=debug_file_token"
        }
      ]
    });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(fetchImpl.mock.calls.map((call) => call[0])).toEqual([
      "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
      "https://open.feishu.cn/open-apis/bitable/v1/apps/debug_app_token",
      "https://open.feishu.cn/open-apis/drive/v1/medias/upload_all"
    ]);
    const uploadBody = fetchImpl.mock.calls[2][1].body as Buffer;
    expect(uploadBody.toString("utf8")).toContain("real_debug_app_token");
    expect(uploadBody.toString("utf8")).toContain('filename="gpt-image-2-mock-1.png"');
  });

  it("can write uploaded attachment tokens back to a Bitable record field", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          code: 0,
          tenant_access_token: "tenant_token"
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          code: 0,
          data: {
            app: {
              app_token: "real_debug_app_token",
              name: "Debug Base"
            }
          }
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          code: 0,
          data: {
            file_token: "debug_file_token"
          }
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          code: 0,
          tenant_access_token: "tenant_token"
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          code: 0,
          data: {
            app: {
              app_token: "real_debug_app_token",
              name: "Debug Base"
            }
          }
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          code: 0,
          data: {
            record: {
              record_id: "recxxxx"
            }
          }
        })
      );

    const result = await executeImageGeneration(
      {
        prompt: "test",
        model: { value: "gpt-image-2", label: "gpt-image-2" },
        imageCount: 1,
        referenceImages: [],
        outputFormat: { value: "png", label: "png" },
        feishuAppId: "cli_xxx",
        feishuAppSecret: "secret_xxx",
        feishuAppToken: "debug_app_token",
        debugMockImage: { value: "true", label: "是" },
        attachmentReturnFormat: { value: "bitable", label: "Bitable file_token" },
        writeBackMode: { value: "record", label: "主动写回记录" },
        writeBackTableId: "tblxxxx",
        writeBackRecordId: "recxxxx"
      },
      makeContext(fetchImpl, "log_write_back", "")
    );

    expect(result).toEqual({
      code: FieldCode.Success,
      data: [
        {
          file_token: "debug_file_token",
          name: "gpt-image-2-mock-1.png",
          size: expect.any(Number),
          type: "image/png",
          url: "https://open.feishu.cn/open-apis/drive/v1/medias/debug_file_token/download",
          tmp_url: "https://open.feishu.cn/open-apis/drive/v1/medias/batch_get_tmp_download_url?file_tokens=debug_file_token"
        }
      ]
    });
    expect(fetchImpl).toHaveBeenCalledTimes(6);
    expect(fetchImpl.mock.calls.map((call) => call[0])).toEqual([
      "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
      "https://open.feishu.cn/open-apis/bitable/v1/apps/debug_app_token",
      "https://open.feishu.cn/open-apis/drive/v1/medias/upload_all",
      "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
      "https://open.feishu.cn/open-apis/bitable/v1/apps/debug_app_token",
      "https://open.feishu.cn/open-apis/bitable/v1/apps/real_debug_app_token/tables/tblxxxx/records/recxxxx"
    ]);
    expect(fetchImpl).toHaveBeenNthCalledWith(
      6,
      "https://open.feishu.cn/open-apis/bitable/v1/apps/real_debug_app_token/tables/tblxxxx/records/recxxxx",
      expect.objectContaining({
        method: "PUT",
        headers: expect.objectContaining({
          Authorization: "Bearer tenant_token",
          "Content-Type": "application/json"
        }),
        body: JSON.stringify({
          fields: {
            "角色图片": [
              {
                file_token: "debug_file_token",
                name: "gpt-image-2-mock-1.png"
              }
            ]
          }
        })
      })
    );
  });

  it("caps attachment output at the Feishu field limit", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        created: 1710000000,
        data: [
          { url: "https://yunwu.ai/result/1.png" },
          { url: "https://yunwu.ai/result/2.png" },
          { url: "https://yunwu.ai/result/3.png" },
          { url: "https://yunwu.ai/result/4.png" },
          { url: "https://yunwu.ai/result/5.png" },
          { url: "https://yunwu.ai/result/6.png" }
        ]
      })
    );

    const result = await executeImageGeneration(
      { prompt: "test", model: { value: "gpt-image-2", label: "gpt-image-2" }, imageCount: 1, referenceImages: [] },
      makeContext(fetchImpl),
      { initialPollDelayMs: 0, pollIntervalMs: 0, taskTimeoutMs: 100 }
    );

    expect(result.code).toBe(FieldCode.Success);
    expect(result.data).toHaveLength(5);
  });
});
