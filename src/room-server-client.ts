// room.ts

import { v4 as uuidv4 } from "uuid";

import { RuntimeDocument } from "./document";
import { MeshSchema } from "./schema";
import { Completer } from "./completer";

import {
    registerDocument,
    unregisterDocument,
    applyChanges,
    UpdatePayload,
} from "./runtime";

/** Simulates Dart's `Uint8List`. In TypeScript, we usually use `Uint8Array`. */
export type Uint8List = Uint8Array;

/* -------------------------------------------------------------------------
   Exceptions
------------------------------------------------------------------------- */

export class RoomServerException extends Error {
  public readonly code?: number;

  constructor(message: string, code?: number) {
    super(message);

    this.name = "RoomServerException";
    this.code = code;
  }
}

/* -------------------------------------------------------------------------
   Some of the top-level Clients from your code:
   - RoomClient
   - SyncClient, etc.
------------------------------------------------------------------------- */


////////////////////////////////////////////////////////////////////////
// A sample 'MeshDocument' that extends `RuntimeDocument`.
////////////////////////////////////////////////////////////////////////
export class MeshDocument extends RuntimeDocument {
  private _synchronized = new Completer<boolean>();

  constructor({schema, sendChangesToBackend}: {
    schema:  MeshSchema;
    sendChangesToBackend?: (base64: string) => void;
  }) {
    super({
      id: uuidv4(),
      schema,
      sendChanges: (base64) => applyChanges(base64 as UpdatePayload),
      sendChangesToBackend,
    });

    registerDocument(
      this.id,
      null,
      false, // undo
      this.onSendUpdateToBackend,
      this.onSendUpdateToClient);
  }

  public onSendUpdateToBackend = (base64: string): void => {
    const parsed = JSON.parse(base64);

    if (this.sendChangesToBackend) {
      this.sendChangesToBackend(parsed.data);
    }
  }

  public onSendUpdateToClient = (base64: string): void => {
    const parsed = JSON.parse(base64);

    this.receiveChanges(parsed.data);
  }

  get synchronized(): Promise<boolean> {
    return this._synchronized.fut;
  }

  get isSynchronized(): boolean {
    return this._synchronized.completed;
  }

  public setSynchronizedComplete(): void {
    this._synchronized.complete(true);
  }

  public override dispose() {
    super.dispose();

    unregisterDocument(this.id);
  }
}
