import { reaction } from "mobx";
import { useCallback, useEffect, useReducer } from "react";
import { loginMember } from "../api/auth";
import { API_BASE_URL } from "../api/client";
import { LoginRequest } from "../api/types";
import authStore from "../store/auth";

/** Force a re-render so we can re-read the MobX store snapshot */
const useForceUpdate = () => {
  const [, forceRender] = useReducer((s: number) => s + 1, 0);
  return forceRender;
};

export const useAuth = () => {
  const forceUpdate = useForceUpdate();
  const [loading, setLoadingRaw] = useReducer(
    (_: boolean, v: boolean) => v,
    false,
  );
  const [error, setErrorRaw] = useReducer(
    (_: string | null, v: string | null) => v,
    null as string | null,
  );

  // Keep local setters that won't trigger the MobX subscription
  const setLoading = useCallback((v: boolean) => setLoadingRaw(v), []);
  const setError = useCallback((v: string | null) => setErrorRaw(v), []);

  useEffect(() => {
    authStore.initializeAuth();
  }, []);

  // Re-render whenever any relevant MobX observable changes
  useEffect(() => {
    const dispose = reaction(
      () => ({
        h: authStore.isHydrated,
        u: authStore.user,
        t: authStore.token,
        a: authStore.isAuthenticated,
      }),
      () => forceUpdate(),
    );
    return dispose;
  }, [forceUpdate]);

  const login = async (credentials: LoginRequest) => {
    setLoading(true);
    setError(null);
    try {
      const response = await loginMember(credentials);
      console.log("[Auth][login] Response received", {
        baseURL: API_BASE_URL,
        status: response?.status ?? null,
      });

      const body =
        response?.data && typeof response.data === "object"
          ? (response.data as Record<string, any>)
          : {};
      const nested =
        (body?.data as Record<string, any> | undefined) ??
        (body?.result as Record<string, any> | undefined) ??
        {};

      const tokenFromBody =
        body?.token ??
        body?.accessToken ??
        body?.authToken ??
        nested?.token ??
        nested?.accessToken ??
        nested?.authToken;

      const authHeader =
        (response.headers?.authorization as string | undefined) ??
        (response.headers?.Authorization as string | undefined);
      const tokenFromHeader = authHeader?.startsWith("Bearer ")
        ? authHeader.replace("Bearer ", "")
        : authHeader;

      const token = tokenFromBody ?? tokenFromHeader ?? null;

      const userSource =
        body?.user ??
        body?.member ??
        body?.driver ??
        body?.profile ??
        nested?.user ??
        nested?.member ??
        nested?.driver ??
        nested?.profile ??
        null;

      const normalizedUser = {
        id:
          userSource?.id ??
          userSource?.memberId ??
          userSource?._id ??
          credentials.memberId,
        name:
          userSource?.name ??
          userSource?.fullName ??
          userSource?.memberName ??
          credentials.memberId,
        role: userSource?.role ?? credentials.role,
      };

      if (!normalizedUser.id || !normalizedUser.role) {
        const message = "Invalid login response from server";
        setError(message);
        return { success: false as const, error: message };
      }

      if (token) {
        await authStore.setToken(token);
      }
      await authStore.setUser(normalizedUser);
      return { success: true as const, data: response.data };
    } catch (err: any) {
      console.error("[Auth][login] Failed", {
        baseURL: API_BASE_URL,
        error: err,
      });
      const message =
        err.response?.data?.message ||
        (err.request && !err.response
          ? `Cannot reach backend server at ${API_BASE_URL}. Ensure backend listens on 0.0.0.0:3000 and phone + laptop are on same Wi-Fi.`
          : "Login failed");
      setError(message);
      return { success: false as const, error: message };
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    await authStore.clearAuth();
  };

  return {
    login,
    logout,
    loading,
    error,
    user: authStore.user,
    token: authStore.token,
    isAuthenticated: authStore.isAuthenticated,
    isHydrated: authStore.isHydrated,
  };
};
