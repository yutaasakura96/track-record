/**
 * The line that confirms a change just made (`../stores/flash.ts`), floated at
 * the foot of the screen it is read on.
 */
import { useFlashStore } from "../stores/flash";

export function FlashLine() {
  const text = useFlashStore((state) => state.text);
  if (!text) return null;
  return (
    <p
      role="status"
      className="fixed bottom-14 left-1/2 -translate-x-1/2 z-10 max-w-full bg-text-bright text-bg rounded-control px-12 py-8 text-small"
    >
      {text}
    </p>
  );
}
