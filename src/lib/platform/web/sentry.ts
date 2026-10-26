// Only what the reporter uses, so the lazily loaded chunk leaves the rest of the SDK behind.
export { captureException, globalHandlersIntegration, init } from "@sentry/browser";
