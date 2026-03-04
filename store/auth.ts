import * as SecureStore from "expo-secure-store";
import { makeAutoObservable, runInAction } from "mobx";
import { Platform } from "react-native";

export interface User {
  id: string;
  name: string;
  role: string;
}

class AuthStore {
  token: string | null = null;
  user: User | null = null;
  isHydrated = false;

  constructor() {
    makeAutoObservable(this);
  }

  private async getItem(key: string) {
    if (Platform.OS === "web") {
      if (typeof window === "undefined") {
        return null;
      }
      return window.localStorage.getItem(key);
    }
    return SecureStore.getItemAsync(key);
  }

  private async setItem(key: string, value: string) {
    if (Platform.OS === "web") {
      if (typeof window !== "undefined") {
        window.localStorage.setItem(key, value);
      }
      return;
    }
    await SecureStore.setItemAsync(key, value);
  }

  private async removeItem(key: string) {
    if (Platform.OS === "web") {
      if (typeof window !== "undefined") {
        window.localStorage.removeItem(key);
      }
      return;
    }
    await SecureStore.deleteItemAsync(key);
  }

  async initializeAuth() {
    if (this.isHydrated) {
      return;
    }

    try {
      const token = await this.getItem("authToken");
      const rawUser = await this.getItem("authUser");

      // Batch all mutations so MobX fires only ONE notification
      runInAction(() => {
        if (token) this.token = token;
        if (rawUser) this.user = JSON.parse(rawUser) as User;
        this.isHydrated = true;
      });
    } catch (error) {
      console.error("Error initializing auth:", error);
      runInAction(() => {
        this.token = null;
        this.user = null;
        this.isHydrated = true;
      });
    }
  }

  async setToken(token: string) {
    this.token = token;
    await this.setItem("authToken", token);
  }

  async setUser(user: User) {
    this.user = user;
    await this.setItem("authUser", JSON.stringify(user));
  }

  async clearAuth() {
    this.token = null;
    this.user = null;
    await this.removeItem("authToken");
    await this.removeItem("authUser");
  }

  get isAuthenticated() {
    return Boolean(this.user);
  }
}

const authStore = new AuthStore();
export default authStore;
