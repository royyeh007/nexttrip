import { useCallback, useEffect, useRef, useState } from "react";

/** For a horizontally scrolling element: are we at the start / end (to show fades and arrows), plus a scroll-by helper. */
export function useScrollEdges<T extends HTMLElement>(key?: unknown) {
  const ref = useRef<T>(null);
  const [edge, setEdge] = useState({ start: true, end: true });
  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const start = el.scrollLeft <= 2, end = el.scrollLeft + el.clientWidth >= el.scrollWidth - 2;
    // this runs on every scroll event: only touch state when an edge actually changed, or the whole page re-renders per event
    setEdge((prev) => (prev.start === start && prev.end === end ? prev : { start, end }));
  }, []);
  useEffect(() => {
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [update, key]);
  const scrollBy = (dir: 1 | -1, fraction = 0.7) => ref.current?.scrollBy({ left: dir * ref.current.clientWidth * fraction, behavior: "smooth" });
  return { ref, edge, update, scrollBy };
}
