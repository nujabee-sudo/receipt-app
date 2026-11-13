export class DecodeError extends Error {
  constructor() {
    super('열 수 없는 사진이에요');
    this.name = 'DecodeError';
  }
}
