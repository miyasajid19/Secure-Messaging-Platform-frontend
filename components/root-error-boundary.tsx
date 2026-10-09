"use client";

/**
 * Top-level error boundary.
 *
 * Wraps the Providers tree in `app/layout.tsx`. If anything inside the
 * tree throws during render or commit (e.g. a hydration mismatch, a
 * misconfigured `lib/env.ts`, or a third-party component that exploded
 * during SSR), this catches it and renders a graceful fallback instead
 * of Next.js's "This page couldn't load" overlay.
 *
 * Used as the **last** line of defence — components are expected to
 * handle their own errors where possible.
 */

import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class RootErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error("[RootErrorBoundary] caught:", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <main
          className="flex min-h-screen flex-col items-center justify-center px-6 text-center"
          style={{ color: "var(--color-fg-primary)" }}
        >
          <h1 className="text-2xl font-semibold">Something went wrong</h1>
          <p
            className="mt-2 max-w-md text-sm"
            style={{ color: "var(--color-fg-secondary)" }}
          >
            The app hit an unexpected error. Reload the page to retry.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-5 inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold text-white"
            style={{ backgroundColor: "var(--color-accent)" }}
          >
            Reload
          </button>
        </main>
      );
    }
    return this.props.children;
  }
}