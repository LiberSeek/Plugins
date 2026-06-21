import { describe, expect, it, vi } from "vitest";
import { FieldCode } from "@lark-opdev/block-basekit-server-api";
import { executeImageGeneration } from "../src/imageClient";
import {
  HAPPYHORSE_DEFAULT_BASE_URL,
  HAPPYHORSE_GENERATIONS_ENDPOINT,
  SEEDANCE_DEFAULT_BASE_URL,
  SEEDANCE_QUERY_ENDPOINT,
  SEEDANCE_SUBMIT_ENDPOINT,
  VIDEO_AUTH_ID
} from "../src/constants";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function makeContext(fetchImpl: any, logID = "log_test") {
  return {
    logID,
    fetch: fetchImpl
  };
}

describe("executeImageGeneration", () => {
  it("submits and polls a Happyhorse t2v task, then returns the video url attachment", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          output: {
            task_id: "happyhorse-task-1",
            task_status: "PENDING"
          }
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          output: {
            task_id: "happyhorse-task-1",
            task_status: "SUCCEEDED",
            video_url: "https://videos.example.com/happyhorse-task-1.mp4"
          }
        })
      );

    const result = await executeImageGeneration(
      {
        prompt: "咖啡厅里的短剧镜头",
        model: { value: "qwen/happyhorse-1.0-t2v", label: "Happyhorse t2v" },
        resolution: { value: "720P", label: "720P" },
        duration: { value: "15", label: "15 秒" }
      },
      makeContext(fetchImpl),
      { initialPollDelayMs: 0, pollIntervalMs: 0, taskTimeoutMs: 100 }
    );

    expect(result).toEqual({
      code: FieldCode.Success,
      data: [
        {
          name: "qwen-happyhorse-1.0-t2v-happyhorse-task-1.mp4",
          content: "https://videos.example.com/happyhorse-task-1.mp4",
          contentType: "attachment/url"
        }
      ]
    });

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      `${HAPPYHORSE_DEFAULT_BASE_URL}${HAPPYHORSE_GENERATIONS_ENDPOINT}`,
      expect.objectContaining({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-MR-Async": "true"
        },
        body: JSON.stringify({
          model: "qwen/happyhorse-1.0-t2v",
          input: {
            prompt: "咖啡厅里的短剧镜头"
          },
          parameters: {
            resolution: "720P",
            duration: 15
          }
        })
      }),
      VIDEO_AUTH_ID
    );

    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      `${HAPPYHORSE_DEFAULT_BASE_URL}/tasks/happyhorse-task-1`,
      expect.objectContaining({
        method: "GET"
      }),
      VIDEO_AUTH_ID
    );
  });

  it("uses the first reference image as Happyhorse i2v first_frame input", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          output: {
            task_id: "happyhorse-task-2",
            task_status: "PENDING"
          }
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          output: {
            task_id: "happyhorse-task-2",
            task_status: "SUCCEEDED",
            video_url: "https://videos.example.com/happyhorse-task-2.mp4"
          }
        })
      );

    const result = await executeImageGeneration(
      {
        prompt: "让角色轻轻转头看向窗外",
        model: { value: "qwen/happyhorse-1.0-i2v", label: "Happyhorse i2v" },
        referenceImages: [
          { name: "ref1.png", tmp_url: "https://cdn.example.com/ref1.png" },
          { name: "ref2.png", tmp_url: "https://cdn.example.com/ref2.png" }
        ]
      },
      makeContext(fetchImpl),
      { initialPollDelayMs: 0, pollIntervalMs: 0, taskTimeoutMs: 100 }
    );

    expect(result.code).toBe(FieldCode.Success);
    const submitBody = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(submitBody.input.media).toEqual([
      {
        type: "first_frame",
        url: "https://cdn.example.com/ref1.png"
      }
    ]);
  });

  it("maps Happyhorse insufficient balance to quota exhausted", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      jsonResponse(
        {
          error: {
            message: "Insufficient balance",
            type: "invalid_request_error"
          },
          error_code: "B.Balance.InsufficientException"
        },
        402
      )
    );

    const result = await executeImageGeneration(
      {
        prompt: "生成一个视频",
        model: { value: "qwen/happyhorse-1.0-t2v", label: "Happyhorse t2v" }
      },
      makeContext(fetchImpl),
      { initialPollDelayMs: 0, pollIntervalMs: 0, taskTimeoutMs: 100 }
    );

    expect(result.code).toBe(FieldCode.QuotaExhausted);
    expect(result.msg).toContain("Insufficient balance");
  });

  it("supports a custom Happyhorse base url and trims a full endpoint", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          output: {
            task_id: "happyhorse-task-3",
            task_status: "PENDING"
          }
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          output: {
            task_id: "happyhorse-task-3",
            task_status: "SUCCEEDED",
            video_url: "https://videos.example.com/happyhorse-task-3.mp4"
          }
        })
      );

    const result = await executeImageGeneration(
      {
        prompt: "生成一个品牌短片",
        model: { value: "qwen/happyhorse-1.0-t2v", label: "Happyhorse t2v" },
        customBaseUrl: "https://gateway.example.com/v1/videos/generations"
      },
      makeContext(fetchImpl),
      { initialPollDelayMs: 0, pollIntervalMs: 0, taskTimeoutMs: 100 }
    );

    expect(result.code).toBe(FieldCode.Success);
    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      "https://gateway.example.com/v1/videos/generations",
      expect.any(Object),
      VIDEO_AUTH_ID
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "https://gateway.example.com/v1/tasks/happyhorse-task-3",
      expect.any(Object),
      VIDEO_AUTH_ID
    );
  });

  it("submits and polls a Seedance task, then extracts content[0].video_url.url", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          result: {
            task_id: "seedance-task-1",
            status: "pending"
          }
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          task_status: "success",
          task_id: "seedance-task-1",
          content: [
            {
              video_url: {
                url: "https://videos.example.com/seedance-task-1.mp4"
              }
            }
          ]
        })
      );

    const result = await executeImageGeneration(
      {
        prompt: "雨夜街景，镜头缓慢推进",
        model: { value: "Doubao-Seedance-2.0", label: "Seedance" },
        resolution: { value: "720P", label: "720P" },
        duration: { value: "5", label: "5 秒" }
      },
      makeContext(fetchImpl),
      { initialPollDelayMs: 0, pollIntervalMs: 0, taskTimeoutMs: 100 }
    );

    expect(result).toEqual({
      code: FieldCode.Success,
      data: [
        {
          name: "Doubao-Seedance-2.0-seedance-task-1.mp4",
          content: "https://videos.example.com/seedance-task-1.mp4",
          contentType: "attachment/url"
        }
      ]
    });

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      `${SEEDANCE_DEFAULT_BASE_URL}${SEEDANCE_SUBMIT_ENDPOINT}`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          model: "Doubao-Seedance-2.0",
          content: [
            {
              type: "text",
              text: "雨夜街景，镜头缓慢推进"
            }
          ],
          parameters: {
            duration: 5,
            resolution: "720P"
          }
        })
      }),
      VIDEO_AUTH_ID
    );

    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      `${SEEDANCE_DEFAULT_BASE_URL}${SEEDANCE_QUERY_ENDPOINT}`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          taskId: "seedance-task-1"
        })
      }),
      VIDEO_AUTH_ID
    );
  });

  it("returns a task failure when Happyhorse reaches FAILED", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          output: {
            task_id: "happyhorse-task-4",
            task_status: "PENDING"
          }
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          output: {
            task_id: "happyhorse-task-4",
            task_status: "FAILED",
            message: "render failed"
          }
        })
      );

    const result = await executeImageGeneration(
      {
        prompt: "失败任务",
        model: { value: "qwen/happyhorse-1.0-t2v", label: "Happyhorse t2v" }
      },
      makeContext(fetchImpl),
      { initialPollDelayMs: 0, pollIntervalMs: 0, taskTimeoutMs: 100 }
    );

    expect(result.code).toBe(FieldCode.Error);
    expect(result.msg).toContain("视频任务执行失败");
  });

  it("requires a reference image for i2v", async () => {
    const fetchImpl = vi.fn();

    const result = await executeImageGeneration(
      {
        prompt: "需要参考图",
        model: { value: "qwen/happyhorse-1.0-i2v", label: "Happyhorse i2v" }
      },
      makeContext(fetchImpl),
      { initialPollDelayMs: 0, pollIntervalMs: 0, taskTimeoutMs: 100 }
    );

    expect(result.code).toBe(FieldCode.ConfigError);
    expect(result.msg).toContain("至少需要 1 张参考图片");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
