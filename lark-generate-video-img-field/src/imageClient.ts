import { FieldCode } from "@lark-opdev/block-basekit-server-api";
import {
  DEFAULT_DURATION,
  DEFAULT_MODEL,
  DEFAULT_RESOLUTION,
  HAPPYHORSE_DEFAULT_BASE_URL,
  HAPPYHORSE_GENERATIONS_ENDPOINT,
  HAPPYHORSE_I2V_MODEL,
  HAPPYHORSE_T2V_MODEL,
  INITIAL_POLL_DELAY_MS,
  MAX_OUTPUT_ATTACHMENTS,
  MAX_REFERENCE_IMAGES,
  POLL_INTERVAL_MS,
  SEEDANCE_DEFAULT_BASE_URL,
  SEEDANCE_MODEL,
  SEEDANCE_QUERY_ENDPOINT,
  SEEDANCE_SUBMIT_ENDPOINT,
  TASK_TIMEOUT_MS,
  VIDEO_AUTH_ID
} from "./constants";

export type ShortcutResult = {
  code: FieldCode;
  data?: unknown;
  msg?: string;
};

type SelectValue = string | { value?: string | number | boolean; label?: string };

type ReferenceAttachment = {
  name?: string;
  type?: string;
  mimeType?: string;
  tmp_url?: string;
  url?: string;
};

type ExecuteParams = {
  prompt?: unknown;
  model?: SelectValue;
  referenceImages?: unknown;
  customBaseUrl?: string;
  resolution?: SelectValue;
  duration?: SelectValue | string | number;
};

type FetchLike = (url: string, init?: RequestInit, authorizationId?: string) => Promise<Response>;

type ExecuteContext = {
  logID?: string;
  fetch: FetchLike;
};

type RuntimeOptions = {
  initialPollDelayMs?: number;
  pollIntervalMs?: number;
  taskTimeoutMs?: number;
};

type GeneratedAttachment = {
  name: string;
  content: string;
  contentType: "attachment/url";
};

type ProviderKind = "happyhorse" | "seedance";

type NormalizedParams = {
  model: string;
  prompt: string;
  referenceImages: ReferenceAttachment[];
  referenceImageUrls: string[];
  customBaseUrl: string;
  resolution: string;
  duration: number;
  provider: ProviderKind;
};

type SubmittedTask = {
  taskId: string;
  status?: string;
};

type PolledVideo = {
  sourceId: string;
  url: string;
};

class FieldMappedError extends Error {
  readonly code: FieldCode;

  constructor(code: FieldCode, message: string) {
    super(message);
    this.code = code;
  }
}

export async function executeImageGeneration(
  formItemParams: ExecuteParams,
  context: ExecuteContext,
  runtimeOptions: RuntimeOptions = {}
): Promise<ShortcutResult> {
  try {
    const normalized = normalizeParams(formItemParams);
    debugLog(context, "params_normalized", {
      model: normalized.model,
      provider: normalized.provider,
      promptLength: normalized.prompt.length,
      referenceImageCount: normalized.referenceImageUrls.length,
      resolution: normalized.resolution,
      duration: normalized.duration,
      customBaseUrl: normalized.customBaseUrl
    });

    const submittedTask =
      normalized.provider === "happyhorse"
        ? await submitHappyhorseTask(normalized, context)
        : await submitSeedanceTask(normalized, context);

    debugLog(context, "task_submitted", {
      provider: normalized.provider,
      taskId: maskValue(submittedTask.taskId),
      status: submittedTask.status
    });

    const video =
      normalized.provider === "happyhorse"
        ? await pollHappyhorseTask(submittedTask.taskId, normalized, context, runtimeOptions)
        : await pollSeedanceTask(submittedTask.taskId, normalized, context, runtimeOptions);

    const data = [toAttachment(video.url, video.sourceId, normalized.model)].slice(0, MAX_OUTPUT_ATTACHMENTS);
    if (data.length === 0) {
      throw new FieldMappedError(FieldCode.Error, "视频任务没有返回可用的视频链接");
    }

    return {
      code: FieldCode.Success,
      data
    };
  } catch (error) {
    if (error instanceof FieldMappedError) {
      return {
        code: error.code,
        msg: withLogId(error.message, context.logID)
      };
    }

    return {
      code: FieldCode.Error,
      msg: withLogId(error instanceof Error ? error.message : String(error), context.logID)
    };
  }
}

function normalizeParams(params: ExecuteParams): NormalizedParams {
  const prompt = normalizePrompt(params.prompt);
  if (!prompt) {
    throw new FieldMappedError(FieldCode.ConfigError, "提示词不能为空");
  }

  const referenceImages = normalizeReferenceImages(params.referenceImages);
  if (referenceImages.length > MAX_REFERENCE_IMAGES) {
    throw new FieldMappedError(FieldCode.ConfigError, `参考图片最多支持 ${MAX_REFERENCE_IMAGES} 张`);
  }

  const model = selectToString(params.model, DEFAULT_MODEL);
  const provider = inferProvider(model);
  const referenceImageUrls = getReferenceImageUrls(referenceImages);
  if (provider === "happyhorse" && model === HAPPYHORSE_I2V_MODEL && referenceImageUrls.length === 0) {
    throw new FieldMappedError(FieldCode.ConfigError, "图生视频模型至少需要 1 张参考图片");
  }

  return {
    model,
    prompt,
    referenceImages,
    referenceImageUrls,
    customBaseUrl: normalizeBaseUrl(String(params.customBaseUrl ?? "").trim(), provider),
    resolution: normalizeResolution(selectToString(params.resolution, DEFAULT_RESOLUTION)),
    duration: parseDuration(params.duration),
    provider
  };
}

function normalizeReferenceImages(value: ExecuteParams["referenceImages"]): ReferenceAttachment[] {
  return flattenUnknownArray(value).filter(isReferenceAttachment);
}

function flattenUnknownArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) {
    return value == null ? [] : [value];
  }

  return value.flatMap((item) => flattenUnknownArray(item));
}

function isReferenceAttachment(value: unknown): value is ReferenceAttachment {
  return typeof value === "object" && value !== null;
}

function normalizePrompt(value: ExecuteParams["prompt"]) {
  const parts = collectPromptText(value);
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

function collectPromptText(value: unknown, parentKey?: string): string[] {
  if (value == null) {
    return [];
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return [String(value)];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectPromptText(item, parentKey));
  }
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, nested]) => {
      if (isPromptNoiseKey(key, parentKey)) {
        return [];
      }
      return collectPromptText(nested, key);
    });
  }
  return [];
}

function isPromptNoiseKey(key: string, parentKey?: string) {
  const normalized = key.toLowerCase();
  if (normalized === "label" || normalized === "value") {
    return false;
  }
  if (parentKey && parentKey.toLowerCase() === "mention") {
    return normalized !== "text";
  }
  return normalized.endsWith("id") || normalized.endsWith("url");
}

function inferProvider(model: string): ProviderKind {
  return model === SEEDANCE_MODEL ? "seedance" : "happyhorse";
}

function normalizeBaseUrl(value: string, provider: ProviderKind) {
  const fallback = provider === "seedance" ? SEEDANCE_DEFAULT_BASE_URL : HAPPYHORSE_DEFAULT_BASE_URL;
  if (!value) {
    return fallback;
  }

  const trimmed = value.replace(/\/+$/, "");
  if (provider === "happyhorse") {
    return trimmed
      .replace(new RegExp(`${escapeRegExp(HAPPYHORSE_GENERATIONS_ENDPOINT)}$`), "")
      .replace(/\/v1$/, "") + "/v1";
  }

  return trimmed
    .replace(new RegExp(`${escapeRegExp(SEEDANCE_SUBMIT_ENDPOINT)}$`), "")
    .replace(new RegExp(`${escapeRegExp(SEEDANCE_QUERY_ENDPOINT)}$`), "");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeResolution(value: string) {
  const upper = value.toUpperCase();
  if (upper === "480P" || upper === "720P" || upper === "1080P") {
    return upper;
  }
  return DEFAULT_RESOLUTION;
}

function parseDuration(value: ExecuteParams["duration"]) {
  const raw = selectToString(value as SelectValue | undefined, String(DEFAULT_DURATION));
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new FieldMappedError(FieldCode.ConfigError, "时长必须是正整数秒");
  }
  return parsed;
}

function getReferenceImageUrls(attachments: ReferenceAttachment[]) {
  return attachments
    .map((attachment) => attachment.tmp_url || attachment.url || "")
    .filter((url) => typeof url === "string" && url.length > 0);
}

function selectToString(value: SelectValue | undefined, fallback: string) {
  if (typeof value === "string") {
    return value;
  }
  if (value && typeof value === "object" && value.value != null) {
    return String(value.value);
  }
  return fallback;
}

async function submitHappyhorseTask(params: NormalizedParams, context: ExecuteContext): Promise<SubmittedTask> {
  const requestUrl = `${params.customBaseUrl}${HAPPYHORSE_GENERATIONS_ENDPOINT}`;
  const body = {
    model: params.model,
    input: buildHappyhorseInput(params),
    parameters: {
      resolution: params.resolution,
      duration: params.duration
    }
  };

  const response = await context.fetch(
    requestUrl,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-MR-Async": "true"
      },
      body: JSON.stringify(body)
    },
    VIDEO_AUTH_ID
  );
  await assertProviderResponse(response, "submitHappyhorseTask", requestUrl);
  const payload = await response.json();
  const taskId = payload?.output?.task_id;
  if (typeof taskId !== "string" || taskId.length === 0) {
    throw new FieldMappedError(FieldCode.Error, `视频任务提交成功但未返回 task_id：${safeStringify(payload)}`);
  }
  return {
    taskId,
    status: typeof payload?.output?.task_status === "string" ? payload.output.task_status : undefined
  };
}

function buildHappyhorseInput(params: NormalizedParams) {
  if (params.model === HAPPYHORSE_I2V_MODEL) {
    return {
      prompt: params.prompt,
      media: params.referenceImageUrls.slice(0, 1).map((url) => ({
        type: "first_frame",
        url
      }))
    };
  }

  return {
    prompt: params.prompt
  };
}

async function submitSeedanceTask(params: NormalizedParams, context: ExecuteContext): Promise<SubmittedTask> {
  const requestUrl = `${params.customBaseUrl}${SEEDANCE_SUBMIT_ENDPOINT}`;
  const body = {
    model: params.model,
    content: [
      {
        type: "text",
        text: params.prompt
      }
    ],
    parameters: {
      duration: params.duration,
      resolution: params.resolution
    }
  };

  const response = await context.fetch(
    requestUrl,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify(body)
    },
    VIDEO_AUTH_ID
  );
  await assertProviderResponse(response, "submitSeedanceTask", requestUrl);
  const payload = await response.json();
  const taskId = payload?.result?.task_id;
  if (typeof taskId !== "string" || taskId.length === 0) {
    throw new FieldMappedError(FieldCode.Error, `视频任务提交成功但未返回 task_id：${safeStringify(payload)}`);
  }
  return {
    taskId,
    status: typeof payload?.result?.status === "string" ? payload.result.status : undefined
  };
}

async function pollHappyhorseTask(
  taskId: string,
  params: NormalizedParams,
  context: ExecuteContext,
  runtimeOptions: RuntimeOptions
): Promise<PolledVideo> {
  const requestUrl = `${params.customBaseUrl}/tasks/${encodeURIComponent(taskId)}`;
  const payload = await pollUntilTerminal(
    async () => {
      const response = await context.fetch(
        requestUrl,
        {
          method: "GET",
          headers: {
            Accept: "application/json"
          }
        },
        VIDEO_AUTH_ID
      );
      await assertProviderResponse(response, "pollHappyhorseTask", requestUrl);
      return response.json();
    },
    (payload) => String(payload?.output?.task_status ?? ""),
    runtimeOptions
  );

  const videoUrl = payload?.output?.video_url;
  if (typeof videoUrl !== "string" || videoUrl.length === 0) {
    throw new FieldMappedError(FieldCode.Error, `视频任务完成但未返回 video_url：${safeStringify(payload)}`);
  }

  return {
    sourceId: taskId,
    url: videoUrl
  };
}

async function pollSeedanceTask(
  taskId: string,
  params: NormalizedParams,
  context: ExecuteContext,
  runtimeOptions: RuntimeOptions
): Promise<PolledVideo> {
  const requestUrl = `${params.customBaseUrl}${SEEDANCE_QUERY_ENDPOINT}`;
  const payload = await pollUntilTerminal(
    async () => {
      const response = await context.fetch(
        requestUrl,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json"
          },
          body: JSON.stringify({
            taskId
          })
        },
        VIDEO_AUTH_ID
      );
      await assertProviderResponse(response, "pollSeedanceTask", requestUrl);
      return response.json();
    },
    (payload) => String(payload?.task_status ?? ""),
    runtimeOptions
  );

  const videoUrl = payload?.content?.[0]?.video_url?.url;
  if (typeof videoUrl !== "string" || videoUrl.length === 0) {
    throw new FieldMappedError(FieldCode.Error, `视频任务完成但未返回视频链接：${safeStringify(payload)}`);
  }

  return {
    sourceId: taskId,
    url: videoUrl
  };
}

async function pollUntilTerminal(
  fetchPayload: () => Promise<any>,
  readStatus: (payload: any) => string,
  runtimeOptions: RuntimeOptions
) {
  const initialDelayMs = runtimeOptions.initialPollDelayMs ?? INITIAL_POLL_DELAY_MS;
  const pollIntervalMs = runtimeOptions.pollIntervalMs ?? POLL_INTERVAL_MS;
  const taskTimeoutMs = runtimeOptions.taskTimeoutMs ?? TASK_TIMEOUT_MS;
  const startedAt = Date.now();

  if (initialDelayMs > 0) {
    await sleep(initialDelayMs);
  }

  while (Date.now() - startedAt <= taskTimeoutMs) {
    const payload = await fetchPayload();
    const status = readStatus(payload).toUpperCase();

    if (isSucceededStatus(status)) {
      return payload;
    }
    if (isFailedStatus(status)) {
      throw new FieldMappedError(FieldCode.Error, `视频任务执行失败：${extractTaskError(payload)}`);
    }

    await sleep(pollIntervalMs);
  }

  throw new FieldMappedError(FieldCode.Error, "视频任务轮询超时，请稍后重试");
}

function isSucceededStatus(status: string) {
  return status === "SUCCEEDED" || status === "SUCCESS";
}

function isFailedStatus(status: string) {
  return status === "FAILED" || status === "FAIL";
}

function extractTaskError(payload: any) {
  return payload?.error?.message || payload?.output?.message || safeStringify(payload);
}

function toAttachment(url: string, sourceId: string, model: string): GeneratedAttachment {
  return {
    name: `${sanitizeFilePart(model)}-${sanitizeFilePart(sourceId)}.mp4`,
    content: url,
    contentType: "attachment/url"
  };
}

async function assertProviderResponse(response: Response, phase: string, target: string) {
  if (response.ok) {
    return;
  }

  const message = await parseProviderError(response);
  console.log(
    JSON.stringify({
      type: "video_provider_error",
      phase,
      target,
      status: response.status,
      message
    })
  );
  throw new FieldMappedError(mapStatusToFieldCode(response.status), `视频接口调用失败：${message}`);
}

async function parseProviderError(response: Response) {
  const text = await response.text();
  try {
    const payload = JSON.parse(text);
    return payload?.error?.message ?? payload?.message ?? text;
  } catch {
    return text || response.statusText;
  }
}

function mapStatusToFieldCode(status: number) {
  if (status === 401 || status === 403) {
    return FieldCode.AuthorizationError;
  }
  if (status === 402) {
    return FieldCode.QuotaExhausted;
  }
  if (status === 429) {
    return FieldCode.RateLimit;
  }
  if (status >= 400 && status < 500) {
    return FieldCode.InvalidArgument;
  }
  return FieldCode.Error;
}

function sanitizeFilePart(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

function sleep(ms: number) {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withLogId(message: string, logID?: string) {
  return logID ? `${message}（logID: ${logID}）` : message;
}

function debugLog(context: ExecuteContext, event: string, data: Record<string, unknown>) {
  console.log(
    JSON.stringify({
      type: "video_field_debug",
      logID: context.logID,
      event,
      ...data
    })
  );
}

function maskValue(value: unknown) {
  if (typeof value !== "string" || value.length === 0) {
    return "";
  }
  if (value.length <= 8) {
    return "*".repeat(value.length);
  }
  return `${value.slice(0, 4)}***${value.slice(-4)}`;
}

function safeStringify(value: unknown) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
