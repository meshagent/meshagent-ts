export interface UpdatePayload {
  documentID: string;
  changes: any;
}

export declare function applyBackendChanges(
  documentID: string,
  base64Changes: string,
): void;

export declare function applyChanges(update: UpdatePayload): void;

export declare function registerDocument(
  id: string,
  base64Data?: string | null,
  undo?: boolean,
  sendUpdateToBackend?: ((msg: string) => void) | null,
  sendUpdateToClient?: ((msg: string) => void) | null,
): void;

export declare function unregisterDocument(id: string): void;
