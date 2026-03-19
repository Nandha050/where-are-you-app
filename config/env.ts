const API_URL = String(process.env.EXPO_PUBLIC_BACKEND_URL ?? "").trim();
const API_TIMEOUT = Number(process.env.EXPO_PUBLIC_API_TIMEOUT || 10000);

const ENV = {
  API_URL,
  API_TIMEOUT,
};

export default ENV;
