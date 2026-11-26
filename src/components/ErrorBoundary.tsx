import { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw, Trash2, Copy, Check } from 'lucide-react';
import { translate } from '../i18n';

interface Props {
  children?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  copied: boolean;
  confirmingReset: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      copied: false,
      confirmingReset: false,
    };
  }

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null, copied: false, confirmingReset: false };
  }

  public override componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('JUWEI WMS Uncaught Error:', error, errorInfo);
    this.setState({ error, errorInfo });
  }

  private handleReload = () => {
    window.location.reload();
  };

  private handleResetData = () => {
    if (!this.state.confirmingReset) {
      this.setState({ confirmingReset: true });
      return;
    }
    try {
      localStorage.clear();
    } catch (e) {
      console.error(e);
    }
    window.location.reload();
  };

  private handleCopyError = () => {
    const text = `JUWEI WMS Error:\n${this.state.error?.toString()}\n\nStack:\n${this.state.errorInfo?.componentStack || this.state.error?.stack || ''}`;
    navigator.clipboard.writeText(text);
    this.setState({ copied: true });
    setTimeout(() => this.setState({ copied: false }), 3000);
  };

  public override render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-6 font-sans">
          <div className="bg-slate-900 border border-rose-500/40 rounded-2xl p-8 max-w-lg w-full shadow-2xl space-y-6 text-left">
            <div className="flex items-center gap-3 border-b border-slate-800 pb-4">
              <div className="p-3 bg-rose-500/20 text-rose-400 rounded-xl border border-rose-500/30 shrink-0">
                <AlertTriangle className="h-7 w-7" />
              </div>
              <div>
                <span className="text-[10px] font-mono font-bold text-rose-400 uppercase tracking-widest block">
                  {translate('errorBoundary.systemRecovery')}
                </span>
                <h1 className="text-lg font-bold text-white font-mono tracking-tight">
                  {translate('errorBoundary.recoveryMode')}
                </h1>
              </div>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              {translate('errorBoundary.description')}
            </p>

            {this.state.error && (
              <div className="bg-slate-950 border border-slate-800 p-3.5 rounded-xl font-mono text-[11px] text-rose-300 space-y-1">
                <div className="font-bold text-rose-400">{translate('errorBoundary.errorDetails')}</div>
                <div className="break-words font-mono text-slate-200">{this.state.error.toString()}</div>
              </div>
            )}

            <div className="space-y-2.5 pt-2">
              <button
                type="button"
                onClick={this.handleReload}
                className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3 px-4 rounded-xl text-xs flex items-center justify-center gap-2 shadow-lg transition cursor-pointer font-mono uppercase"
              >
                <RefreshCw className="h-4 w-4" /> 🔄 {translate('errorBoundary.reloadApp')}
              </button>

              <button
                type="button"
                onClick={this.handleResetData}
                className={`w-full ${this.state.confirmingReset ? 'bg-rose-700 hover:bg-rose-600 text-white border-rose-500' : 'bg-slate-800 hover:bg-slate-700 text-rose-300 border-rose-950/60'} border font-bold py-2.5 px-4 rounded-xl text-xs flex items-center justify-center gap-2 transition cursor-pointer font-mono uppercase`}
              >
                <Trash2 className="h-4 w-4" />
                {this.state.confirmingReset ? translate('errorBoundary.confirmReset') : `🧹 ${translate('errorBoundary.resetLocalData')}`}
              </button>

              <button
                type="button"
                onClick={this.handleCopyError}
                className="w-full bg-slate-950 hover:bg-slate-800 text-slate-300 border border-slate-800 font-semibold py-2 px-3 rounded-lg text-[11px] flex items-center justify-center gap-1.5 transition cursor-pointer font-mono"
              >
                {this.state.copied ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-emerald-400" />
                    <span className="text-emerald-300">{translate('errorBoundary.copied')}</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5 text-slate-400" />
                    <span>{translate('errorBoundary.copyLog')}</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;



