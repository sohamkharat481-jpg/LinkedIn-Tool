/**
 * Structured Logging Service for Production Monitoring
 * Provides consistent JSON-formatted logs for observability.
 */

type LogLevel = 'info' | 'warn' | 'error' | 'debug';

interface LogContext {
  userId?: string;
  organizationId?: string;
  workspaceId?: string;
  clientId?: string;
  requestId?: string;
  path?: string;
  error?: any;
  [key: string]: any;
}

class LoggerService {
  private isProduction = process.env.NODE_ENV === 'production';

  private formatLog(level: LogLevel, message: string, context: LogContext = {}) {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level: level.toUpperCase(),
      message,
      ...context,
      environment: process.env.NODE_ENV || 'development',
    };

    if (context.error instanceof Error) {
      logEntry.error = {
        message: context.error.message,
        stack: context.error.stack,
        name: context.error.name,
      };
    }

    return JSON.stringify(logEntry);
  }

  info(message: string, context?: LogContext) {
    console.log(this.formatLog('info', message, context));
  }

  warn(message: string, context?: LogContext) {
    console.warn(this.formatLog('warn', message, context));
  }

  error(message: string, context?: LogContext) {
    console.error(this.formatLog('error', message, context));
  }

  debug(message: string, context?: LogContext) {
    if (!this.isProduction) {
      console.debug(this.formatLog('debug', message, context));
    }
  }

  /**
   * Specifically for tracking multi-tenant access events
   */
  audit(action: string, context: LogContext) {
    this.info(`[AUDIT] ${action}`, { ...context, audit: true });
  }
}

export const logger = new LoggerService();
