export function morphWithMeasurements<T>(
  body: HTMLElement,
  nextBody: HTMLElement,
  morph: (body: HTMLElement, nextBody: HTMLElement) => T,
): T
