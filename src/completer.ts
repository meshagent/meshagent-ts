export class Completer<T = any> {
  public completed: boolean = false;
  public fut!: Promise<T>; // tells TS we'll definitely assign this in the constructor
  public resolve!: (value?: T | PromiseLike<T>) => void; // optional parameter
  public reject!: (reason?: any) => void;

  constructor() {
    this.fut = new Promise<T>((resolve, reject) => {
      // Match the parameter signature with the property type:
      this.resolve = (value?: T | PromiseLike<T>) => {
        this.completed = true;

        resolve(value!);
      };

      this.reject = (reason?: any) => {
        this.completed = true;

        reject(reason);
      };
    });
  }

  complete(value?: T | PromiseLike<T>): void {
    this.resolve(value);
  }

  completeError(reason?: any): void {
    this.reject(reason);
  }
}
