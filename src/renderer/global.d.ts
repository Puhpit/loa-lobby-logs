import type { AppApi } from "../shared/appTypes.js";

declare global {
  interface Window {
    loaLobbyLogs: AppApi;
  }
}

export {};
