import * as Sentry from "@sentry/react-native";

type BreadcrumbLevel = "fatal" | "error" | "warning" | "log" | "info" | "debug";

type CaptureContext = {
  tags?: Record<string, string | number | boolean | null | undefined>;
  extra?: Record<string, unknown>;
  level?: Sentry.SeverityLevel;
};

type TraceOptions = {
  name: string;
  op: string;
  data?: Record<string, unknown>;
};

const SENSITIVE_KEY_PATTERN =
  /(token|password|authorization|cookie|secret|api[-_]?key|refresh|fcm)/i;

const truncate = (value: string, max = 400): string => {
  if (value.length <= max) {
    return value;
  }

  return `${value.slice(0, max)}...`;
};

const sanitizeValue = (value: unknown, depth = 0): unknown => {
  if (depth > 5 || value == null) {
    return value;
  }

  if (typeof value === "string") {
    return truncate(value);
  }

  if (Array.isArray(value)) {
    return value.slice(0, 25).map((item) => sanitizeValue(item, depth + 1));
  }

  if (typeof value === "object") {
    const output: Record<string, unknown> = {};
    Object.entries(value as Record<string, unknown>).forEach(([key, item]) => {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        output[key] = "[Filtered]";
        return;
      }

      output[key] = sanitizeValue(item, depth + 1);
    });
    return output;
  }

  return value;
};

const normalizeError = (error: unknown): Error => {
  if (error instanceof Error) {
    return error;
  }

  if (typeof error === "string") {
    return new Error(error);
  }

  return new Error("Unknown error");
};

const sanitizeTags = (
  tags: CaptureContext["tags"],
): Record<string, string> | undefined => {
  if (!tags) {
    return undefined;
  }

  const entries = Object.entries(tags)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => [key, String(value)] as const);

  if (!entries.length) {
    return undefined;
  }

  return Object.fromEntries(entries);
};

export const addSentryBreadcrumb = (args: {
  category: string;
  message: string;
  level?: BreadcrumbLevel;
  data?: Record<string, unknown>;
  type?: string;
}) => {
  Sentry.addBreadcrumb({
    category: args.category,
    message: args.message,
    level: args.level ?? "info",
    type: args.type,
    data: args.data
      ? (sanitizeValue(args.data) as Record<string, unknown>)
      : undefined,
    timestamp: Date.now() / 1000,
  });
};

export const captureSentryException = (
  error: unknown,
  context?: CaptureContext,
): string => {
  const normalizedError = normalizeError(error);
  let eventId = "";

  Sentry.withScope((scope: any) => {
    const tags = sanitizeTags(context?.tags);
    if (tags) {
      scope.setTags(tags);
    }

    if (context?.extra) {
      scope.setExtras(sanitizeValue(context.extra) as Record<string, unknown>);
    }

    if (context?.level) {
      scope.setLevel(context.level);
    }

    eventId = Sentry.captureException(normalizedError);
  });

  return eventId;
};

export const captureSentryMessage = (
  message: string,
  context?: CaptureContext,
): string => {
  let eventId = "";

  Sentry.withScope((scope: any) => {
    const tags = sanitizeTags(context?.tags);
    if (tags) {
      scope.setTags(tags);
    }

    if (context?.extra) {
      scope.setExtras(sanitizeValue(context.extra) as Record<string, unknown>);
    }

    if (context?.level) {
      scope.setLevel(context.level);
    }

    eventId = Sentry.captureMessage(message);
  });

  return eventId;
};

export const setSentryUserContext = (user: {
  id: string;
  username?: string;
  role?: string;
}) => {
  Sentry.setUser({
    id: String(user.id),
    username: user.username ? String(user.username) : undefined,
    role: user.role ? String(user.role) : undefined,
  });

  addSentryBreadcrumb({
    category: "auth",
    message: "Sentry user context set",
    level: "info",
    data: {
      userId: user.id,
      role: user.role ?? null,
    },
  });
};

export const clearSentryUserContext = () => {
  Sentry.setUser(null);

  addSentryBreadcrumb({
    category: "auth",
    message: "Sentry user context cleared",
    level: "info",
  });
};

export const withSentrySpan = async <T>(
  options: TraceOptions,
  callback: () => Promise<T>,
): Promise<T> => {
  if (options.data) {
    addSentryBreadcrumb({
      category: "performance",
      message: `Span started: ${options.name}`,
      level: "debug",
      data: options.data,
    });
  }

  return Sentry.startSpan(
    {
      name: options.name,
      op: options.op,
    },
    callback,
  );
};

export const setupSentryGlobalHandlers = () => {
  const globalRef = globalThis as any;

  if (globalRef.__SENTRY_GLOBAL_HANDLERS_INSTALLED__) {
    return;
  }

  globalRef.__SENTRY_GLOBAL_HANDLERS_INSTALLED__ = true;

  const maybeErrorUtils = globalRef.ErrorUtils;
  if (
    maybeErrorUtils &&
    typeof maybeErrorUtils.getGlobalHandler === "function" &&
    typeof maybeErrorUtils.setGlobalHandler === "function"
  ) {
    const previousHandler = maybeErrorUtils.getGlobalHandler();
    maybeErrorUtils.setGlobalHandler((error: unknown, isFatal?: boolean) => {
      captureSentryException(error, {
        tags: {
          area: "global",
          source: "error_utils",
          fatal: Boolean(isFatal),
        },
      });

      if (typeof previousHandler === "function") {
        previousHandler(error, isFatal);
      }
    });
  }

  const previousUnhandledRejection = globalRef.onunhandledrejection;
  globalRef.onunhandledrejection = (event: { reason?: unknown }) => {
    captureSentryException(event?.reason ?? event, {
      tags: {
        area: "global",
        source: "unhandled_rejection",
      },
    });

    if (typeof previousUnhandledRejection === "function") {
      previousUnhandledRejection(event);
    }
  };
};
