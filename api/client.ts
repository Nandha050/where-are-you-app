import axios, { AxiosError, AxiosResponse } from "axios";
import { Platform } from "react-native";
import { addSentryBreadcrumb, captureSentryException } from "../monitoring/sentry";
import authStore from "../store/auth";

const BASE_URL = String(process.env.EXPO_PUBLIC_BACKEND_URL ?? "").trim();
const API_TIMEOUT = Number(process.env.EXPO_PUBLIC_API_TIMEOUT || 10000);
const ENABLE_API_DEBUG_LOGS =
  process.env.EXPO_PUBLIC_ENABLE_API_DEBUG_LOGS === "1" || __DEV__;

const isSuccessfulStatus = (status?: number): boolean => {
  if (typeof status !== "number") {
    return false;
  }

  return status >= 200 && status < 300;
};

const shouldAttemptJsonParse = (value: string): boolean => {
  const normalized = value.trim();
  if (!normalized.length) {
    return false;
  }

  return normalized.startsWith("{") || normalized.startsWith("[");
};

const tryParseJsonString = (value: string): unknown => {
  if (!shouldAttemptJsonParse(value)) {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

const normalizeResponseData = (value: unknown, depth = 0): unknown => {
  if (depth > 6 || value == null) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = tryParseJsonString(value);
    if (parsed === value) {
      return value;
    }

    return normalizeResponseData(parsed, depth + 1);
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeResponseData(item, depth + 1));
  }

  if (typeof value === "object") {
    const normalized: Record<string, unknown> = {};
    Object.entries(value as Record<string, unknown>).forEach(([key, item]) => {
      normalized[key] = normalizeResponseData(item, depth + 1);
    });
    return normalized;
  }

  return value;
};

const toSerializablePayload = (value: unknown): unknown => {
  if (value == null) {
    return value;
  }

  if (typeof value === "string") {
    return value.length > 500 ? `${value.slice(0, 500)}...` : value;
  }

  if (typeof value !== "object") {
    return value;
  }

  try {
    const serialized = JSON.stringify(value);
    if (!serialized) {
      return value;
    }

    if (serialized.length > 2000) {
      return `${serialized.slice(0, 2000)}...`;
    }

    return JSON.parse(serialized);
  } catch {
    return "[Unserializable payload]";
  }
};

const toLogPreview = (value: unknown, depth = 0): unknown => {
  if (value == null) {
    return value;
  }

  if (depth >= 2) {
    if (Array.isArray(value)) {
      return `[Array(${value.length})]`;
    }

    if (typeof value === "object") {
      return "[Object]";
    }

    return value;
  }

  if (typeof value === "string") {
    return value.length > 200 ? `${value.slice(0, 200)}...` : value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (Array.isArray(value)) {
    const preview = value.slice(0, 3).map((item) => toLogPreview(item, depth + 1));
    return {
      type: "array",
      length: value.length,
      preview,
    };
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    const limited = entries.slice(0, 8);
    const mapped: Record<string, unknown> = {};

    limited.forEach(([key, item]) => {
      mapped[key] = toLogPreview(item, depth + 1);
    });

    if (entries.length > limited.length) {
      mapped.__truncatedKeys = entries.length - limited.length;
    }

    return mapped;
  }

  return String(value);
};

const buildFullUrl = (baseURL?: string, path?: string): string => {
  if (!path) {
    return baseURL ?? "";
  }

  if (/^https?:\/\//i.test(path)) {
    return path;
  }

  if (!baseURL) {
    return path;
  }

  const normalizedBase = baseURL.endsWith("/")
    ? baseURL.slice(0, -1)
    : baseURL;
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;

  return `${normalizedBase}${normalizedPath}`;
};

const extractApiErrorMessage = (error: unknown): string => {
  const axiosError = error as AxiosError<any>;
  const normalizedData = normalizeResponseData(axiosError?.response?.data) as
    | { message?: unknown }
    | undefined;
  const serverMessage = normalizedData?.message;

  if (typeof serverMessage === "string" && serverMessage.trim().length) {
    return serverMessage;
  }

  if (typeof axiosError?.message === "string" && axiosError.message.trim().length) {
    return axiosError.message;
  }

  return "Unknown API error";
};

export const API_BASE_URL = BASE_URL;
const didLogApiConfig = { value: false };

const logApiConfig = () => {
  if (didLogApiConfig.value) {
    return;
  }

  didLogApiConfig.value = true;

  console.log("[API][config]", {
    EXPO_PUBLIC_BACKEND_URL:
      process.env.EXPO_PUBLIC_BACKEND_URL ?? "undefined",
    EXPO_PUBLIC_API_TIMEOUT: process.env.EXPO_PUBLIC_API_TIMEOUT ?? "undefined",
    EXPO_PUBLIC_ENABLE_API_DEBUG_LOGS:
      process.env.EXPO_PUBLIC_ENABLE_API_DEBUG_LOGS ?? "undefined",
    resolvedBaseURL: API_BASE_URL || "undefined",
    platform: Platform.OS,
  });

  if (!API_BASE_URL) {
    console.error(
      "[API][config] EXPO_PUBLIC_BACKEND_URL is missing. Configure it in your .env and EAS profile env.",
    );
  }
};

logApiConfig();

const isLocalhostApiUrl = (value: string): boolean => {
  try {
    const parsed = new URL(value);
    return parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  } catch {
    return false;
  }
};

export const assertAxiosSuccess = <T>(
  response: AxiosResponse<T>,
  scope: string,
): AxiosResponse<T> => {
  if (isSuccessfulStatus(response.status)) {
    return response;
  }

  const message = `[API][${scope}] Non-success response status ${response.status}`;
  console.error(message, {
    status: response.status,
    url: buildFullUrl(response.config?.baseURL, response.config?.url),
    data: toSerializablePayload(response.data),
  });

  captureSentryException(new Error(message), {
    tags: {
      area: "api",
      scope,
      status: response.status,
    },
    extra: {
      url: buildFullUrl(response.config?.baseURL, response.config?.url),
      method: response.config?.method?.toUpperCase() ?? null,
      responseData: toSerializablePayload(response.data),
    },
    level: "error",
  });

  throw new Error(message);
};

export const logApiError = (scope: string, error: unknown): Error => {
  const axiosError = error as AxiosError<any>;
  const responseStatus = axiosError?.response?.status;
  const normalizedResponseData = normalizeResponseData(axiosError?.response?.data);
  const requestUrl = buildFullUrl(
    axiosError?.config?.baseURL,
    axiosError?.config?.url,
  );

  console.error(`[API][${scope}] ${extractApiErrorMessage(error)}`, {
    status: responseStatus ?? null,
    method: axiosError?.config?.method?.toUpperCase() ?? null,
    url: requestUrl || null,
    requestData: toSerializablePayload(axiosError?.config?.data),
    responseData: toSerializablePayload(normalizedResponseData),
    code: axiosError?.code ?? null,
  });

  captureSentryException(error, {
    tags: {
      area: "api",
      scope,
      status: responseStatus ?? "unknown",
      method: axiosError?.config?.method?.toUpperCase() ?? "unknown",
    },
    extra: {
      url: requestUrl || null,
      requestData: toSerializablePayload(axiosError?.config?.data),
      responseData: toSerializablePayload(normalizedResponseData),
      code: axiosError?.code ?? null,
      backendUrl: API_BASE_URL || null,
    },
    level: "error",
  });

  if (error instanceof Error) {
    return error;
  }

  return new Error(extractApiErrorMessage(error));
};

const apiClient = axios.create({
  baseURL: API_BASE_URL || undefined,
  timeout: API_TIMEOUT,
  headers: {
    "Content-Type": "application/json",
  },
});

apiClient.interceptors.request.use((config) => {
  if (!API_BASE_URL) {
    const configError = new Error(
      "EXPO_PUBLIC_BACKEND_URL is missing. Aborting API request.",
    );
    console.error("[API][config]", {
      message: configError.message,
      requestedPath: config.url ?? null,
      platform: Platform.OS,
    });

    captureSentryException(configError, {
      tags: {
        area: "api",
        stage: "request_config",
      },
      extra: {
        requestedPath: config.url ?? null,
        platform: Platform.OS,
      },
      level: "error",
    });

    return Promise.reject(configError);
  }

  if (!__DEV__ && isLocalhostApiUrl(API_BASE_URL)) {
    const localhostError = new Error(
      "Invalid EXPO_PUBLIC_BACKEND_URL for release build: localhost is not reachable on device.",
    );
    console.error("[API][config]", {
      message: localhostError.message,
      backendUrl: API_BASE_URL,
      platform: Platform.OS,
    });

    captureSentryException(localhostError, {
      tags: {
        area: "api",
        stage: "request_config",
      },
      extra: {
        backendUrl: API_BASE_URL,
        platform: Platform.OS,
      },
      level: "warning",
    });

    return Promise.reject(localhostError);
  }

  config.baseURL = API_BASE_URL;

  const requestUrl = buildFullUrl(config.baseURL ?? API_BASE_URL, config.url);
  const method = (config.method ?? "get").toUpperCase();

  addSentryBreadcrumb({
    category: "api",
    message: `${method} ${requestUrl || "(empty)"}`,
    level: "info",
    data: {
      timeout: config.timeout ?? API_TIMEOUT,
      hasAuthToken: Boolean(authStore.token),
    },
  });

  if (ENABLE_API_DEBUG_LOGS) {
    console.log("[API][request]", {
      method,
      url: requestUrl || "(empty)",
      timeout: config.timeout ?? API_TIMEOUT,
      hasAuthToken: Boolean(authStore.token),
      params: toLogPreview(config.params),
      data: toLogPreview(config.data),
    });
  }

  if (authStore.token) {
    if (typeof (config.headers as any)?.set === "function") {
      (config.headers as any).set("Authorization", `Bearer ${authStore.token}`);
    } else {
      const nextHeaders = (config.headers ?? {}) as Record<string, string>;
      nextHeaders.Authorization = `Bearer ${authStore.token}`;
      config.headers = nextHeaders as any;
    }
  }

  return config;
}, (error) => {
  console.error("[API][request][error]", {
    message: extractApiErrorMessage(error),
  });

  captureSentryException(error, {
    tags: {
      area: "api",
      stage: "request",
    },
    extra: {
      message: extractApiErrorMessage(error),
    },
    level: "error",
  });

  return Promise.reject(error);
});

apiClient.interceptors.response.use(
  (response) => {
    const normalizedData = normalizeResponseData(response.data);
    (response as AxiosResponse<any>).data = normalizedData;

    if (ENABLE_API_DEBUG_LOGS) {
      console.log("[API][response]", {
        status: response.status,
        method: response.config?.method?.toUpperCase() ?? null,
        url: buildFullUrl(response.config?.baseURL, response.config?.url),
        data: toLogPreview(normalizedData),
      });
    }

    addSentryBreadcrumb({
      category: "api",
      message: `Response ${response.status}`,
      level: "info",
      data: {
        method: response.config?.method?.toUpperCase() ?? null,
        url: buildFullUrl(response.config?.baseURL, response.config?.url),
      },
    });

    if (!isSuccessfulStatus(response.status)) {
      const message = `[API][response] Unexpected status ${response.status}`;
      console.error(message, {
        url: buildFullUrl(response.config?.baseURL, response.config?.url),
      });

      captureSentryException(new Error(message), {
        tags: {
          area: "api",
          stage: "response",
          status: response.status,
        },
        extra: {
          method: response.config?.method?.toUpperCase() ?? null,
          url: buildFullUrl(response.config?.baseURL, response.config?.url),
        },
      });

      return Promise.reject(new Error(message));
    }

    return response;
  },
  async (error) => {
    const axiosError = error as AxiosError<any>;
    const status = axiosError?.response?.status;
    const normalizedErrorData = normalizeResponseData(axiosError?.response?.data);

    if (axiosError?.response) {
      axiosError.response.data = normalizedErrorData as any;
    }

    console.error("[API][response][error]", {
      message: extractApiErrorMessage(error),
      status: status ?? null,
      method: axiosError?.config?.method?.toUpperCase() ?? null,
      url: buildFullUrl(axiosError?.config?.baseURL, axiosError?.config?.url),
      responseData: toSerializablePayload(normalizedErrorData),
      code: axiosError?.code ?? null,
    });

    captureSentryException(error, {
      tags: {
        area: "api",
        stage: "response",
        status: status ?? "unknown",
        method: axiosError?.config?.method?.toUpperCase() ?? "unknown",
      },
      extra: {
        url: buildFullUrl(axiosError?.config?.baseURL, axiosError?.config?.url),
        responseData: toSerializablePayload(normalizedErrorData),
        code: axiosError?.code ?? null,
      },
      level: "error",
    });

    if (axiosError?.request && !axiosError?.response) {
      console.error("[API][network] Backend unreachable or timed out", {
        baseURL: API_BASE_URL || "undefined",
      });
    }

    if (axiosError?.response?.status === 401) {
      await authStore.clearAuth();
    }

    return Promise.reject(error);
  },
);

export default apiClient;
