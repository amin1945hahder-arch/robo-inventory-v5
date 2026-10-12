// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { PrecisionRail } from "@/pages/Landing";

/**
 * The landing separator's two failure modes are invisible to a typecheck:
 *
 *  1. a gradient id that does not match the `url(#…)` that references it —
 *     the datum rail simply does not paint;
 *  2. a vernier scale that double-draws a graduation or drops one.
 *
 * There is no browser preview on this host, so the contract is pinned here by
 * reading the rendered SVG.
 */

// framer-motion's whileInView needs an IntersectionObserver; jsdom has none.
// Never intersecting still leaves the static geometry in the DOM, which is
// exactly what these assertions read.
class StubIntersectionObserver implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin = "";
  readonly thresholds: number[] = [];
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

beforeEach(() => {
  Object.defineProperty(globalThis, "IntersectionObserver", {
    configurable: true,
    writable: true,
    value: StubIntersectionObserver,
  });
});

const attr = (el: Element, name: string) => el.getAttribute(name) ?? "";

/** Every `url(#id)` a paint attribute points at. */
function referencedIds(svg: SVGElement) {
  const refs: string[] = [];
  for (const el of svg.querySelectorAll("[stroke],[fill]")) {
    for (const name of ["stroke", "fill"]) {
      const value = attr(el, name);
      if (value.startsWith("url(#") && value.endsWith(")")) refs.push(value.slice(5, -1));
    }
  }
  return refs;
}

/** Graduations are the paths made only of move/vertical-line segments. */
function graduationPaths(svg: SVGElement) {
  return [...svg.querySelectorAll("path")].filter((p) => /^M\d+ -?\d+V\d+/.test(attr(p, "d")));
}

describe("landing precision rail", () => {
  it("paints both gradients it references — the rail is never left blank", () => {
    const { container } = render(<PrecisionRail />);
    const svg = container.querySelector("svg")!;
    const ids = [...svg.querySelectorAll("linearGradient")].map((g) => attr(g, "id"));
    const refs = referencedIds(svg);

    expect(ids.length).toBe(2);
    expect(ids.every(Boolean)).toBe(true);
    expect(refs.length).toBeGreaterThanOrEqual(2);
    for (const ref of refs) expect(ids).toContain(ref);
  });

  it("renders a three-tier vernier scale with no double-drawn graduation", () => {
    const { container } = render(<PrecisionRail />);
    const svg = container.querySelector("svg")!;
    const paths = graduationPaths(svg);

    // minor + medium + major, one path each
    expect(paths.length).toBe(3);

    const xs = paths.flatMap((p) =>
      [...attr(p, "d").matchAll(/M(-?\d+) /g)].map((m) => Number(m[1])),
    );
    // 12-unit step across a 1200 span, coarser tiers owning their positions
    expect(xs.length).toBe(99);
    expect(new Set(xs).size).toBe(xs.length);
    expect(Math.min(...xs)).toBe(12);
    expect(Math.max(...xs)).toBe(1188);
  });

  it("gives each rotor its own slow counter-rotation", () => {
    const { container } = render(<PrecisionRail />);
    expect(container.querySelectorAll(".animate-gyro")).toHaveLength(1);
    expect(container.querySelectorAll(".animate-gyro-rev")).toHaveLength(1);
  });

  it("keeps the two instances' gradient ids distinct", () => {
    const { container } = render(
      <>
        <PrecisionRail />
        <PrecisionRail reverse />
      </>,
    );
    const ids = [...container.querySelectorAll("linearGradient")].map((g) => attr(g, "id"));
    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(4);
  });
});
