import { withSentrySpan } from "../monitoring/sentry";
import apiClient, { assertAxiosSuccess, logApiError } from "./client";
import { LoginRequest, LoginResponse } from "./types";

export interface RefreshRequest {
  refreshToken?: string;
}

const withApiTrace = async <T>(scope: string, handler: () => Promise<T>): Promise<T> => {
  return withSentrySpan(
    {
      op: "http.client",
      name: `api.auth:${scope}`,
    },
    handler,
  );
};

export const loginMember = async (payload: LoginRequest) => {
  return withApiTrace("loginMember", async () => {
    try {
      const response = await apiClient.post<LoginResponse | Record<string, any>>(
        "/api/auth/member/login",
        payload,
      );
      return assertAxiosSuccess(response, "loginMember");
    } catch (error) {
      throw logApiError("loginMember", error);
    }
  });
};

export const logoutUser = async () => {
  return withApiTrace("logoutUser", async () => {
    try {
      const response = await apiClient.post("/api/auth/logout/user");
      return assertAxiosSuccess(response, "logoutUser");
    } catch (error) {
      throw logApiError("logoutUser", error);
    }
  });
};

export const logoutGeneric = async () => {
  return withApiTrace("logoutGeneric", async () => {
    try {
      const response = await apiClient.post("/api/auth/logout");
      return assertAxiosSuccess(response, "logoutGeneric");
    } catch (error) {
      throw logApiError("logoutGeneric", error);
    }
  });
};

export const refreshAuth = async (payload?: RefreshRequest) => {
  return withApiTrace("refreshAuth", async () => {
    try {
      const response = await apiClient.post("/api/auth/refresh", payload ?? {});
      return assertAxiosSuccess(response, "refreshAuth");
    } catch (error) {
      throw logApiError("refreshAuth", error);
    }
  });
};
