import { LocalFlowError } from '@localflow/shared';

export class AlreadyBootstrappedError extends LocalFlowError {
  constructor(
    message = 'Instance has already been bootstrapped. Owner creation is permanently locked.'
  ) {
    super(message, 'ERR_ALREADY_BOOTSTRAPPED', 409);
  }
}
