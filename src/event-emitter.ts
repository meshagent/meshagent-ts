/*
------------------------------------------------------------------
EventEmitter
------------------------------------------------------------------
*/

// Define the event type (key: event name, value: payload type)
export type EventHandler<T> = (event: T) => void;

export interface Event<T> {
    change: T;
};

export class EventEmitter<T> {
    private listeners: EventHandler<T>[];

    constructor() {
        this.listeners = [];
    }

    public addListener(callback: EventHandler<T>): void {
        this.listeners.push(callback);
    }
    public on = this.addListener;

    public removeListener(callback: EventHandler<T>): void {
        this.listeners = this.listeners.filter((listener) => listener !== callback);
    }
    public off = this.removeListener;

    public notifyListeners(event: T): void {
        this.listeners.forEach((listener) => listener(event));
    }
    public emit = this.notifyListeners;

    public dispose(): void {
        this.listeners = [];
    }
}
