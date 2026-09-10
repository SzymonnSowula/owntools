import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  /** Which window/module this boundary guards; goes into the log line. */
  scope: string;
  children: ReactNode;
  /** Extra buttons for the fallback (e.g. "back to owntools" in the overlay). */
  actions?: ReactNode;
  onError?: (error: Error, info: ErrorInfo) => void;
}

interface State {
  error: Error | null;
}

/**
 * Last line of defence for a render throw. Without it a single exception
 * leaves a permanently white window and the user has nothing to send us. The
 * fallback is styled inline on purpose: it has to render in all three windows,
 * including the ones that load no module CSS.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.props.onError?.(error, info);
  }

  private details(): string {
    const err = this.state.error;
    if (!err) return "";
    return `${this.props.scope}: ${err.message}\n${err.stack ?? ""}`.trim();
  }

  private copy = () => {
    const text = this.details();
    void navigator.clipboard?.writeText(text).catch(() => {
      const area = document.createElement("textarea");
      area.value = text;
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    });
  };

  render() {
    if (!this.state.error) return this.props.children;
    const message = this.state.error.message || String(this.state.error);
    return (
      <div
        role="alert"
        style={{
          minHeight: "100%",
          display: "grid",
          placeItems: "center",
          padding: 24,
          fontFamily: "Inter, system-ui, sans-serif",
          color: "#1d1d1f",
          background: "#f5f5f7",
        }}
      >
        <div
          style={{
            maxWidth: 440,
            width: "100%",
            background: "#fff",
            border: "1px solid #e3e3e6",
            borderRadius: 16,
            padding: 20,
            boxShadow: "0 12px 30px rgba(17,17,17,0.08)",
          }}
        >
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700, letterSpacing: "-0.02em" }}>
            something went wrong
          </h1>
          <p style={{ margin: "8px 0 0", fontSize: 13, color: "#6e6e73", lineHeight: 1.5 }}>
            This part of owntools crashed. Your recordings, notes and settings on disk are
            untouched. Reload to continue; if it keeps happening, copy the details and send them
            with a bug report.
          </p>
          <pre
            style={{
              margin: "12px 0 0",
              padding: 10,
              fontSize: 11,
              lineHeight: 1.4,
              background: "#f5f5f7",
              border: "1px solid #e3e3e6",
              borderRadius: 10,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              maxHeight: 140,
              overflow: "auto",
            }}
          >
            {message}
          </pre>
          <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{
                height: 34,
                padding: "0 14px",
                borderRadius: 999,
                border: 0,
                background: "#0a84ff",
                color: "#fff",
                fontWeight: 600,
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              Reload
            </button>
            <button
              type="button"
              onClick={this.copy}
              style={{
                height: 34,
                padding: "0 14px",
                borderRadius: 999,
                border: "1px solid #e3e3e6",
                background: "#fff",
                color: "#1d1d1f",
                fontWeight: 600,
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              Copy details
            </button>
            {this.props.actions}
          </div>
        </div>
      </div>
    );
  }
}
