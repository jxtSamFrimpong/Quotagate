import type { AdapterRequest, AdapterResponse } from '../types.js';

export interface CLIAdapter {
  readonly name: string;
  complete(req: AdapterRequest): Promise<AdapterResponse>;
  healthCheck(): Promise<boolean>;
  install(): Promise<void>;
}
