import pino from "pino";

const isProd = process.env.NODE_ENV === "production";
const level = process.env.LOG_LEVEL ?? (isProd ? "info" : "debug");

export const logger = pino({
  level,
  formatters: {
    log(obj) {
      for (const k in obj) if (typeof obj[k] === "bigint") obj[k] = (obj[k] as bigint).toString();
      return obj;
    },
  },
  ...(isProd
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "SYS:HH:MM:ss.l", ignore: "pid,hostname" },
        },
      }),
});

export function createLogger(mod: string) {
  return logger.child({ mod });
}
