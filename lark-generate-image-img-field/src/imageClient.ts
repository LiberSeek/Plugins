import { FieldCode } from "@lark-opdev/block-basekit-server-api";
import {
  DEFAULT_IMAGE_COUNT,
  DEFAULT_MODEL,
  DEFAULT_OFFICIAL_FALLBACK,
  DEFAULT_OUTPUT_FORMAT,
  DEFAULT_RESOLUTION,
  DEFAULT_SIZE,
  MAX_OUTPUT_ATTACHMENTS,
  MAX_REFERENCE_IMAGES,
  YUNWU_API_BASE_URL,
  YUNWU_AUTH_ID,
  YUNWU_GENERATIONS_ENDPOINT
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
  feishuAppId?: string;
  feishuAppSecret?: string;
  feishuAppToken?: string;
  customBaseUrl?: string;
  writeBackMode?: SelectValue;
  writeBackTableId?: string;
  writeBackRecordId?: string;
  size?: SelectValue;
  customSize?: string;
  resolution?: SelectValue;
  imageCount?: string | number;
  outputFormat?: SelectValue;
  officialFallback?: SelectValue | boolean;
  debugMockImage?: SelectValue | boolean;
  attachmentReturnFormat?: SelectValue;
};

type FetchLike = (url: string, init?: RequestInit, authorizationId?: string) => Promise<Response>;

type ExecuteContext = {
  logID?: string;
  fetch: FetchLike;
  token?: string;
  baseToken?: string;
  baseID?: string;
  baseName?: string;
  baseURL?: string;
  recordURL?: string;
  businessAttributes?: unknown;
  bitable?: {
    token?: string;
    tableID?: string;
    tableId?: string;
    recordID?: string;
    recordId?: string;
    fieldID?: string;
    fieldId?: string;
  };
  tableID?: string;
  tableId?: string;
  recordID?: string;
  recordId?: string;
  fieldID?: string;
  fieldId?: string;
  app?: {
    token?: string;
    tableID?: string;
    tableId?: string;
    recordID?: string;
    recordId?: string;
    fieldID?: string;
    fieldId?: string;
    trigger?: {
      tableID?: string;
      tableId?: string;
      recordID?: string;
      recordId?: string;
      fieldID?: string;
      fieldId?: string;
    };
  };
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

type UploadedAttachment = {
  id: string;
  attachmentToken: string;
  name: string;
  mimeType: string;
  size: number;
  timeStamp: number;
};

type BitableAttachment = {
  file_token: string;
  name: string;
  size?: number;
  type?: string;
  url?: string;
  tmp_url?: string;
};

type GeneratedImage = {
  sourceId: string;
  content: string;
  contentType: "url" | "b64";
  index: number;
  model: string;
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
  _runtimeOptions: RuntimeOptions = {}
): Promise<ShortcutResult> {
  try {
    debugLog(context, "start", {
      params: redactParamsForLog(formItemParams)
    });
    const normalized = normalizeParams(formItemParams);
    debugLog(context, "params_normalized", {
      model: normalized.model,
      promptLength: normalized.prompt.length,
      imageCount: normalized.imageCount,
      size: normalizeDirectSize(normalized.size),
      outputFormat: normalized.outputFormat,
      debugMockImage: normalized.debugMockImage,
      attachmentReturnFormat: normalized.attachmentReturnFormat,
      feishuAppId: maskValue(normalized.feishuAppId),
      hasFeishuAppSecret: Boolean(normalized.feishuAppSecret),
      feishuAppToken: maskValue(normalized.feishuAppToken),
      customBaseUrl: normalized.customBaseUrl,
      contextToken: maskValue(context.token),
      effectiveAppToken: maskValue(getEffectiveAppToken(normalized, context)),
      writeBackMode: normalized.writeBackMode,
      writeBackTableId: maskValue(getEffectiveTableId(normalized, context)),
      writeBackRecordId: maskValue(getEffectiveRecordId(normalized, context)),
      writeBackFieldId: maskValue(getEffectiveFieldId(context))
    });

    const referenceImageUrls = normalized.debugMockImage ? [] : getReferenceImageUrls(normalized.referenceImages);
    debugLog(context, "reference_images_prepared", {
      count: referenceImageUrls.length,
      hosts: referenceImageUrls.map((url) => hostFromUrl(url)),
      urls: referenceImageUrls
    });

    const resultImages = normalized.debugMockImage
      ? createMockImages(normalized, context)
      : await createDirectImages(normalized, referenceImageUrls, context);
    debugLog(context, "provider_images_extracted", {
      count: resultImages.length,
      images: resultImages.map((image) => ({
        index: image.index,
        contentType: image.contentType,
        contentLength: image.content.length,
        sourceId: image.sourceId
      }))
    });

    const data = await Promise.all(
      resultImages.slice(0, MAX_OUTPUT_ATTACHMENTS).map((image) => {
        if (image.contentType === "url") {
          debugLog(context, "return_url_attachment", {
            index: image.index,
            urlHost: hostFromUrl(image.content),
            urlLength: image.content.length
          });
          return Promise.resolve(toAttachment(image.content, image.sourceId, image.index, normalized.outputFormat, image.model));
        }

        return uploadB64ToFeishu(image.content, image.sourceId, image.index, normalized, context);
      })
    );

    if (data.length === 0) {
      throw new FieldMappedError(FieldCode.Error, "生图接口没有返回图片");
    }

    if (normalized.writeBackMode === "record") {
      await writeBackAttachmentsToBitable(data, normalized, context);
    }

    debugLog(context, "success", {
      outputCount: data.length,
      outputKinds: data.map((item) => summarizeOutputItem(item))
    });

    return {
      code: FieldCode.Success,
      data
    };
  } catch (error) {
    if (error instanceof FieldMappedError) {
      debugLog(context, "mapped_error", {
        code: error.code,
        message: error.message
      });
      return {
        code: error.code,
        msg: withLogId(error.message, context.logID)
      };
    }

    debugLog(context, "unexpected_error", {
      message: error instanceof Error ? error.message : String(error)
    });
    return {
      code: FieldCode.Error,
      msg: withLogId(error instanceof Error ? error.message : String(error), context.logID)
    };
  }
}

function normalizeParams(params: ExecuteParams) {
  const prompt = normalizePrompt(params.prompt);
  if (!prompt) {
    throw new FieldMappedError(FieldCode.ConfigError, "输入指令不能为空");
  }

  const referenceImages = normalizeReferenceImages(params.referenceImages);
  if (referenceImages.length > MAX_REFERENCE_IMAGES) {
    throw new FieldMappedError(FieldCode.ConfigError, `图片内容最多支持 ${MAX_REFERENCE_IMAGES} 张参考图`);
  }

  const imageCount = parseInteger(params.imageCount, DEFAULT_IMAGE_COUNT);
  if (imageCount < 1 || imageCount > 4) {
    throw new FieldMappedError(FieldCode.ConfigError, "最大生成图片数必须在 1 到 4 之间");
  }

  const selectedSize = selectToString(params.size, DEFAULT_SIZE);
  const size = selectedSize === "custom" ? String(params.customSize ?? "").trim() : selectedSize;
  if (selectedSize === "custom" && !/^\d+x\d+$/i.test(size)) {
    throw new FieldMappedError(FieldCode.ConfigError, "自定义尺寸需使用类似 2048x1152 的格式");
  }

  return {
    model: selectToString(params.model, DEFAULT_MODEL),
    prompt,
    referenceImages,
    feishuAppId: String(params.feishuAppId ?? "").trim(),
    feishuAppSecret: String(params.feishuAppSecret ?? "").trim(),
    feishuAppToken: String(params.feishuAppToken ?? "").trim(),
    customBaseUrl: normalizeBaseUrl(String(params.customBaseUrl ?? "").trim()) || YUNWU_API_BASE_URL,
    writeBackMode: selectToString(params.writeBackMode, "return"),
    writeBackTableId: String(params.writeBackTableId ?? "").trim(),
    writeBackRecordId: String(params.writeBackRecordId ?? "").trim(),
    imageCount,
    size,
    resolution: selectToString(params.resolution, DEFAULT_RESOLUTION),
    outputFormat: selectToString(params.outputFormat, DEFAULT_OUTPUT_FORMAT),
    officialFallback: selectToBoolean(params.officialFallback, DEFAULT_OFFICIAL_FALLBACK),
    debugMockImage: selectToBoolean(params.debugMockImage, false),
    attachmentReturnFormat: selectToString(params.attachmentReturnFormat, "sdk")
  };
}

function normalizeReferenceImages(value: ExecuteParams["referenceImages"]): ReferenceAttachment[] {
  if (!value) {
    return [];
  }
  const list = flattenUnknownArray(value);
  return list.filter(isReferenceAttachment);
}

function flattenUnknownArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) {
    return [value];
  }

  return value.flatMap((item) => flattenUnknownArray(item));
}

function isReferenceAttachment(value: unknown): value is ReferenceAttachment {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record.tmp_url === "string" ||
    typeof record.url === "string" ||
    typeof record.name === "string" ||
    typeof record.type === "string" ||
    typeof record.mimeType === "string"
  );
}

function normalizePrompt(value: ExecuteParams["prompt"]) {
  return collectPromptText(value).trim();
}

function collectPromptText(value: unknown, parentKey?: string): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => collectPromptText(item)).join("");
  }

  if (typeof value !== "object") {
    return "";
  }

  if (parentKey && isPromptNoiseKey(parentKey)) {
    return "";
  }

  const record = value as Record<string, unknown>;
  const preferredKeys = ["text", "content", "value", "label", "name", "title"];
  const preferredText = preferredKeys
    .map((key) => collectPromptText(record[key], key))
    .filter(Boolean)
    .join("");

  if (preferredText) {
    return preferredText;
  }

  return Object.entries(record)
    .filter(([key]) => !isPromptNoiseKey(key))
    .map(([key, item]) => collectPromptText(item, key))
    .filter(Boolean)
    .join("");
}

function isPromptNoiseKey(key: string) {
  return [
    "type",
    "id",
    "key",
    "fieldId",
    "tableId",
    "recordId",
    "viewId",
    "blockId",
    "url",
    "tmp_url",
    "mimeType",
    "size"
  ].includes(key);
}

function normalizeBaseUrl(value: string) {
  if (!value) {
    return "";
  }
  const normalized = value
    .replace(/\/images\/generations\/?$/i, "")
    .replace(/\/+$/, "");

  if (/^https?:\/\/[^/]+$/i.test(normalized)) {
    return `${normalized}/v1`;
  }

  return normalized;
}

function getReferenceImageUrls(attachments: ReferenceAttachment[]) {
  return attachments.slice(0, 5).map((attachment) => {
    const url = attachment.tmp_url ?? attachment.url;
    if (!url) {
      throw new FieldMappedError(
        FieldCode.ConfigError,
        `图片内容附件缺少临时下载地址：${safeStringify(summarizeReferenceAttachment(attachment))}`
      );
    }
    return url;
  });
}

function selectToString(value: SelectValue | undefined, fallback: string) {
  if (value && typeof value === "object" && value.value !== undefined) {
    return String(value.value);
  }
  if (value === undefined || value === "") {
    return fallback;
  }
  return String(value);
}

function selectToBoolean(value: SelectValue | boolean | undefined, fallback: boolean) {
  if (typeof value === "boolean") {
    return value;
  }
  const raw = selectToString(value, String(fallback)).toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes" || raw === "是";
}

function parseInteger(value: string | number | undefined, fallback: number) {
  if (value === undefined || value === "") {
    return fallback;
  }
  const parsed = typeof value === "number" ? value : Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    throw new FieldMappedError(FieldCode.ConfigError, "最大生成图片数必须是数字");
  }
  return parsed;
}

async function createDirectImages(
  params: ReturnType<typeof normalizeParams>,
  imageUrls: string[],
  context: ExecuteContext
): Promise<GeneratedImage[]> {
  const fetchImpl = context.fetch;
  const requestUrl = `${params.customBaseUrl}${YUNWU_GENERATIONS_ENDPOINT}`;
  const body: Record<string, unknown> = {
    model: params.model,
    prompt: params.prompt,
    n: params.imageCount,
    size: normalizeDirectSize(params.size),
    response_format: "b64_json"
  };

  if (imageUrls.length > 0) {
    body.image = imageUrls.slice(0, 5);
  }

  const bodyText = JSON.stringify(body);
  logDirectRequest(requestUrl, body, bodyText.length);

  const response = await fetchWithNetworkRetry(
    fetchImpl,
    requestUrl,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: bodyText
    },
    YUNWU_AUTH_ID,
    "createDirectImages"
  );

  await assertProviderResponse(response, "createDirectImages", requestUrl);
  const payload = await response.json();
  debugLog(context, "provider_response_received", summarizeProviderPayload(payload));
  const images = extractDirectImages(payload);
  if (images.length === 0) {
    throw new FieldMappedError(FieldCode.Error, "生图接口没有返回图片 URL 或 b64_json");
  }

  return images.map((image, index) => ({
    sourceId: "direct",
    content: image.content,
    contentType: image.contentType,
    index,
    model: params.model
  }));
}

function createMockImages(params: ReturnType<typeof normalizeParams>, context: ExecuteContext): GeneratedImage[] {
  const mockB64 =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";
  debugLog(context, "debug_mock_image_enabled", {
    count: 1,
    contentType: "b64",
    b64Length: mockB64.length
  });

  return [
    {
      sourceId: "mock",
      content: mockB64,
      contentType: "b64",
      index: 0,
      model: params.model
    }
  ];
}

async function fetchWithNetworkRetry(
  fetchImpl: FetchLike,
  url: string,
  init: RequestInit,
  authorizationId: string,
  phase: string
) {
  const maxAttempts = 3;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetchImpl(url, init, authorizationId);
      if (shouldRetryProviderStatus(response.status) && attempt < maxAttempts) {
        console.log(
          JSON.stringify({
            type: "yunwu_http_retry",
            phase,
            attempt,
            status: response.status,
            target: url
          })
        );
        await sleep(1200 * attempt);
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
      if (!isTransientNetworkError(error) || attempt >= maxAttempts) {
        throw error;
      }
      console.log(
        JSON.stringify({
          type: "yunwu_network_retry",
          phase,
          attempt,
          message: error instanceof Error ? error.message : String(error)
        })
      );
      await sleep(1200);
    }
  }

  throw lastError;
}

async function uploadB64ToFeishu(
  b64: string,
  sourceId: string,
  index: number,
  params: ReturnType<typeof normalizeParams>,
  context: ExecuteContext
): Promise<GeneratedAttachment | BitableAttachment> {
  if (!params.feishuAppId || !params.feishuAppSecret) {
    throw new FieldMappedError(FieldCode.ConfigError, "接口返回 b64_json 时，必须填写 App ID 和 App Secret 才能上传飞书附件");
  }
  const appToken = getEffectiveAppToken(params, context);
  if (!appToken) {
    throw new FieldMappedError(FieldCode.ConfigError, "缺少多维表 App Token。请在字段捷径配置中填写 App Token，用于上传飞书附件");
  }

  const tenantToken = await getTenantAccessToken(params.feishuAppId, params.feishuAppSecret, context.fetch);
  const realAppToken = await resolveRealAppToken(appToken, tenantToken, context.fetch, context.logID);
  const fileBuffer = decodeBase64Image(b64);
  const fileName = `${sanitizeFilePart(params.model)}-${sanitizeFilePart(sourceId)}-${index + 1}.${params.outputFormat}`;
  const mimeType = mimeTypeFromOutputFormat(params.outputFormat);
  debugLog(context, "b64_upload_start", {
    index,
    sourceId,
    b64Length: b64.length,
    decodedBytes: fileBuffer.length,
    fileName,
    mimeType,
    inputAppToken: maskValue(appToken),
    realAppToken: maskValue(realAppToken)
  });

  const fileToken = await uploadMediaToFeishu({
    fetchImpl: context.fetch,
    tenantToken,
    appToken: realAppToken,
    fileName,
    fileBuffer,
    mimeType,
    logID: context.logID
  });

  debugLog(context, "b64_upload_success", {
    index,
    fileName,
    fileToken: maskValue(fileToken),
    size: fileBuffer.length,
    attachmentReturnFormat: params.attachmentReturnFormat
  });

  if (params.attachmentReturnFormat === "bitable") {
    return {
      file_token: fileToken,
      name: fileName,
      size: fileBuffer.length,
      type: mimeType,
      url: buildFeishuDownloadUrl(fileToken),
      tmp_url: buildFeishuTmpDownloadUrl(fileToken)
    };
  }

  const tmpDownloadUrl = await getFeishuTmpDownloadUrl({
    fetchImpl: context.fetch,
    tenantToken,
    fileToken,
    logID: context.logID
  });

  debugLog(context, "b64_tmp_download_url_ready", {
    index,
    fileName,
    fileToken: maskValue(fileToken),
    tmpUrlHost: hostFromUrl(tmpDownloadUrl),
    tmpUrlLength: tmpDownloadUrl.length
  });

  return {
    name: fileName,
    content: tmpDownloadUrl,
    contentType: "attachment/url"
  };
}

async function writeBackAttachmentsToBitable(
  data: Array<GeneratedAttachment | UploadedAttachment | BitableAttachment>,
  params: ReturnType<typeof normalizeParams>,
  context: ExecuteContext
) {
  if (!params.feishuAppId || !params.feishuAppSecret) {
    throw new FieldMappedError(FieldCode.ConfigError, "主动写回记录时，必须填写 App ID 和 App Secret");
  }

  const appToken = getEffectiveAppToken(params, context);
  const tableId = getEffectiveTableId(params, context);
  const recordId = getEffectiveRecordId(params, context);
  const fieldName = "角色图片";

  if (!appToken) {
    throw new FieldMappedError(FieldCode.ConfigError, "主动写回记录时，必须填写 App Token");
  }
  if (!tableId) {
    throw new FieldMappedError(FieldCode.ConfigError, "主动写回记录时，必须填写 Table ID");
  }
  if (!recordId) {
    throw new FieldMappedError(FieldCode.ConfigError, "主动写回记录时，必须填写 Record ID");
  }
  const attachments = data.map(toBitableWriteBackAttachment);
  if (attachments.some((item) => item === null)) {
    throw new FieldMappedError(FieldCode.ConfigError, "主动写回记录只支持已上传到飞书的附件，请填写 App ID、App Secret、App Token");
  }

  const tenantToken = await getTenantAccessToken(params.feishuAppId, params.feishuAppSecret, context.fetch);
  const realAppToken = await resolveRealAppToken(appToken, tenantToken, context.fetch, context.logID);
  await updateBitableRecordAttachments({
    fetchImpl: context.fetch,
    tenantToken,
    appToken: realAppToken,
    tableId,
    recordId,
    fieldName,
    attachments: attachments.filter((item): item is BitableAttachment => item !== null),
    logID: context.logID
  });
}

function toBitableWriteBackAttachment(item: GeneratedAttachment | UploadedAttachment | BitableAttachment) {
  if (isBitableAttachment(item)) {
    return item;
  }
  if (isUploadedAttachment(item)) {
    return {
      file_token: item.attachmentToken,
      name: item.name
    };
  }
  return null;
}

async function getTenantAccessToken(appId: string, appSecret: string, fetchImpl: FetchLike) {
  const requestUrl = "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal";
  console.log(
    JSON.stringify({
      type: "feishu_token_request",
      appId: maskValue(appId),
      hasAppSecret: Boolean(appSecret)
    })
  );
  const response = await fetchImpl(requestUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify({
      app_id: appId,
      app_secret: appSecret
    })
  });
  await assertFeishuResponse(response, "getTenantAccessToken", requestUrl);
  const payload = await response.json();
  const token = payload?.tenant_access_token;
  if (typeof token !== "string" || token.length === 0) {
    throw new FieldMappedError(FieldCode.AuthorizationError, `获取 tenant_access_token 失败：${safeStringify(payload)}`);
  }
  console.log(
    JSON.stringify({
      type: "feishu_token_success",
      token: maskValue(token),
      responseKeys: Object.keys(payload ?? {})
    })
  );
  return token;
}

async function resolveRealAppToken(inputAppToken: string, tenantToken: string, fetchImpl: FetchLike, logID?: string) {
  const requestUrl = `https://open.feishu.cn/open-apis/bitable/v1/apps/${encodeURIComponent(inputAppToken)}`;
  const requestInit: RequestInit = {
    method: "GET",
    headers: {
      Authorization: `Bearer ${tenantToken}`,
      Accept: "application/json"
    }
  };

  console.log(
    JSON.stringify({
      type: "feishu_app_token_resolve_request",
      logID,
      requestUrl,
      method: requestInit.method,
      headers: {
        Authorization: maskBearerToken(tenantToken),
        Accept: "application/json"
      },
      body: null,
      inputAppToken: maskValue(inputAppToken)
    })
  );

  const response = await fetchImpl(requestUrl, requestInit);
  console.log(
    JSON.stringify({
      type: "feishu_app_token_resolve_http_response",
      logID,
      requestUrl,
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      headers: summarizeResponseHeaders(response)
    })
  );
  await assertFeishuResponse(response, "resolveRealAppToken", requestUrl);
  const payload = await response.json();
  const realAppToken = payload?.data?.app?.app_token;

  console.log(
    JSON.stringify({
      type: "feishu_app_token_resolve_response",
      logID,
      responseKeys: Object.keys(payload ?? {}),
      dataKeys: Object.keys(payload?.data ?? {}),
      appKeys: Object.keys(payload?.data?.app ?? {}),
      code: payload?.code,
      msg: payload?.msg,
      appName: payload?.data?.app?.name,
      inputAppToken: maskValue(inputAppToken),
      realAppToken: maskValue(realAppToken)
    })
  );

  if (payload?.code !== 0) {
    throw new FieldMappedError(FieldCode.InvalidArgument, `解析多维表 App Token 失败：${safeStringify(payload)}`);
  }
  if (typeof realAppToken !== "string" || realAppToken.length === 0) {
    throw new FieldMappedError(FieldCode.InvalidArgument, `飞书接口没有返回真实 app_token：${safeStringify(payload)}`);
  }

  return realAppToken;
}

async function uploadMediaToFeishu(options: {
  fetchImpl: FetchLike;
  tenantToken: string;
  appToken: string;
  fileName: string;
  fileBuffer: Buffer;
  mimeType: string;
  logID?: string;
}) {
  const requestUrl = "https://open.feishu.cn/open-apis/drive/v1/medias/upload_all";
  const multipart = buildMultipartBody([
    { name: "file_name", value: options.fileName },
    { name: "parent_type", value: "bitable_file" },
    { name: "parent_node", value: options.appToken },
    { name: "size", value: String(options.fileBuffer.length) },
    {
      name: "file",
      value: options.fileBuffer,
      fileName: options.fileName,
      mimeType: options.mimeType
    }
  ]);

  console.log(
    JSON.stringify({
      type: "feishu_media_upload_request",
      logID: options.logID,
      fileName: options.fileName,
      mimeType: options.mimeType,
      fileBytes: options.fileBuffer.length,
      multipartBytes: multipart.body.length,
      parentType: "bitable_file",
      parentNode: maskValue(options.appToken),
      tenantToken: maskValue(options.tenantToken)
    })
  );

  const response = await options.fetchImpl(requestUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.tenantToken}`,
      "Content-Type": multipart.contentType,
      "Content-Length": String(multipart.body.length)
    },
    body: multipart.body as unknown as BodyInit
  });
  await assertFeishuResponse(response, "uploadMediaToFeishu", requestUrl);
  const payload = await response.json();
  console.log(
    JSON.stringify({
      type: "feishu_media_upload_response",
      logID: options.logID,
      responseKeys: Object.keys(payload ?? {}),
      code: payload?.code,
      msg: payload?.msg,
      hasData: Boolean(payload?.data),
      fileToken: maskValue(payload?.data?.file_token)
    })
  );
  const fileToken = payload?.data?.file_token;
  if (typeof fileToken !== "string" || fileToken.length === 0) {
    throw new FieldMappedError(FieldCode.Error, `飞书上传接口没有返回 file_token：${safeStringify(payload)}`);
  }
  return fileToken;
}

async function getFeishuTmpDownloadUrl(options: {
  fetchImpl: FetchLike;
  tenantToken: string;
  fileToken: string;
  logID?: string;
}) {
  const requestUrl = `https://open.feishu.cn/open-apis/drive/v1/medias/batch_get_tmp_download_url?file_tokens=${encodeURIComponent(
    options.fileToken
  )}`;

  console.log(
    JSON.stringify({
      type: "feishu_tmp_download_request",
      logID: options.logID,
      requestUrl,
      method: "GET",
      headers: {
        Authorization: maskBearerToken(options.tenantToken),
        Accept: "application/json"
      },
      fileToken: maskValue(options.fileToken)
    })
  );

  const response = await options.fetchImpl(requestUrl, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${options.tenantToken}`,
      Accept: "application/json"
    }
  });

  console.log(
    JSON.stringify({
      type: "feishu_tmp_download_http_response",
      logID: options.logID,
      requestUrl,
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      headers: summarizeResponseHeaders(response)
    })
  );

  await assertFeishuResponse(response, "getFeishuTmpDownloadUrl", requestUrl);
  const payload = await response.json();
  const tmpDownloadUrls = Array.isArray(payload?.data?.tmp_download_urls) ? payload.data.tmp_download_urls : [];
  const matched =
    tmpDownloadUrls.find((item: any) => item?.file_token === options.fileToken) ??
    tmpDownloadUrls.find((item: any) => typeof item?.tmp_download_url === "string");
  const tmpDownloadUrl = matched?.tmp_download_url;

  console.log(
    JSON.stringify({
      type: "feishu_tmp_download_response",
      logID: options.logID,
      responseKeys: Object.keys(payload ?? {}),
      code: payload?.code,
      msg: payload?.msg,
      tmpDownloadUrlCount: tmpDownloadUrls.length,
      matchedFileToken: maskValue(matched?.file_token),
      tmpUrlHost: hostFromUrl(tmpDownloadUrl),
      tmpUrlLength: typeof tmpDownloadUrl === "string" ? tmpDownloadUrl.length : 0
    })
  );

  if (payload?.code !== 0) {
    throw new FieldMappedError(FieldCode.InvalidArgument, `获取飞书素材临时下载链接失败：${safeStringify(payload)}`);
  }
  if (typeof tmpDownloadUrl !== "string" || tmpDownloadUrl.length === 0) {
    throw new FieldMappedError(FieldCode.Error, `飞书临时下载链接接口没有返回 tmp_download_url：${safeStringify(payload)}`);
  }

  return tmpDownloadUrl;
}

async function updateBitableRecordAttachments(options: {
  fetchImpl: FetchLike;
  tenantToken: string;
  appToken: string;
  tableId: string;
  recordId: string;
  fieldName: string;
  attachments: BitableAttachment[];
  logID?: string;
}) {
  const requestUrl = `https://open.feishu.cn/open-apis/bitable/v1/apps/${encodeURIComponent(
    options.appToken
  )}/tables/${encodeURIComponent(options.tableId)}/records/${encodeURIComponent(options.recordId)}`;
  const body = {
    fields: {
      [options.fieldName]: options.attachments.map((item) => ({
        file_token: item.file_token,
        name: item.name
      }))
    }
  };
  const bodyText = JSON.stringify(body);

  console.log(
    JSON.stringify({
      type: "feishu_bitable_record_write_request",
      logID: options.logID,
      requestUrl,
      method: "PUT",
      headers: {
        Authorization: maskBearerToken(options.tenantToken),
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      bodySummary: {
        fieldName: options.fieldName,
        attachmentCount: options.attachments.length,
        attachments: options.attachments.map((item) => ({
          name: item.name,
          fileToken: maskValue(item.file_token)
        }))
      }
    })
  );

  const response = await options.fetchImpl(requestUrl, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${options.tenantToken}`,
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: bodyText
  });

  console.log(
    JSON.stringify({
      type: "feishu_bitable_record_write_http_response",
      logID: options.logID,
      requestUrl,
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      headers: summarizeResponseHeaders(response)
    })
  );

  await assertFeishuResponse(response, "updateBitableRecordAttachments", requestUrl);
  const payload = await response.json();
  console.log(
    JSON.stringify({
      type: "feishu_bitable_record_write_response",
      logID: options.logID,
      responseKeys: Object.keys(payload ?? {}),
      code: payload?.code,
      msg: payload?.msg,
      dataKeys: Object.keys(payload?.data ?? {})
    })
  );

  if (payload?.code !== 0) {
    throw new FieldMappedError(FieldCode.InvalidArgument, `写回多维表格记录失败：${safeStringify(payload)}`);
  }
}

function buildMultipartBody(
  parts: Array<{
    name: string;
    value: string | Buffer;
    fileName?: string;
    mimeType?: string;
  }>
) {
  const boundary = `----basekit-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const buffers: Buffer[] = [];

  for (const part of parts) {
    buffers.push(Buffer.from(`--${boundary}\r\n`));
    if (Buffer.isBuffer(part.value)) {
      buffers.push(
        Buffer.from(
          `Content-Disposition: form-data; name="${escapeMultipartValue(part.name)}"; filename="${escapeMultipartValue(
            part.fileName ?? "file"
          )}"\r\nContent-Type: ${part.mimeType ?? "application/octet-stream"}\r\n\r\n`
        )
      );
      buffers.push(part.value);
      buffers.push(Buffer.from("\r\n"));
    } else {
      buffers.push(
        Buffer.from(
          `Content-Disposition: form-data; name="${escapeMultipartValue(part.name)}"\r\n\r\n${part.value}\r\n`
        )
      );
    }
  }

  buffers.push(Buffer.from(`--${boundary}--\r\n`));

  return {
    body: Buffer.concat(buffers),
    contentType: `multipart/form-data; boundary=${boundary}`
  };
}

function escapeMultipartValue(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function decodeBase64Image(value: string) {
  const raw = value.includes(",") ? value.split(",", 2)[1] : value;
  if (!raw) {
    throw new FieldMappedError(FieldCode.Error, "生图接口返回的 b64_json 为空");
  }
  return Buffer.from(raw, "base64");
}

function isDataImageUrl(value: string) {
  return /^data:image\/[a-z0-9.+-]+;base64,/i.test(value);
}

function getEffectiveAppToken(params: Pick<ReturnType<typeof normalizeParams>, "feishuAppToken">, context: ExecuteContext) {
  return params.feishuAppToken || context.app?.token || context.bitable?.token || context.token || context.baseToken || "";
}

function getEffectiveTableId(params: Pick<ReturnType<typeof normalizeParams>, "writeBackTableId">, context: ExecuteContext) {
  return (
    params.writeBackTableId ||
    context.tableID ||
    context.tableId ||
    context.bitable?.tableID ||
    context.bitable?.tableId ||
    context.app?.trigger?.tableID ||
    context.app?.trigger?.tableId ||
    parseIdsFromPossibleUrls(context).tableId ||
    ""
  );
}

function getEffectiveRecordId(params: Pick<ReturnType<typeof normalizeParams>, "writeBackRecordId">, context: ExecuteContext) {
  return (
    params.writeBackRecordId ||
    context.recordID ||
    context.recordId ||
    context.bitable?.recordID ||
    context.bitable?.recordId ||
    context.app?.recordID ||
    context.app?.recordId ||
    context.app?.trigger?.recordID ||
    context.app?.trigger?.recordId ||
    parseIdsFromPossibleUrls(context).recordId ||
    ""
  );
}

function getEffectiveFieldId(context: ExecuteContext) {
  return (
    context.fieldID ||
    context.fieldId ||
    context.bitable?.fieldID ||
    context.bitable?.fieldId ||
    context.app?.fieldID ||
    context.app?.fieldId ||
    context.app?.trigger?.fieldID ||
    context.app?.trigger?.fieldId ||
    parseIdsFromPossibleUrls(context).fieldId ||
    ""
  );
}

function parseIdsFromPossibleUrls(context: ExecuteContext) {
  const fromRecordUrl = extractIdsFromUrl(context.recordURL);
  const fromBaseUrl = extractIdsFromUrl(context.baseURL);

  return {
    tableId: fromRecordUrl.tableId || fromBaseUrl.tableId || "",
    recordId: fromRecordUrl.recordId || fromBaseUrl.recordId || "",
    fieldId: fromRecordUrl.fieldId || fromBaseUrl.fieldId || ""
  };
}

function extractIdsFromUrl(url?: string) {
  if (!url) {
    return {
      tableId: "",
      recordId: "",
      fieldId: ""
    };
  }

  try {
    const parsed = new URL(url);
    const tableId = parsed.searchParams.get("table") || "";
    const recordId = parsed.searchParams.get("record") || "";
    const fieldId = parsed.searchParams.get("field") || "";

    return {
      tableId,
      recordId,
      fieldId
    };
  } catch {
    return {
      tableId: "",
      recordId: "",
      fieldId: ""
    };
  }
}

function mimeTypeFromOutputFormat(outputFormat: string) {
  const normalized = outputFormat.toLowerCase();
  if (normalized === "jpg" || normalized === "jpeg") {
    return "image/jpeg";
  }
  if (normalized === "webp") {
    return "image/webp";
  }
  return "image/png";
}

function buildFeishuDownloadUrl(fileToken: string) {
  return `https://open.feishu.cn/open-apis/drive/v1/medias/${encodeURIComponent(fileToken)}/download`;
}

function buildFeishuTmpDownloadUrl(fileToken: string) {
  return `https://open.feishu.cn/open-apis/drive/v1/medias/batch_get_tmp_download_url?file_tokens=${encodeURIComponent(fileToken)}`;
}

async function assertFeishuResponse(response: Response, phase: string, target: string) {
  if (response.ok) {
    return;
  }

  const message = await parseProviderError(response);
  console.log(
    JSON.stringify({
      type: "feishu_upload_error",
      phase,
      target,
      status: response.status,
      message
    })
  );
  throw new FieldMappedError(mapStatusToFieldCode(response.status), `飞书接口调用失败：${message}`);
}

async function assertProviderResponse(response: Response, phase: string, target: string) {
  if (response.ok) {
    return;
  }

  const message = await parseProviderError(response);
  console.log(
    JSON.stringify({
      type: "yunwu_provider_error",
      phase,
      target,
      status: response.status,
      message
    })
  );
  throw new FieldMappedError(mapStatusToFieldCode(response.status), `云雾接口调用失败：${message}`);
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

function extractDirectImages(payload: any): Array<Pick<GeneratedImage, "content" | "contentType">> {
  if (!Array.isArray(payload?.data)) {
    return [];
  }

  return payload.data
    .map((image: any) => {
      if (typeof image?.url === "string" && image.url.length > 0) {
        if (isDataImageUrl(image.url)) {
          return {
            content: image.url,
            contentType: "b64" as const
          };
        }
        return {
          content: image.url,
          contentType: "url" as const
        };
      }
      if (typeof image?.b64_json === "string" && image.b64_json.length > 0) {
        return {
          content: image.b64_json,
          contentType: "b64" as const
        };
      }
      return null;
    })
    .filter((image: unknown): image is Pick<GeneratedImage, "content" | "contentType"> => Boolean(image));
}

function normalizeProviderSize(size: string) {
  if (size === "auto") {
    return "auto";
  }

  if (/^\d+x\d+$/i.test(size)) {
    return size.toLowerCase();
  }

  const [width, height] = size.split(":").map((value) => Number.parseFloat(value));
  if (Number.isFinite(width) && Number.isFinite(height)) {
    if (width > height) {
      return "1536x1024";
    }
    if (height > width) {
      return "1024x1536";
    }
  }

  return "1024x1024";
}

function normalizeDirectSize(size: string) {
  return normalizeProviderSize(size);
}

function toAttachment(
  url: string,
  sourceId: string,
  index: number,
  outputFormat: string,
  model: string
): GeneratedAttachment {
  return {
    name: `${sanitizeFilePart(model)}-${sanitizeFilePart(sourceId)}-${index + 1}.${outputFormat}`,
    content: url,
    contentType: "attachment/url"
  };
}

function inferMimeType(name = "") {
  const lowerName = name.toLowerCase();
  if (lowerName.endsWith(".jpg") || lowerName.endsWith(".jpeg")) {
    return "image/jpeg";
  }
  if (lowerName.endsWith(".webp")) {
    return "image/webp";
  }
  return "image/png";
}

function summarizeProviderPayload(payload: any) {
  const data = Array.isArray(payload?.data) ? payload.data : [];
  return {
    payloadKeys: Object.keys(payload ?? {}),
    dataCount: data.length,
    dataItems: data.map((item: any, index: number) => ({
      index,
      keys: Object.keys(item ?? {}),
      hasUrl: typeof item?.url === "string" && item.url.length > 0,
      urlHost: typeof item?.url === "string" ? hostFromUrl(item.url) : undefined,
      hasB64Json: typeof item?.b64_json === "string" && item.b64_json.length > 0,
      b64Length: typeof item?.b64_json === "string" ? item.b64_json.length : 0,
      revisedPromptLength: typeof item?.revised_prompt === "string" ? item.revised_prompt.length : 0
    }))
  };
}

function summarizeOutputItem(item: unknown) {
  if (isBitableAttachment(item)) {
    return {
      kind: "bitable_attachment",
      name: item.name,
      fileToken: maskValue(item.file_token)
    };
  }
  if (isUploadedAttachment(item)) {
    return {
      kind: "feishu_attachment",
      name: item.name,
      attachmentToken: maskValue(item.attachmentToken),
      mimeType: item.mimeType,
      size: item.size
    };
  }
  if (isGeneratedAttachment(item)) {
    return {
      kind: "url_attachment",
      name: item.name,
      contentType: item.contentType,
      urlHost: hostFromUrl(item.content),
      urlLength: item.content.length
    };
  }
  return {
    kind: "unknown",
    type: typeof item
  };
}

function isBitableAttachment(item: unknown): item is BitableAttachment {
  return (
    typeof item === "object" &&
    item !== null &&
    typeof (item as BitableAttachment).file_token === "string" &&
    typeof (item as BitableAttachment).name === "string"
  );
}

function isUploadedAttachment(item: unknown): item is UploadedAttachment {
  return (
    typeof item === "object" &&
    item !== null &&
    typeof (item as UploadedAttachment).attachmentToken === "string" &&
    typeof (item as UploadedAttachment).mimeType === "string"
  );
}

function isGeneratedAttachment(item: unknown): item is GeneratedAttachment {
  return (
    typeof item === "object" &&
    item !== null &&
    (item as GeneratedAttachment).contentType === "attachment/url" &&
    typeof (item as GeneratedAttachment).content === "string"
  );
}

function maskValue(value: unknown) {
  if (typeof value !== "string" || value.length === 0) {
    return {
      exists: false,
      length: 0
    };
  }

  return {
    exists: true,
    length: value.length,
    prefix: value.slice(0, Math.min(4, value.length)),
    suffix: value.slice(Math.max(0, value.length - 4))
  };
}

function maskBearerToken(token: string) {
  return {
    scheme: "Bearer",
    token: maskValue(token)
  };
}

function summarizeResponseHeaders(response: Response) {
  const interestingHeaders = [
    "content-type",
    "x-tt-logid",
    "x-tt-trace-id",
    "x-ogw-ratelimit-reset"
  ];

  return interestingHeaders.reduce<Record<string, string>>((result, key) => {
    const value = response.headers.get(key);
    if (value) {
      result[key] = value;
    }
    return result;
  }, {});
}

function sanitizeFilePart(value: string) {
  return value.replace(/[^\w.-]+/g, "_");
}

function isTransientNetworkError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /socket hang up|ECONNRESET|ETIMEDOUT|EAI_AGAIN|network timeout/i.test(message);
}

function shouldRetryProviderStatus(status: number) {
  return status === 502 || status === 503 || status === 504;
}

function logDirectRequest(requestUrl: string, body: Record<string, unknown>, bodyLength: number) {
  const images = Array.isArray(body.image) ? body.image : [];
  console.log(
    JSON.stringify({
      type: "yunwu_direct_request",
      requestUrl,
      model: body.model,
      prompt: body.prompt,
      size: body.size,
      n: body.n,
      bodyLength,
      imageMode: images.length > 0 ? "url" : "none",
      imageCount: images.length,
      imageHosts: images.map((url) => hostFromUrl(String(url))),
      imageUrls: images.map((url) => String(url))
    })
  );
}

function hostFromUrl(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return "invalid-url";
  }
}

function sleep(ms: number) {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withLogId(message: string, logID?: string) {
  return logID ? `${message} (logID: ${logID})` : message;
}

function debugLog(context: ExecuteContext, event: string, data: Record<string, unknown>) {
  console.log(
    JSON.stringify({
      type: "generate_image_img",
      event,
      logID: context.logID,
      ...data
    })
  );
}

function redactParamsForLog(params: ExecuteParams) {
  return {
    promptLength: String(params.prompt ?? "").length,
    promptType: Array.isArray(params.prompt) ? "array" : typeof params.prompt,
    promptPreview: summarizePromptInput(params.prompt),
    model: selectToString(params.model, DEFAULT_MODEL),
    referenceImageCount: normalizeReferenceImages(params.referenceImages).length,
    size: selectToString(params.size, DEFAULT_SIZE),
    customSize: params.customSize,
    resolution: selectToString(params.resolution, DEFAULT_RESOLUTION),
    imageCount: params.imageCount,
    outputFormat: selectToString(params.outputFormat, DEFAULT_OUTPUT_FORMAT),
    officialFallback: params.officialFallback
  };
}

function summarizePromptInput(value: unknown) {
  if (typeof value === "string") {
    return value.slice(0, 120);
  }

  try {
    return JSON.stringify(value).slice(0, 300);
  } catch {
    return String(value);
  }
}

function summarizeReferenceAttachment(attachment: ReferenceAttachment) {
  return {
    name: attachment.name ?? "",
    type: attachment.type ?? attachment.mimeType ?? "",
    hasTmpUrl: typeof attachment.tmp_url === "string" && attachment.tmp_url.length > 0,
    hasUrl: typeof attachment.url === "string" && attachment.url.length > 0,
    keys: Object.keys(attachment)
  };
}

function safeStringify(value: unknown) {
  const seen = new WeakSet<object>();

  try {
    return JSON.stringify(value, (_key, currentValue) => {
      if (typeof currentValue === "function") {
        return `[Function ${currentValue.name || "anonymous"}]`;
      }

      if (typeof currentValue === "object" && currentValue !== null) {
        if (seen.has(currentValue)) {
          return "[Circular]";
        }
        seen.add(currentValue);
      }

      return currentValue;
    });
  } catch (error) {
    return `[StringifyError] ${error instanceof Error ? error.message : String(error)}`;
  }
}
