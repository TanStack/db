export class NonRetriableError extends Error {
    constructor(message) {
        super(message);
        this.name = `NonRetriableError`;
    }
}
