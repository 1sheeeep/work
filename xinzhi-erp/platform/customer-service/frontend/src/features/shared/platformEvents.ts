import type { PlatformEvent } from "../../api";

const platformEventName = "xzdesk:platform-event";

export function emitPlatformEvent(event: PlatformEvent) {
  window.dispatchEvent(new CustomEvent<PlatformEvent>(platformEventName, { detail: event }));
}

export function subscribePlatformEvents(listener: (event: PlatformEvent) => void) {
  const handler = (event: Event) => listener((event as CustomEvent<PlatformEvent>).detail);
  window.addEventListener(platformEventName, handler);
  return () => window.removeEventListener(platformEventName, handler);
}
