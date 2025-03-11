/*
------------------------------------------------------------------
EventEmitter
------------------------------------------------------------------
*/

// Define the event type (key: event name, value: payload type)
export type EventHandler<T> = (event: T) => void;
export type EventName = string | symbol;

export class EventEmitter<T> {
    private eventMap: Map<EventName, EventHandler<T>[]>;

    constructor() {
        this.eventMap = new Map();
    }

    public addListener = (eventName: EventName, callback: EventHandler<T>): void => {
        const listeners = this.eventMap.get(eventName);

        if (listeners) {
            listeners.push(callback);
        } else {
            this.eventMap.set(eventName, [callback]);
        }
    }

    public removeListener = (eventName: EventName, callback: EventHandler<T>): void => {
        const listeners = this.eventMap.get(eventName) || [];

        this.eventMap.set(eventName, listeners.filter((listener) => listener !== callback));
    }

    public notifyListeners = (eventName: EventName, event: T): void => {
        const listeners = this.eventMap.get(eventName) || [];

        listeners.forEach((listener) => listener(event));
    }

    public on = (eventName: EventName, callback: EventHandler<T>): void => {
        this.addListener(eventName, callback);
    }

    public off = (eventName: EventName, callback: EventHandler<T>): void => {
        this.removeListener(eventName, callback);
    }

    public emit = (eventName: EventName, event: T): void => {
        this.notifyListeners(eventName, event);
    }

    public dispose(): void {
        this.eventMap.clear();
    }
}
