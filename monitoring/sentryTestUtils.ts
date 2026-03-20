import { vi } from "vitest";

export const createSentryMock = () => {
    return {
        addBreadcrumb: vi.fn(),
        captureException: vi.fn(() => "test-event-id"),
        captureMessage: vi.fn(() => "test-message-id"),
        setUser: vi.fn(),
        withScope: vi.fn((handler: (scope: any) => unknown) =>
            handler({
                setTags: vi.fn(),
                setExtras: vi.fn(),
                setLevel: vi.fn(),
            }),
        ),
        startSpan: vi.fn(async (_options: unknown, callback: () => Promise<unknown>) => callback()),
    };
};

export const createError = (message = "Synthetic test error") => {
    return new Error(message);
};
