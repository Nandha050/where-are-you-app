import axios from "axios";
import Constants from "expo-constants";
import { NativeModules, Platform } from "react-native";
import authStore from "../store/auth";

const RAW_API_URL =
  process.env.EXPO_PUBLIC_BACKEND_URL ||
  process.env.BACKEND_URL ||
  "https://where-are-you-km9g.onrender.com";
const RAW_API_HOST = process.env.EXPO_PUBLIC_API_HOST;
const API_TIMEOUT = Number(process.env.EXPO_PUBLIC_API_TIMEOUT || 10000);

const resolveApiUrl = () => {
  try {
    const parsed = new URL(RAW_API_URL);
    const isLocalhost =
      parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";

    if (!isLocalhost || Platform.OS === "web") {
      return RAW_API_URL;
    }

    if (RAW_API_HOST) {
      parsed.hostname = RAW_API_HOST;
      return parsed.toString();
    }

    const hostCandidates: string[] = [];

    const scriptURL = NativeModules?.SourceCode?.scriptURL as
      | string
      | undefined;
    if (scriptURL) {
      hostCandidates.push(new URL(scriptURL).hostname);
    }

    const hostUri = Constants.expoConfig?.hostUri;
    if (hostUri) {
      hostCandidates.push(hostUri.split(":")[0]);
    }

    const debuggerHost = (Constants as any)?.manifest?.debuggerHost as
      | string
      | undefined;
    if (debuggerHost) {
      hostCandidates.push(debuggerHost.split(":")[0]);
    }

    const devHost = hostCandidates.find(Boolean);
    if (devHost) {
      parsed.hostname = devHost;
      return parsed.toString();
    }

    return RAW_API_URL;
  } catch {
    return RAW_API_URL;
  }
};

export const API_BASE_URL = resolveApiUrl();

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: API_TIMEOUT,
  headers: {
    "Content-Type": "application/json",
  },
});

apiClient.interceptors.request.use((config) => {
  if (authStore.token) {
    config.headers.Authorization = `Bearer ${authStore.token}`;
  }
  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401) {
      await authStore.clearAuth();
    }
    return Promise.reject(error);
  },
);

export default apiClient;
