export {
    SendUpdateFn,
    registerDocument,
    unregisterDocument,
    applyChanges,
    applyBackendChanges,
    UpdatePayload,
} from 'meshagent-entrypoint';

/*

import * as ep from "./entrypoint.js";

type SendUpdateFn = (data: string) => void;

export function registerDocument(
  id: string,
  data: string | null,
  sendUpdateToBackend: SendUpdateFn,
  sendUpdateToClient: SendUpdateFn): void {
    ep.registerDocument(id, data, sendUpdateToBackend, sendUpdateToClient);
  }

export function unregisterDocument(documentID: string): void {
  ep.unregisterDocument(documentID);
}

export function applyChanges(update: Object): void {
  ep.applyChanges(update);
}

export function applyBackendChanges(documentID: string, base64Changes: string): void {
  ep.applyBackendChanges(documentID, base64Changes);
}
*/
