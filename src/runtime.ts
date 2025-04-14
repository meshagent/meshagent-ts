export {
    applyBackendChanges,
    applyChanges,
    registerDocument,
    unregisterDocument,
} from './entrypoint.js';

export type SendUpdateFn = (msg: string) => void;

export interface UpdatePayload {
  documentID: string;
  changes: any;
}
