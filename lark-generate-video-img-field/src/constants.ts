export const VIDEO_AUTH_ID = "video_gateway_auth";
export const YUNWU_AUTH_ID = VIDEO_AUTH_ID;

export const HAPPYHORSE_DEFAULT_BASE_URL = "https://model-router.edu-aliyun.com/v1";
export const HAPPYHORSE_GENERATIONS_ENDPOINT = "/videos/generations";

export const SEEDANCE_DEFAULT_BASE_URL = "https://agentrs.jd.com";
export const SEEDANCE_SUBMIT_ENDPOINT = "/api/saas/plugin-u/v1/exec/Multimodal-live-video";
export const SEEDANCE_QUERY_ENDPOINT = "/api/saas/plugin-u/v1/exec/query-task";

export const HAPPYHORSE_I2V_MODEL = "qwen/happyhorse-1.0-i2v";
export const HAPPYHORSE_T2V_MODEL = "qwen/happyhorse-1.0-t2v";
export const SEEDANCE_MODEL = "Doubao-Seedance-2.0";
export const DEFAULT_MODEL = HAPPYHORSE_I2V_MODEL;

export const DEFAULT_RESOLUTION = "720P";
export const DEFAULT_DURATION = 5;

export const MAX_REFERENCE_IMAGES = 8;
export const MAX_OUTPUT_ATTACHMENTS = 1;

export const INITIAL_POLL_DELAY_MS = 10_000;
export const POLL_INTERVAL_MS = 10_000;
export const TASK_TIMEOUT_MS = 180_000;
