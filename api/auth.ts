import apiClient, { assertAxiosSuccess, logApiError } from "./client";
import { LoginRequest, LoginResponse } from "./types";

export interface RefreshRequest {
  refreshToken?: string;
}

export const loginMember = async (payload: LoginRequest) => {
  try {
    const response = await apiClient.post<LoginResponse | Record<string, any>>(
      "/api/auth/member/login",
      payload,
    );
    return assertAxiosSuccess(response, "loginMember");
  } catch (error) {
    throw logApiError("loginMember", error);
  }
};

export const logoutUser = async () => {
  try {
    const response = await apiClient.post("/api/auth/logout/user");
    return assertAxiosSuccess(response, "logoutUser");
  } catch (error) {
    throw logApiError("logoutUser", error);
  }
};

export const logoutGeneric = async () => {
  try {
    const response = await apiClient.post("/api/auth/logout");
    return assertAxiosSuccess(response, "logoutGeneric");
  } catch (error) {
    throw logApiError("logoutGeneric", error);
  }
};

export const refreshAuth = async (payload?: RefreshRequest) => {
  try {
    const response = await apiClient.post("/api/auth/refresh", payload ?? {});
    return assertAxiosSuccess(response, "refreshAuth");
  } catch (error) {
    throw logApiError("refreshAuth", error);
  }
};
