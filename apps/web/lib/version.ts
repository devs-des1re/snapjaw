import packageJson from "@/package.json";

// Reported by every API response so clients can tell builds apart.
export const APP_VERSION: string = packageJson.version;
