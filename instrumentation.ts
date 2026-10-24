import { logs } from "@opentelemetry/api-logs"
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http"
import { resourceFromAttributes } from "@opentelemetry/resources"
import { BatchLogRecordProcessor, LoggerProvider } from "@opentelemetry/sdk-logs"

const posthogKey = process.env.NEXT_PUBLIC_POSTHOG_KEY
const posthogHost = process.env.NEXT_PUBLIC_POSTHOG_HOST
const isPostHogConfigured = Boolean(posthogKey && posthogHost)

export const loggerProvider = new LoggerProvider({
  resource: resourceFromAttributes({ "service.name": "hallway-hunter" }),
  processors: isPostHogConfigured
    ? [
        new BatchLogRecordProcessor({
          exporter: new OTLPLogExporter({
            url: `${posthogHost}/i/v1/logs`,
            headers: {
              Authorization: `Bearer ${posthogKey}`,
              "Content-Type": "application/json",
            },
          }),
        }),
      ]
    : [],
})

// Keep this logger separate so only records introduced for PostHog Logs leave the app.
export const posthogLogsLogger = loggerProvider.getLogger("hallway-hunter-posthog")

export function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return

  // PostHog is optional: without its env vars the app runs and sends nothing.

  logs.setGlobalLoggerProvider(loggerProvider)
}
