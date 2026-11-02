import { LocalFlowError } from '@localflow/shared';

export class ExpressionEvaluationError extends LocalFlowError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'ERR_EXPRESSION_EVALUATION', 400, details);
    this.name = 'ExpressionEvaluationError';
  }
}
