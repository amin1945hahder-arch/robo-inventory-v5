import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AnimatePresence,
  MotionConfig,
  animate,
  motion,
  useInView,
  useMotionTemplate,
  useMotionValue,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
} from "framer-motion";
import { Link, useNavigate } from "react-router";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import logo from "@/assets/logo.svg";
import {
  ArrowRight,
  BarChart3,
  Battery,
  Bell,
  Bolt,
  Box,
  Boxes,
  Cable,
  Car,
  Camera,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircuitBoard,
  CloudOff,
  Cpu,
  Quote,
  Target,
  FileDown,
  FileUp,
  FolderKanban,
  Gauge,
  Layers,
  LayoutDashboard,
  Mail,
  Package,
  PackageSearch,
  QrCode,
  Radio,
  ScanLine,
  Settings,
  ShieldCheck,
  Sparkles,
  Users,
  Warehouse,
  WifiOff,
  Wrench,
  Zap,
} from "lucide-react";

/* ══════════════════════════════════════════════════════════════════════
   Shared motion vocabulary — one place so every section moves with the
   same rhythm, and reduced-motion users get a still page via MotionConfig.
   ══════════════════════════════════════════════════════════════════════ */

const fadeUp = {
  initial: { opacity: 0, y: 24 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-80px" },
};

const stagger = (i: number, step = 0.06) => ({
  duration: 0.5,
  delay: i * step,
  ease: [0.16, 1, 0.3, 1] as const,
});

/**
 * A card that lights up around the cursor AND tilts toward it — the "it
 * responds to you" cue. The tilt is pointer-driven, so reduced-motion users
 * get the glow but a perfectly still card.
 */
function SpotlightCard({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const mx = useMotionValue(-300);
  const my = useMotionValue(-300);
  const glow = useMotionTemplate`radial-gradient(260px circle at ${mx}px ${my}px, color-mix(in oklab, var(--primary) 15%, transparent), transparent 72%)`;

  const rx = useMotionValue(0);
  const ry = useMotionValue(0);
  const tiltX = useSpring(rx, { stiffness: 170, damping: 18, mass: 0.4 });
  const tiltY = useSpring(ry, { stiffness: 170, damping: 18, mass: 0.4 });

  return (
    <div
      onPointerMove={(e) => {
        const box = e.currentTarget.getBoundingClientRect();
        mx.set(e.clientX - box.left);
        my.set(e.clientY - box.top);
        if (reduce) return;
        ry.set(((e.clientX - box.left) / box.width - 0.5) * 7);
        rx.set(-((e.clientY - box.top) / box.height - 0.5) * 6);
      }}
      onPointerLeave={() => {
        rx.set(0);
        ry.set(0);
      }}
      className={cn(
        "group relative overflow-hidden rounded-2xl border border-border/70 bg-card/40 transition-colors duration-300 hover:border-primary/40",
        className,
      )}
    >
      <motion.div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        style={{ background: glow }}
      />
      <motion.div
        style={{ rotateX: tiltX, rotateY: tiltY, transformPerspective: 900 }}
        className="relative h-full"
      >
        {children}
      </motion.div>
    </div>
  );
}

/** Counts up once, when it scrolls into view. */
function CountUp({ to, suffix = "" }: { to: number; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-60px" });
  const [value, setValue] = useState(0);

  useEffect(() => {
    if (!inView) return;
    const controls = animate(0, to, {
      duration: 1.6,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => setValue(v),
    });
    return () => controls.stop();
  }, [inView, to]);

  return (
    <span ref={ref} className="tabular-nums">
      {Math.round(value)}
      {suffix}
    </span>
  );
}

/** Endless ticker. The list is rendered twice so -50% loops seamlessly. */
function MarqueeRow({ items, reverse = false }: { items: string[]; reverse?: boolean }) {
  return (
    <div className="group mask-fade-x flex overflow-hidden">
      <div
        className={cn(
          "flex w-max shrink-0 items-center gap-3 pr-3 group-hover:[animation-play-state:paused]",
          reverse ? "animate-marquee-rev" : "animate-marquee",
        )}
      >
        {[...items, ...items].map((item, i) => (
          <span
            key={`${item}-${i}`}
            className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-background/50 px-4 py-2 text-sm whitespace-nowrap text-muted-foreground"
          >
            <Boxes className="size-4 text-primary" />
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   TrySection — two HANDS-ON demos of the two moments that define the app:
   scanning a unit to rent it, and finding a part without knowing where it
   lives. Both run on the page itself — no video, no screenshots.
   ══════════════════════════════════════════════════════════════════════ */

type ScanPhase = "idle" | "scanning" | "approved";

/** What's moving through the lab right now — a tiny vertical word flip. */
const TRACKING = ["servos", "filament", "Arduinos", "fasteners", "PCBs"];
function TrackingFlip() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setI((v) => (v + 1) % TRACKING.length), 2000);
    return () => window.clearInterval(t);
  }, []);
  return (
    <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
      now tracking
      <span className="relative inline-block h-4 w-20 overflow-hidden text-left align-bottom">
        <AnimatePresence mode="wait">
          <motion.span
            key={TRACKING[i]}
            initial={{ y: 12, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -12, opacity: 0 }}
            transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
            className="absolute inset-x-0 top-0 font-medium text-primary"
          >
            {TRACKING[i]}
          </motion.span>
        </AnimatePresence>
      </span>
    </span>
  );
}

/**
 * A REAL mechanical gear — not a wireframe.
 *
 * The toothed rim is generated from a spur-gear tooth profile on a constant
 * module: a pitch circle, addendum (tip) and dedendum (root) radii, smooth
 * S-curve flanks, flat tip lands and root arcs. That sits over an inner rim
 * ring, a bored hub cut with a keyway, and a web lightened with drilled
 * holes. Because the module is constant, any two gears mesh visually.
 * One geometry serves the inline schematic and the standalone gear train.
 * Spins via --animate-gear / --animate-gear-rev, which the reduced-motion
 * block turns off.
 */
const GEAR_MODULE = 6.4;

/** Pitch / addendum / dedendum radii for a gear of `teeth` teeth. */
function gearDims(teeth: number) {
  const pitch = (GEAR_MODULE * teeth) / 2;
  return {
    pitch,
    tip: pitch + GEAR_MODULE,
    root: pitch - 1.25 * GEAR_MODULE,
  };
}

/** Closed outline of the toothed rim: root arcs, flanks and tip lands. */
function gearTeethPath(teeth: number) {
  const { tip, root } = gearDims(teeth);
  const steps = 16; // samples per tooth — smooth at every rendered size
  const total = teeth * steps;
  const rise = (x: number) => x * x * (3 - 2 * x);
  const pts: string[] = [];
  for (let i = 0; i < total; i++) {
    // Position inside one tooth period:
    //   0–.16 rising flank · .16–.34 tip land · .34–.5 falling flank · .5–1 root arc
    const u = ((i / total) * teeth) % 1;
    let r = root;
    if (u < 0.16) r = root + (tip - root) * rise(u / 0.16);
    else if (u < 0.34) r = tip;
    else if (u < 0.5) r = tip - (tip - root) * rise((u - 0.34) / 0.16);
    const a = (i / total) * Math.PI * 2 - Math.PI / 2;
    pts.push(`${(Math.cos(a) * r).toFixed(2)},${(Math.sin(a) * r).toFixed(2)}`);
  }
  return `M${pts.join("L")}Z`;
}

function GearShape({ teeth = 12 }: { teeth?: number }) {
  const { root } = gearDims(teeth);
  const profile = useMemo(() => gearTeethPath(teeth), [teeth]);
  const rim = root - 7; // inner edge of the rim band
  const hub = Math.min(13.5, rim - 8); // hub outside diameter
  const bore = hub * 0.45;
  const holes = 5;
  const holeRing = (rim + hub) / 2;
  const holeR = Math.max(2.4, (rim - hub) / 2 - 2.6);
  return (
    <g stroke="currentColor" fill="none" strokeLinejoin="round">
      {/* toothed rim */}
      <path d={profile} strokeWidth={2.4} fill="currentColor" fillOpacity={0.07} />
      {/* inner edge of the rim */}
      <circle r={rim} strokeWidth={2.4} />
      {/* bored hub, cut with a keyway */}
      <circle r={hub} strokeWidth={2.4} fill="currentColor" fillOpacity={0.05} />
      <circle r={bore} strokeWidth={1.8} />
      <path
        d={`M${-bore * 0.6} ${-bore} V${-(bore + 3)} H${bore * 0.6} V${-bore}`}
        strokeWidth={1.8}
      />
      {/* web lightening holes */}
      {Array.from({ length: holes }, (_, i) => {
        const a = (i / holes) * Math.PI * 2 - Math.PI / 2;
        return (
          <circle
            key={`h${i}`}
            cx={Number((Math.cos(a) * holeRing).toFixed(2))}
            cy={Number((Math.sin(a) * holeRing).toFixed(2))}
            r={holeR}
            strokeWidth={1.8}
          />
        );
      })}
    </g>
  );
}

function Gear({ className, teeth = 12 }: { className?: string; teeth?: number }) {
  const { tip } = gearDims(teeth);
  // Size the box to the actual gear so no tooth count ever gets clipped.
  const half = Math.ceil(tip + 2);
  return (
    <svg
      viewBox={`${-half} ${-half} ${half * 2} ${half * 2}`}
      fill="none"
      className={className}
      aria-hidden
    >
      <GearShape teeth={teeth} />
    </svg>
  );
}

/**
 * The signature separator: a PCB schematic that solders itself together as
 * it scrolls into view — a resistor zigzag, right-angle jogs, corner vias,
 * junction pads, a shunt capacitor to ground, and a real IC package whose
 * gull-wing leads end on proper solder pads on the bus. A mechanical gear
 * drives each end. After the draw, TWO glowing signals run the wire in
 * opposite directions, forever.
 */
const TRACE_D =
  "M64 64 H150 l9 -12 l9 24 l9 -24 l9 24 l9 -12 H300 V82 H364 V64 H600 V42 H660 V64 H736";

/** Lead positions for the IC — each lands on its own solder pad on the bus. */
const IC_LEADS = [478, 494, 510, 526];

function CircuitTrace({ className, reverse = false }: { className?: string; reverse?: boolean }) {
  const pads: [number, number][] = [[420, 64]];
  const rings: [number, number][] = [
    [240, 40],
    [420, 86],
  ];
  const vias: [number, number][] = [
    [300, 82],
    [364, 82],
    [600, 42],
    [660, 42],
  ];
  const inView = { once: true, margin: "-60px" } as const;
  const pop = (i: number) => ({
    initial: { scale: 0 as const, opacity: 0 },
    whileInView: { scale: 1, opacity: 1 },
    viewport: inView,
    style: { transformBox: "fill-box" as const, transformOrigin: "center" },
    transition: { delay: 1.35 + i * 0.1, type: "spring" as const, stiffness: 320, damping: 18 },
  });

  return (
    <div className={cn("relative z-10 mx-auto w-full max-w-5xl px-6", className)} aria-hidden>
      <svg viewBox="0 0 800 96" fill="none" className="w-full text-primary">
        {/* the bus draws itself, left to right */}
        <motion.path
          d={TRACE_D}
          stroke="currentColor"
          strokeOpacity={0.5}
          strokeWidth={2}
          strokeLinejoin="round"
          initial={{ pathLength: 0, opacity: 0 }}
          whileInView={{ pathLength: 1, opacity: 1 }}
          viewport={inView}
          transition={{ duration: 1.8, ease: "easeInOut" }}
        />

        {/* branch stubs with pads — drawn after the bus reaches them */}
        <motion.path
          d="M240 64 V40"
          stroke="currentColor"
          strokeOpacity={0.5}
          strokeWidth={2}
          initial={{ pathLength: 0 }}
          whileInView={{ pathLength: 1 }}
          viewport={inView}
          transition={{ duration: 0.4, delay: 0.9 }}
        />
        <motion.path
          d="M420 64 V86"
          stroke="currentColor"
          strokeOpacity={0.5}
          strokeWidth={2}
          initial={{ pathLength: 0 }}
          whileInView={{ pathLength: 1 }}
          viewport={inView}
          transition={{ duration: 0.4, delay: 1.15 }}
        />

        {/* shunt capacitor to ground — plates, leads and a ground symbol */}
        <motion.g {...pop(6)} stroke="currentColor" strokeWidth={2} strokeOpacity={0.75}>
          <path d="M580 64 V74" />
          <path d="M571 74 H589" strokeWidth={2.6} />
          <path d="M571 78 H589" strokeWidth={2.6} />
          <path d="M580 78 V87" />
          <path d="M573 87 H587" />
          <path d="M576 90 H584" />
          <path d="M579 93 H581" />
        </motion.g>

        {/* IC package: body, pin-1 index, gull-wing leads into solder pads */}
        <motion.g {...pop(0)}>
          <rect
            x={468}
            y={8}
            width={64}
            height={30}
            rx={4}
            fill="currentColor"
            fillOpacity={0.1}
            stroke="currentColor"
            strokeOpacity={0.78}
            strokeWidth={2}
          />
          <circle cx={478} cy={18} r={2.2} fill="currentColor" fillOpacity={0.7} />
          <text
            x={502}
            y={31}
            fontSize={8}
            fontFamily="monospace"
            textAnchor="middle"
            fill="currentColor"
            opacity={0.6}
          >
            RC-01
          </text>
          {IC_LEADS.map((x) => (
            <g key={x}>
              <line
                x1={x}
                y1={38}
                x2={x}
                y2={54}
                stroke="currentColor"
                strokeWidth={2}
                strokeOpacity={0.85}
              />
              <rect
                x={x - 3.5}
                y={54}
                width={7}
                height={10}
                rx={1.4}
                fill="currentColor"
                fillOpacity={0.18}
                stroke="currentColor"
                strokeOpacity={0.85}
                strokeWidth={1.6}
              />
            </g>
          ))}
        </motion.g>

        {/* junction dots, ring pads, vias — they pop in as the wire arrives */}
        {pads.map(([cx, cy], i) => (
          <motion.circle key={`p${cx}`} cx={cx} cy={cy} r={4} fill="currentColor" {...pop(i + 1)} />
        ))}
        {rings.map(([cx, cy], i) => (
          <motion.circle
            key={`r${cx}`}
            cx={cx}
            cy={cy}
            r={5}
            stroke="currentColor"
            strokeWidth={2.5}
            {...pop(i + 3)}
          />
        ))}
        {vias.map(([cx, cy], i) => (
          <motion.g key={`v${cx}`} {...pop(i + 5)}>
            <circle cx={cx} cy={cy} r={6} stroke="currentColor" strokeWidth={2} strokeOpacity={0.8} />
            <circle cx={cx} cy={cy} r={2.5} fill="currentColor" />
          </motion.g>
        ))}

        {/* schematic annotations */}
        <motion.text
          x={70}
          y={50}
          fontSize={10}
          fontFamily="monospace"
          fill="currentColor"
          opacity={0.55}
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 0.55 }}
          viewport={inView}
          transition={{ delay: 1.5 }}
        >
          RC-BUS
        </motion.text>
        <motion.text
          x={568}
          y={40}
          fontSize={9}
          fontFamily="monospace"
          fill="currentColor"
          opacity={0.55}
          textAnchor="end"
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 0.55 }}
          viewport={inView}
          transition={{ delay: 1.6 }}
        >
          U1
        </motion.text>
        <motion.text
          x={596}
          y={92}
          fontSize={9}
          fontFamily="monospace"
          fill="currentColor"
          opacity={0.55}
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 0.55 }}
          viewport={inView}
          transition={{ delay: 1.7 }}
        >
          GND
        </motion.text>
        <motion.text
          x={736}
          y={50}
          fontSize={10}
          fontFamily="monospace"
          fill="currentColor"
          opacity={0.55}
          textAnchor="end"
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 0.55 }}
          viewport={inView}
          transition={{ delay: 1.6 }}
        >
          I²C
        </motion.text>

        {/* mechanical gears driving the bus at both ends (meshed module) */}
        <g transform="translate(30 64) scale(0.55)">
          <g className="animate-gear [transform-box:fill-box] [transform-origin:center]">
            <GearShape teeth={12} />
          </g>
        </g>
        <g transform="translate(768 64) scale(0.6)">
          <g className="animate-gear-rev [transform-box:fill-box] [transform-origin:center]">
            <GearShape teeth={9} />
          </g>
        </g>

        {/* two glowing signals running the wire in opposite directions */}
        <motion.path
          d={TRACE_D}
          stroke="currentColor"
          strokeWidth={3.5}
          strokeLinecap="round"
          pathLength={1}
          strokeDasharray="0.035 0.965"
          style={{ filter: "drop-shadow(0 0 6px currentColor)" }}
          initial={{ strokeDashoffset: reverse ? 0 : 1, opacity: 0 }}
          whileInView={{ strokeDashoffset: reverse ? 1 : 0, opacity: 1 }}
          viewport={inView}
          transition={{
            strokeDashoffset: { duration: 2.4, repeat: Infinity, ease: "linear", delay: 1.6 },
            opacity: { duration: 0.4, delay: 1.6 },
          }}
        />
        <motion.path
          d={TRACE_D}
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          pathLength={1}
          strokeDasharray="0.018 0.982"
          style={{ filter: "drop-shadow(0 0 4px currentColor)" }}
          initial={{ strokeDashoffset: reverse ? 1 : 0, opacity: 0 }}
          whileInView={{ strokeDashoffset: reverse ? 0 : 1, opacity: 0.65 }}
          viewport={inView}
          transition={{
            strokeDashoffset: { duration: 3.4, repeat: Infinity, ease: "linear", delay: 2.5 },
            opacity: { duration: 0.4, delay: 2.5 },
          }}
        />
      </svg>
    </div>
  );
}

function ScanDemo() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });
  const [phase, setPhase] = useState<ScanPhase>("idle");

  // Play once when the section scrolls into view; the visitor can replay it.
  useEffect(() => {
    if (!inView) return;
    setPhase("scanning");
    const t = setTimeout(() => setPhase("approved"), 1900);
    return () => clearTimeout(t);
  }, [inView]);

  const replay = () => {
    setPhase("scanning");
    setTimeout(() => setPhase("approved"), 1900);
  };

  return (
    <div ref={ref} className="glass relative flex h-full flex-col overflow-hidden rounded-2xl p-6">
      <div className="flex items-center gap-3">
        <div className="icon-glass flex size-11 items-center justify-center rounded-lg text-primary">
          <ScanLine className="size-5" />
        </div>
        <div>
          <p className="font-semibold tracking-tight">The scan flow</p>
          <p className="text-xs text-muted-foreground">Runs right here — press replay</p>
        </div>
        <Badge
          variant="outline"
          className={cn(
            "ml-auto gap-1.5 border-emerald-500/40 bg-emerald-500/10 text-emerald-400 transition-opacity duration-500",
            phase !== "approved" && "opacity-0",
          )}
        >
          <CheckCircle2 className="size-3.5" /> Approved
        </Badge>
      </div>

      <div className="relative mt-5 flex-1 overflow-hidden rounded-xl border border-border/60 bg-background/40 p-5">
        {/* the faux unit, framed like the QR label on the shelf */}
        <div
          className={cn(
            "relative mx-auto w-fit rounded-xl border px-6 py-5 text-center transition-all duration-500",
            phase === "approved"
              ? "border-emerald-500/40 bg-emerald-500/5"
              : "border-border/70 bg-background/30",
          )}
        >
          <QrCode className="mx-auto size-16 text-foreground/70" />
          <p className="mt-2 font-mono text-xs text-muted-foreground">ARD-003</p>
          <p className="text-sm font-semibold">Arduino Uno — unit 3</p>

          {/* scanning laser */}
          <AnimatePresence>
            {phase === "scanning" && (
              <motion.div
                key="laser"
                initial={{ top: "8%", opacity: 0 }}
                animate={{ top: ["8%", "88%", "8%"], opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 1.8, ease: "easeInOut" }}
                className="pointer-events-none absolute inset-x-4 h-0.5 rounded bg-primary shadow-[0_0_12px_2px] shadow-primary/60"
              />
            )}
          </AnimatePresence>
        </div>

        {/* the status line advances with the phase */}
        <div className="mt-5 flex items-center justify-center gap-2 text-xs">
          {phase === "idle" && <span className="text-muted-foreground">Point the scanner at the label…</span>}
          {phase === "scanning" && (
            <>
              <motion.span
                animate={{ opacity: [0.3, 1, 0.3] }}
                transition={{ duration: 0.9, repeat: Infinity }}
                className="flex"
              >
                <ScanLine className="size-4 text-primary" />
              </motion.span>
              <span className="text-primary">Reading QR… found ARD-003</span>
            </>
          )}
          {phase === "approved" && (
            <span className="flex items-center gap-1.5 text-emerald-400">
              <CheckCircle2 className="size-4" />
              Request sent → admin approved it in seconds
            </span>
          )}
        </div>
      </div>

      <Button
        size="sm"
        variant="outline"
        className="press-3d mt-4 w-fit gap-2"
        onClick={replay}
        disabled={phase === "scanning"}
      >
        <ScanLine className="size-4" />
        {phase === "approved" ? "Replay the scan" : "Scanning…"}
      </Button>
    </div>
  );
}

const SEARCH_STEPS = ["ser", "servo", "servo ", "servo drv"];

function SearchDemo() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });
  const [len, setLen] = useState(0);
  const query = SEARCH_STEPS[len] ?? SEARCH_STEPS[SEARCH_STEPS.length - 1];
  const matched = len >= SEARCH_STEPS.length - 1;

  // Type the query out when the section first appears.
  useEffect(() => {
    if (!inView) return;
    let i = 0;
    const t = setInterval(() => {
      i += 1;
      setLen(i);
      if (i >= SEARCH_STEPS.length - 1) clearInterval(t);
    }, 420);
    return () => clearInterval(t);
  }, [inView]);

  const replay = () => {
    setLen(0);
    let i = 0;
    const t = setInterval(() => {
      i += 1;
      setLen(i);
      if (i >= SEARCH_STEPS.length - 1) clearInterval(t);
    }, 420);
  };

  return (
    <div ref={ref} className="glass relative flex h-full flex-col overflow-hidden rounded-2xl p-6">
      <div className="flex items-center gap-3">
        <div className="icon-glass flex size-11 items-center justify-center rounded-lg text-primary">
          <PackageSearch className="size-5" />
        </div>
        <div>
          <p className="font-semibold tracking-tight">Find it in a heartbeat</p>
          <p className="text-xs text-muted-foreground">Search that runs from the local cache</p>
        </div>
        <Badge
          variant="outline"
          className={cn(
            "ml-auto border-cyan-500/40 bg-cyan-500/10 text-cyan-400 transition-opacity duration-500",
            !matched && "opacity-0",
          )}
        >
          2 hits · 0.4 ms
        </Badge>
      </div>

      {/* the faux search field */}
      <div className="mt-5 flex items-center gap-2 rounded-xl border border-border/60 bg-background/40 px-4 py-3">
        <PackageSearch className="size-4 shrink-0 text-muted-foreground" />
        <span className="font-mono text-sm">
          {query}
          <motion.span
            animate={{ opacity: [1, 0, 1] }}
            transition={{ duration: 0.9, repeat: Infinity }}
            className="ml-0.5 inline-block h-4 w-0.5 translate-y-0.5 bg-primary"
          />
        </span>
      </div>

      <div className="mt-4 flex-1 space-y-2">
        <AnimatePresence>
          {matched && (
            <>
              <motion.div
                key="hit-1"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.35 }}
                className="flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-2.5 text-sm"
              >
                <Cpu className="icon-3d size-4 shrink-0 text-primary" />
                <span className="font-medium">Servo driver board</span>
                <span className="ml-auto font-mono text-xs text-emerald-400">3 available</span>
              </motion.div>
              <motion.div
                key="hit-2"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.35, delay: 0.12 }}
                className="flex items-center gap-3 rounded-lg border border-border/60 bg-background/30 px-4 py-2.5 text-sm text-muted-foreground"
              >
                <Bolt className="size-4 shrink-0 text-primary/70" />
                <span>Servo pack — MG996R ×4</span>
                <span className="ml-auto font-mono text-xs">A2 · shelf 4</span>
              </motion.div>
            </>
          )}
        </AnimatePresence>
        {!matched && <p className="pt-3 text-xs text-muted-foreground">Type to search the whole club's inventory…</p>}
      </div>

      <Button
        size="sm"
        variant="outline"
        className="press-3d mt-4 w-fit gap-2"
        onClick={replay}
      >
        <Sparkles className="size-4" /> Replay the search
      </Button>
    </div>
  );
}

function TrySection() {
  return (
    <section id="try" className="relative z-10 mx-auto w-full max-w-6xl px-6 py-20">
      <motion.div {...fadeUp} transition={{ duration: 0.5 }} className="mx-auto max-w-2xl text-center">
        <Badge
          variant="outline"
          className="mx-auto w-fit gap-2 border-primary/40 bg-primary/10 px-3 text-primary"
        >
          <Target className="size-3.5" />
          Don't read about it — do it
        </Badge>
        <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
          Two moves. That's the whole app.
        </h2>
        <p className="mt-3 text-muted-foreground">
          Everything in RC collapses into scan-or-search. Try both right here.
        </p>
      </motion.div>

      <div className="mt-10 grid gap-4 lg:grid-cols-2">
        <motion.div {...fadeUp} transition={{ duration: 0.5 }}>
          <ScanDemo />
        </motion.div>
        <motion.div {...fadeUp} transition={{ ...stagger(1), duration: 0.5 }}>
          <SearchDemo />
        </motion.div>
      </div>
    </section>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   Testimonials — voices from clubs already running it.
   ══════════════════════════════════════════════════════════════════════ */

const VOICES = [
  {
    quote:
      "We stopped doing inventory Sundays. Members scan what they take, admin approves from email, and the shelf count is always true.",
    name: "Sarah K.",
    role: "Club president · 42 members",
  },
  {
    quote:
      "The offline mode sold it. Our lab is in a basement with terrible wifi — RC doesn't care, everything still opens instantly.",
    name: "Omar A.",
    role: "Hardware lead · robotics league team",
  },
  {
    quote:
      "Parts used to evaporate. Now every servo has a card, a QR, and a history — and the printing farm is tracked in the same place.",
    name: "Dana M.",
    role: "Workshop manager · maker space",
  },
];

function Testimonials() {
  const [idx, setIdx] = useState(0);
  const go = (dir: 1 | -1) => setIdx((i) => (i + dir + VOICES.length) % VOICES.length);
  const v = VOICES[idx];

  return (
    <section className="relative z-10 mx-auto w-full max-w-4xl px-6 py-20">
      <motion.div {...fadeUp} transition={{ duration: 0.5 }}>
        <div className="glass relative overflow-hidden rounded-2xl px-8 py-10 sm:px-12">
          <Quote className="absolute -top-2 left-6 size-20 text-primary/10" aria-hidden />
          <div className="relative min-h-44 sm:min-h-36">
            <AnimatePresence mode="wait" initial={false}>
              <motion.figure
                key={idx}
                initial={{ opacity: 0, x: 32 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -32 }}
                transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
              >
                <blockquote className="text-lg font-medium leading-relaxed tracking-tight sm:text-xl">
                  “{v.quote}”
                </blockquote>
                <figcaption className="mt-4 text-sm">
                  <span className="font-semibold text-primary">{v.name}</span>
                  <span className="text-muted-foreground"> — {v.role}</span>
                </figcaption>
              </motion.figure>
            </AnimatePresence>
          </div>

          <div className="mt-6 flex items-center justify-between">
            <div className="flex gap-1.5">
              {VOICES.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  aria-label={`Voice ${i + 1}`}
                  onClick={() => setIdx(i)}
                  className={cn(
                    "h-1.5 rounded-full transition-all duration-300",
                    i === idx ? "w-6 bg-primary" : "w-1.5 bg-border hover:bg-primary/40",
                  )}
                />
              ))}
            </div>
            <div className="flex gap-1">
              <Button size="icon" variant="ghost" aria-label="Previous voice" onClick={() => go(-1)}>
                <ChevronLeft className="size-4" />
              </Button>
              <Button size="icon" variant="ghost" aria-label="Next voice" onClick={() => go(1)}>
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
        </div>
      </motion.div>
    </section>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   Content — everything the app actually offers, in one page.
   ══════════════════════════════════════════════════════════════════════ */

const TICKER = [
  "Microcontrollers",
  "Motors & servos",
  "Sensors",
  "LiPo batteries",
  "3D-printed brackets",
  "Chassis kits",
  "Filament & resin",
  "Wire & connectors",
  "Gearboxes",
  "Driver boards",
  "Fasteners",
  "Test equipment",
];

const CATEGORY_GROUPS = [
  "All",
  "Electronics",
  "Motion",
  "Power",
  "Mechanical",
  "Fabrication",
  "Consumables",
] as const;

/** Example shelf from a working club — every row is a real category shape
 *  RC stores: a QR-coded group of units with a live availability. */
const CATEGORIES = [
  {
    icon: Cpu,
    name: "Microcontrollers",
    group: "Electronics",
    units: 34,
    blurb: "ESP32, RP2040, STM32 and the trusty Arduino — the brain of every build.",
  },
  {
    icon: Gauge,
    name: "Sensors & modules",
    group: "Electronics",
    units: 47,
    blurb: "Distance, IMU, temperature, light. The eyes and ears of a robot.",
  },
  {
    icon: Radio,
    name: "Comms & telemetry",
    group: "Electronics",
    units: 18,
    blurb: "nRF24, LoRa, ESP-NOW links and plain 433MHz — see the bot from the desk.",
  },
  {
    icon: CircuitBoard,
    name: "Driver boards",
    group: "Electronics",
    units: 21,
    blurb: "L298N, TB6612, motor HATs — everything that makes a pin strong enough.",
  },
  {
    icon: Bolt,
    name: "Motors & servos",
    group: "Motion",
    units: 52,
    blurb: "DC, steppers and servos, each unit tracked individually, never in a pile.",
  },
  {
    icon: Settings,
    name: "Gearboxes & pulleys",
    group: "Motion",
    units: 19,
    blurb: "Ratio changes without reprinting a single bracket.",
  },
  {
    icon: Battery,
    name: "Batteries & packs",
    group: "Power",
    units: 30,
    blurb: "LiPo packs, holders and chargers — with the cell count recorded.",
  },
  {
    icon: Zap,
    name: "Power distribution",
    group: "Power",
    units: 24,
    blurb: "Buck modules, fuses, switches and wiring that never goes missing.",
  },
  {
    icon: Car,
    name: "Chassis & drive",
    group: "Mechanical",
    units: 26,
    blurb: "Wheels, tracks, brackets and gearboxes for anything that rolls.",
  },
  {
    icon: Wrench,
    name: "Tools & fasteners",
    group: "Mechanical",
    units: 88,
    blurb: "Drivers, hex keys, bearings, spacers — the small stuff that stops builds.",
  },
  {
    icon: Layers,
    name: "Extrusions & plates",
    group: "Fabrication",
    units: 40,
    blurb: "Aluminium profiles, acrylic and printed plates, cut to the job.",
  },
  {
    icon: Cable,
    name: "Wire & connectors",
    group: "Fabrication",
    units: 60,
    blurb: "Hook-up wire, crimps and JST — measured by the metre, not by the guess.",
  },
  {
    icon: Package,
    name: "Filament & resin",
    group: "Consumables",
    units: 12,
    blurb: "PLA, PETG and resin with the printer that runs them — used up, not returned.",
  },
  {
    icon: Sparkles,
    name: "Adhesives & tapes",
    group: "Consumables",
    units: 16,
    blurb: "Consumables that decrement instead of waiting at a return desk.",
  },
];

const MEMBER_MODULES = [
  {
    icon: LayoutDashboard,
    name: "Dashboard",
    body: "Live availability at a glance: what's rented, broken, on projects and waiting for approval.",
  },
  {
    icon: Boxes,
    name: "Inventory",
    body: "Search by name, brand or category — or just scan a shelf. Live stock, storages, categories.",
  },
  {
    icon: Warehouse,
    name: "Storages",
    body: "Every storage door and category has its own QR. Scan a door to see exactly what lives inside.",
  },
  {
    icon: FolderKanban,
    name: "Projects",
    body: "Assign parts to club builds for the long haul — checked out until the project is dismantled.",
  },
  {
    icon: PackageSearch,
    name: "My rentals",
    body: "One tab bar for package bundles, active requests and history — everything borrowed, in one place.",
  },
  {
    icon: Box,
    name: "3D printing",
    body: "Embedded slicer with printer, material and filament in view. Slice, preview, export and print.",
  },
];

const ADMIN_MODULES = [
  {
    icon: Bell,
    name: "Requests console",
    body: "Eleven tabs — updates, pending, packages, pickups, active, projects, history, printers, ranks, profiles and the club readme — with unread bubbles.",
  },
  {
    icon: Users,
    name: "People & roles",
    body: "Ranks, printer and inventory permissions, review workflows. Everyone gets exactly their level of access.",
  },
  {
    icon: FileUp,
    name: "Import CSV",
    body: "Batch load parts, storages, projects and more from a spreadsheet — no manual entry for the long tail.",
  },
  {
    icon: QrCode,
    name: "Print labels",
    body: "Design the QR label sheet: paper size, per-section labels, cut lines. Every page prints in one go.",
  },
  {
    icon: FileDown,
    name: "Export studio",
    body: "Turn filtered inventory into print sheets or CSV — real mm scale, whole rows, zero page clipping.",
  },
  {
    icon: BarChart3,
    name: "Reports",
    body: "What's out, what's due, what's broken. The numbers the club runs on, straight from the database.",
  },
];

const FEATURES = [
  {
    icon: ScanLine,
    title: "Point. Scan. Rented.",
    body: "Every shelf unit carries its own QR tag. Scan it in the lab and the rental request is one tap away — no forms, no hunting through spreadsheets.",
  },
  {
    icon: ShieldCheck,
    title: "Admin-approved flow",
    body: "Admin gets an email and a dashboard notification for every request. Approve with one click, straight from the inbox.",
  },
  {
    icon: FolderKanban,
    title: "Project assemblies",
    body: "Assign parts to club builds where they stay checked out for good — until the project is dismantled and everything returns to the shelves.",
  },
  {
    icon: Wrench,
    title: "Condition tracking",
    body: "Returns open a quick condition check — working units go back on the shelf, broken ones to the repair pile with their full history intact.",
  },
  {
    icon: Mail,
    title: "Email that acts",
    body: "Decision links in every notification email mean approvals take seconds, whether you're at your desk or halfway across the lab.",
  },
  {
    icon: PackageSearch,
    title: "Package bundles",
    body: "Rent several units as one decided package — a single bundle card, statuses kept in sync, easy to edit or cancel before approval.",
  },
];

const STEPS = [
  { n: "01", title: "Scan the tag", body: "Point your camera at the unit's QR label in the lab." },
  { n: "02", title: "Request it", body: "One tap sends the request, with an optional note for the admin." },
  { n: "03", title: "Get approved", body: "Admin approves from the dashboard or email — you get the email too." },
  { n: "04", title: "Build & return", body: "Take it to your robot, then return it or assign it to your project." },
];

const OFFLINE_POINTS = [
  {
    icon: Warehouse,
    title: "Full cache per member",
    body: "Every table is downloaded and stored locally on first open — the whole club's inventory, not just your own.",
  },
  {
    icon: CloudOff,
    title: "Interrupt-only refresh",
    body: "Your app never polls. When someone else writes, you get one notification and exactly what changed is merged in.",
  },
  {
    icon: WifiOff,
    title: "Offline login, always",
    body: "Sign-in uses the session already on your device, so the app opens and the cache loads without a connection.",
  },
];

const STATS = [
  { value: 21, suffix: "", label: "pages in the app", hint: "from scan to slicer" },
  { value: 100, suffix: "%", label: "of reads served locally", hint: "zero signal needed" },
  { value: 11, suffix: "", label: "request tabs to triage", hint: "one admin console" },
  { value: 1, suffix: " scan", label: "to start a rental", hint: "no forms" },
];

const ROLE_MEMBER = [
  "Search by name, brand or category — or just scan the shelf",
  "See live availability: rented, broken, on projects",
  "Track active rentals, packages and history in one tab bar",
  "Assign parts to your project for the long haul",
];

const ROLE_ADMIN = [
  "Every request lands in the dashboard and your inbox",
  "Approve or deny from email links — no login needed",
  "Returns capture condition: works fine vs. needs repair",
  "Full card per part: rent, available, broken, on projects",
];



export default function Landing() {
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();

  return (
    <MotionConfig reducedMotion="user">
      <div className="relative min-h-screen overflow-x-clip">
        <Aurora />
        <ScrollProgress />

        {/* ── nav ─────────────────────────────────────────────────── */}
        <header className="sticky top-0 z-30">
          <Nav isAuthenticated={isAuthenticated} />
        </header>

        {/* ── hero ────────────────────────────────────────────────── */}
        <Hero onCta={() => navigate("/auth")} onScan={() => navigate("/auth?returnTo=/rent-scan")} />

        {/* ── ticker ──────────────────────────────────────────────── */}
        <section className="relative z-10 flex flex-col gap-3 border-y border-border/50 bg-background/30 py-6 backdrop-blur-sm">
          <p className="px-6 text-center text-[11px] font-semibold uppercase tracking-[0.3em] text-muted-foreground">
            What sits on the RC shelf
          </p>
          <MarqueeRow items={TICKER} />
          <MarqueeRow items={[...TICKER].reverse()} reverse />
        </section>

        {/* signature PCB trace — draws itself, then signals forever */}
        <CircuitTrace className="pt-6" />

        {/* ── try it (interactive scan + search demos) ────────────── */}
        <TrySection />

        {/* ── stats ───────────────────────────────────────────────── */}
        <StatsBand />

        {/* ── categories (motion-heavy, filterable) ───────────────── */}
        <CategoryExplorer />

        {/* ── every module ────────────────────────────────────────── */}
        <ModulesSection />

        {/* ── features bento ──────────────────────────────────────── */}
        <FeaturesSection />

        {/* ── offline band ────────────────────────────────────────── */}
        <OfflineBand />

        {/* ── how it works ────────────────────────────────────────── */}
        <HowItWorks />

        {/* ── roles ───────────────────────────────────────────────── */}
        <RolesSection />

        {/* ── voices from clubs already running it ────────────────── */}
        <Testimonials />

        <CircuitTrace className="pt-8" reverse />

        {/* ── CTA ─────────────────────────────────────────────────── */}
        <CtaSection
          onPrimary={() => navigate("/auth")}
          label={isAuthenticated ? "Open the dashboard" : "Sign in to RC"}
        />

        <footer className="relative z-10 border-t border-border/60 py-8">
          <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-2 px-6 text-xs text-muted-foreground sm:flex-row">
            <p>RC — Robotics Club Inventory</p>
            <p>
              Scan first. Spreadsheet never.{" "}
              <motion.span
                animate={{ y: [0, -4, 0] }}
                transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
                className="inline-block"
              >
                🤖
              </motion.span>
            </p>
          </div>
        </footer>
      </div>
    </MotionConfig>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   Backdrop — drifting aurora over the app-wide cover, plus a scrolling
   grid. Pointer-events off so it never eats a click.
   ══════════════════════════════════════════════════════════════════════ */

function Aurora() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 top-0 h-160 overflow-hidden"
    >
      <div className="absolute -top-48 left-1/2 h-125 w-200 -translate-x-1/2 rounded-full bg-primary/12 blur-3xl animate-aurora" />
      <div className="absolute right-[-12%] top-1/4 h-96 w-96 rounded-full bg-violet-500/10 blur-3xl animate-aurora [animation-delay:-6s]" />
      <div className="absolute left-[-10%] top-2/3 h-80 w-80 rounded-full bg-cyan-400/8 blur-3xl animate-aurora [animation-delay:-12s]" />
      <div className="animate-grid-pan grid-bg absolute inset-0 opacity-60 [mask-image:radial-gradient(70%_60%_at_50%_0%,#000_0%,transparent_100%)]" />
    </div>
  );
}

/** Thin neon progress line pinned under the nav — feedback for long page. */
function ScrollProgress() {
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, { stiffness: 140, damping: 26, mass: 0.3 });

  return (
    <motion.div
      aria-hidden
      style={{ scaleX }}
      className="fixed inset-x-0 top-0 z-40 h-0.5 origin-left bg-gradient-to-r from-primary via-cyan-400 to-violet-500"
    />
  );
}

function Nav({ isAuthenticated }: { isAuthenticated: boolean }) {
  const [scrolled, setScrolled] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 16);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const links = [
    ["#try", "Try it"],
    ["#categories", "Categories"],
    ["#features", "Features"],
    ["#modules", "Everything"],
    ["#how", "How it works"],
    ["#roles", "Roles"],
  ] as const;

  return (
    <div
      className={cn(
        "mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-6 py-4 transition-all duration-300",
        scrolled && "glass-strong rounded-2xl px-5 py-3 shadow-lg",
      )}
    >
      <Link to="/" className="flex items-center gap-2.5">
        <motion.img
          src={logo}
          alt="RC logo"
          className="size-9 rounded-lg"
          animate={{ rotate: [0, -6, 6, 0] }}
          transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
        />
        <span className="text-lg font-bold tracking-tight">RC</span>
      </Link>

      <nav className="hidden items-center gap-6 text-sm text-muted-foreground md:flex">
        {links.map(([href, label]) => (
          <a key={href} href={href} className="group relative transition-colors hover:text-foreground">
            {label}
            <span className="absolute -bottom-1 left-0 h-px w-0 bg-primary transition-all duration-300 group-hover:w-full" />
          </a>
        ))}
      </nav>

      <div className="flex items-center gap-2">
        {isAuthenticated ? (
          <Button size="sm" onClick={() => navigate("/dashboard")}>
            Dashboard <ArrowRight className="size-4" />
          </Button>
        ) : (
          <>
            <Button
              size="sm"
              variant="ghost"
              className="hidden sm:inline-flex"
              onClick={() => navigate("/auth")}
            >
              Sign in
            </Button>
            <Button size="sm" onClick={() => navigate("/auth")}>
              Get started
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   Hero — words rise in sequence, the demo card tilts toward the cursor,
   and a live "available" pill breathes.
   ══════════════════════════════════════════════════════════════════════ */

const STATUS_LINES = [
  "Reading QR tag — ARD-003…",
  "Request sent — the admin sees it live.",
  "Admin approved — pick it up from the lab.",
];

function Hero({ onCta, onScan }: { onCta: () => void; onScan: () => void }) {
  const px = useMotionValue(0);
  const py = useMotionValue(0);
  const sx = useSpring(px, { stiffness: 120, damping: 20 });
  const sy = useSpring(py, { stiffness: 120, damping: 20 });
  const rotateX = useTransform(sy, [-1, 1], [7, -7]);
  const rotateY = useTransform(sx, [-1, 1], [-9, 9]);

  // The faux scanner tells its little story on loop: read → sent → approved.
  // Reduced-motion users land on the final state and stay there.
  const reduceMotion = useReducedMotion();
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    if (reduceMotion) {
      setPhase(2);
      return;
    }
    const t = window.setInterval(
      () => setPhase((p) => (p + 1) % STATUS_LINES.length),
      2600,
    );
    return () => window.clearInterval(t);
  }, [reduceMotion]);

  const headline = ["Every", "part", "accounted", "for."];

  return (
    <section
      id="hero"
      onPointerMove={(e) => {
        const box = e.currentTarget.getBoundingClientRect();
        px.set((e.clientX - box.left) / box.width - 0.5);
        py.set((e.clientY - box.top) / box.height - 0.5);
      }}
      className="relative z-10 mx-auto flex w-full max-w-6xl flex-col items-center px-6 pb-20 pt-14 text-center md:pt-24"
    >
      {/* drifting part-icons — quiet depth flanking the scanner card */}
      <div aria-hidden className="pointer-events-none absolute inset-0 hidden md:block">
        {[
          { Icon: Cpu, pos: "left-[4%] bottom-[34%]", delay: 0, tilt: 1 },
          { Icon: Bolt, pos: "right-[5%] bottom-[38%]", delay: 0.9, tilt: -1 },
          { Icon: Radio, pos: "left-[8%] bottom-[14%]", delay: 1.7, tilt: -1 },
          { Icon: Gauge, pos: "right-[8%] bottom-[16%]", delay: 2.4, tilt: 1 },
        ].map(({ Icon, pos, delay, tilt }, i) => (
          <motion.span
            key={i}
            className={cn(
              "icon-glass absolute flex size-11 items-center justify-center rounded-xl text-primary/70",
              pos,
            )}
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{
              opacity: 0.85,
              scale: 1,
              y: [0, -14, 0],
              rotate: [0, 7 * tilt, 0],
            }}
            transition={{
              opacity: { delay: 0.8 + delay * 0.1, duration: 0.5 },
              scale: { delay: 0.8 + delay * 0.1, duration: 0.5, ease: [0.16, 1, 0.3, 1] },
              y: { duration: 5.5 + i, repeat: Infinity, ease: "easeInOut", delay },
              rotate: { duration: 6.5 + i, repeat: Infinity, ease: "easeInOut", delay },
            }}
          >
            <Icon className="size-5" />
          </motion.span>
        ))}
      </div>
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.1 }}
        className="mb-4"
      >
        <TrackingFlip />
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <Badge
          variant="outline"
          className="gap-2 border-primary/40 bg-primary/10 px-3 py-1 text-primary"
        >
          <motion.span
            animate={{ scale: [1, 1.25, 1] }}
            transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
            className="flex"
          >
            <Camera className="size-3.5" />
          </motion.span>
          QR-native inventory for the lab
        </Badge>
      </motion.div>

      <h1 className="mt-6 max-w-3xl text-4xl font-bold tracking-tight sm:text-5xl md:text-6xl">
        <span className="block">
          {headline.map((word, i) => (
            <motion.span
              key={word}
              className="inline-block"
              initial={{ opacity: 0, y: 26, filter: "blur(6px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              transition={{ ...stagger(i, 0.09), duration: 0.6 }}
            >
              {word}
              {i < headline.length - 1 ? " " : ""}
            </motion.span>
          ))}
          <motion.span
            className="neon-text block"
            initial={{ opacity: 0, y: 26, filter: "blur(6px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            transition={{ ...stagger(headline.length, 0.09), duration: 0.6 }}
          >
            One scan away.
          </motion.span>
        </span>
      </h1>

      {/* one drifting chip row instead of a paragraph */}
      <motion.div
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.55, delay: 0.28 }}
        className="mt-6 flex max-w-xl flex-wrap items-center justify-center gap-2"
      >
        {["Rentals", "Returns", "Projects", "Packages", "Labels", "Exports", "3D slicer"].map(
          (chip, i) => (
            <motion.span
              key={chip}
              animate={{ y: [0, -4, 0] }}
              transition={{
                duration: 3,
                repeat: Infinity,
                ease: "easeInOut",
                delay: i * 0.45,
              }}
              className="rounded-full border border-border/60 bg-background/50 px-3 py-1.5 text-xs font-medium text-muted-foreground backdrop-blur-sm"
            >
              {chip}
            </motion.span>
          ),
        )}
        <motion.span
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6 }}
          className="flex items-center gap-1.5 text-xs text-primary"
        >
          <WifiOff className="size-3.5" /> works offline
        </motion.span>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.55, delay: 0.4 }}
        className="mt-8 flex flex-col gap-3 sm:flex-row"
      >
        <Button
          size="lg"
          className="neon-glow press-3d relative gap-2 overflow-hidden"
          onClick={onCta}
        >
          <span
            aria-hidden
            className="animate-glint pointer-events-none absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-white/35 to-transparent"
          />
          Enter the lab <ArrowRight className="size-4" />
        </Button>
        <Button size="lg" variant="outline" className="press-3d gap-2" onClick={onScan}>
          <ScanLine className="size-4" /> Try a scan
        </Button>
      </motion.div>

      {/* Faux scanner: shows the payoff — a unit, its numbers, an approval. */}
      <motion.div
        style={{ rotateX, rotateY, transformPerspective: 1100 }}
        initial={{ opacity: 0, y: 40, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.7, delay: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="mt-14 w-full max-w-xl"
      >
        <div className="glass relative overflow-hidden rounded-2xl p-6 text-left">
          {/* viewfinder corners + a laser bar sweeping the unit */}
          <span
            aria-hidden
            className="animate-laser pointer-events-none absolute inset-x-5 top-3 h-14 rounded-full bg-gradient-to-b from-transparent via-primary/25 to-transparent blur-md"
          />
          <span
            aria-hidden
            className="pointer-events-none absolute left-3 top-3 h-5 w-5 rounded-tl-md border-l-2 border-t-2 border-primary/70"
          />
          <span
            aria-hidden
            className="pointer-events-none absolute right-3 top-3 h-5 w-5 rounded-tr-md border-r-2 border-t-2 border-primary/70"
          />
          <span
            aria-hidden
            className="pointer-events-none absolute bottom-3 left-3 h-5 w-5 rounded-bl-md border-b-2 border-l-2 border-primary/70"
          />
          <span
            aria-hidden
            className="pointer-events-none absolute bottom-3 right-3 h-5 w-5 rounded-br-md border-b-2 border-r-2 border-primary/70"
          />
          <div className="relative flex items-center gap-3 border-b border-border/60 pb-4">
            <div className="icon-glass flex size-11 items-center justify-center rounded-lg text-primary">
              <motion.span
                animate={{ rotate: [0, 90, 180, 270, 360] }}
                transition={{ duration: 14, repeat: Infinity, ease: "linear" }}
                className="flex"
              >
                <QrCode className="size-5" />
              </motion.span>
            </div>
            <div>
              <p className="font-mono text-xs text-muted-foreground">ARD-003 · scanned</p>
              <p className="text-sm font-semibold">Arduino Uno — unit 3</p>
            </div>
            <Badge
              variant="outline"
              className="relative ml-auto border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
            >
              <span className="absolute inset-0 -z-10 animate-ping-ring rounded-full border border-emerald-500/50" />
              Available
            </Badge>
          </div>

          <div className="grid grid-cols-3 gap-3 pt-4 text-center text-xs">
            {[
              ["8", "units total"],
              ["3", "available now"],
              ["2", "on projects"],
            ].map(([v, l]) => (
              <div
                key={l}
                className="glass-3d lift-3d rounded-lg border border-border/60 bg-background/40 px-3 py-3"
              >
                <p className="text-lg font-bold tabular-nums">{v}</p>
                <p className="text-muted-foreground">{l}</p>
              </div>
            ))}
          </div>

          <div
            className={cn(
              "mt-4 flex items-center gap-2 overflow-hidden rounded-lg border px-4 py-3 text-xs transition-colors duration-500",
              phase === 2
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
                : phase === 1
                  ? "border-sky-500/40 bg-sky-500/10 text-sky-400"
                  : "border-primary/30 bg-primary/5 text-primary",
            )}
          >
            <AnimatePresence mode="wait">
              <motion.span
                key={phase}
                initial={{ y: 14, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: -14, opacity: 0 }}
                transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                className="relative flex items-center gap-2"
              >
                {phase === 0 && <ScanLine className="size-4 shrink-0" />}
                {phase === 1 && <Zap className="size-4 shrink-0" />}
                {phase === 2 && <CheckCircle2 className="size-4 shrink-0" />}
                <span className="relative">
                  {STATUS_LINES[phase]}
                  <span className="animate-sweep absolute inset-x-0 bottom-0 h-px origin-left bg-current opacity-50" />
                </span>
              </motion.span>
            </AnimatePresence>
          </div>
        </div>
      </motion.div>
    </section>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   Stats — product facts (module counts, offline reads), counting up.
   ══════════════════════════════════════════════════════════════════════ */

function StatsBand() {
  return (
    <section className="relative z-10 mx-auto w-full max-w-6xl px-6 py-14">
      <div className="glass grid gap-4 rounded-2xl p-6 sm:grid-cols-2 lg:grid-cols-4">
        {STATS.map(({ value, suffix, label, hint }, i) => (
          <motion.div key={label} {...fadeUp} transition={stagger(i)} className="text-center">
            <p className="text-4xl font-bold tracking-tight neon-text">
              <CountUp to={value} suffix={suffix} />
            </p>
            <p className="mt-1 text-sm font-medium">{label}</p>
            <p className="text-xs text-muted-foreground">{hint}</p>
          </motion.div>
        ))}
      </div>
    </section>
  );
}

/* ══════════════════════════════════════════════════════════════════
   Category explorer — a wall of living chips. Every category is ONE chip
   (icon + name + count); tapping (or auto-touring) animates its story
   through a single shared stage below. Zero text walls.
   ══════════════════════════════════════════════════════════════════════ */

function CategoryExplorer() {
  const [active, setActive] = useState(CATEGORIES[0].name);
  const [touched, setTouched] = useState(false);
  const reduceMotion = useReducedMotion();
  const cat = CATEGORIES.find((c) => c.name === active) ?? CATEGORIES[0];

  // Auto-tour: cycle through the categories until the visitor takes over.
  useEffect(() => {
    if (touched || reduceMotion) return;
    const t = setInterval(() => {
      setActive((cur) => {
        const i = CATEGORIES.findIndex((c) => c.name === cur);
        return CATEGORIES[(i + 1) % CATEGORIES.length].name;
      });
    }, 3200);
    return () => clearInterval(t);
  }, [touched, reduceMotion]);

  return (
    <section id="categories" className="relative z-10 mx-auto w-full max-w-6xl px-6 py-20">
      <motion.div {...fadeUp} transition={{ duration: 0.5 }} className="mx-auto max-w-2xl text-center">
        <Badge
          variant="outline"
          className="mx-auto w-fit gap-2 border-primary/40 bg-primary/10 px-3 text-primary"
        >
          <Camera className="size-3.5" />
          Every shelf, every category
        </Badge>
        <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
          Your club's shelves, sorted and searchable.
        </h2>
        <p className="mt-2 text-muted-foreground">Tap a chip — each one is a live, QR-coded shelf.</p>
      </motion.div>

      {/* the chip wall */}
      <motion.div
        {...fadeUp}
        transition={{ duration: 0.5, delay: 0.1 }}
        className="mt-8 flex flex-wrap items-stretch justify-center gap-2.5"
      >
        {CATEGORIES.map(({ icon: Icon, name, units }, i) => {
          const on = name === active;
          return (
            <motion.button
              key={name}
              type="button"
              onClick={() => {
                setTouched(true);
                setActive(name);
              }}
              {...fadeUp}
              transition={stagger(i, 0.04)}
              whileHover={{ scale: 1.06, y: -3 }}
              whileTap={{ scale: 0.94 }}
              animate={on ? { scale: 1.04 } : { scale: 1 }}
              className={cn(
                "relative flex items-center gap-2.5 rounded-2xl border px-4 py-2.5 text-sm transition-colors duration-300",
                on
                  ? "border-primary/60 bg-primary/10 text-foreground shadow-lg shadow-primary/10"
                  : "border-border/70 bg-background/40 text-muted-foreground hover:border-primary/30 hover:text-foreground",
              )}
            >
              {on && (
                <motion.span
                  layoutId="category-glow"
                  className="absolute inset-0 -z-10 rounded-2xl bg-primary/10 blur-md"
                  transition={{ type: "spring", stiffness: 320, damping: 30 }}
                />
              )}
              <span
                className={cn(
                  "flex size-8 items-center justify-center rounded-lg transition-colors duration-300",
                  on ? "bg-primary text-primary-foreground" : "bg-primary/10 text-primary",
                )}
              >
                <Icon className="size-4" />
              </span>
              <span className="font-medium">{name}</span>
              <span
                className={cn(
                  "rounded-full px-1.5 py-0.5 font-mono text-[10px] tabular-nums transition-colors duration-300",
                  on ? "bg-primary text-primary-foreground" : "bg-border/60 text-muted-foreground",
                )}
              >
                {units}
              </span>
            </motion.button>
          );
        })}
      </motion.div>

      {/* the shared stage: one animated panel tells the active chip's story */}
      <div className="relative mx-auto mt-10 min-h-[240px] max-w-3xl">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={cat.name}
            initial={{ opacity: 0, y: 18, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -14, scale: 0.98 }}
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="glass-3d relative flex flex-col items-center gap-6 overflow-hidden rounded-3xl p-8 sm:flex-row sm:p-10">
              <div
                aria-hidden
                className="absolute -right-10 -top-10 size-40 rounded-full bg-primary/10 blur-3xl animate-breathe"
              />
              <div className="relative flex size-24 shrink-0 items-center justify-center">
                <span className="absolute inset-0 rounded-3xl border border-primary/30 animate-ping-ring" />
                <div className="icon-glass flex size-20 items-center justify-center rounded-2xl text-primary">
                  <cat.icon className="icon-3d size-9" />
                </div>
              </div>

              <div className="relative min-w-0 text-center sm:text-left">
                <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
                  <h3 className="text-2xl font-bold tracking-tight">{cat.name}</h3>
                  <Badge variant="outline" className="border-primary/40 font-mono text-xs text-primary">
                    {cat.units} units
                  </Badge>
                  <Badge variant="outline" className="font-mono text-xs text-muted-foreground">
                    {cat.group}
                  </Badge>
                </div>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{cat.blurb}</p>
                <p className="mt-3 flex items-center justify-center gap-2 text-xs text-primary sm:justify-start">
                  <QrCode className="size-4" /> Scan its label on the shelf to rent a unit
                </p>
              </div>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
    </section>
  );
}



/* ══════════════════════════════════════════════════════════════════════
   Modules — every page the app has, grouped by who uses it.
   ══════════════════════════════════════════════════════════════════════ */

function ModuleGrid({
  title,
  items,
  offset = 0,
}: {
  title: string;
  items: typeof MEMBER_MODULES;
  offset?: number;
}) {
  return (
    <>
      <motion.p
        {...fadeUp}
        transition={{ duration: 0.4 }}
        className="mt-12 text-center text-xs font-semibold uppercase tracking-widest text-muted-foreground"
      >
        {title}
      </motion.p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.map(({ icon: Icon, name, body }, i) => (
          <motion.div key={name} {...fadeUp} transition={stagger(i + offset, 0.05)}>
            <SpotlightCard className="h-full">
              <div className="flex h-full flex-col p-5">
                <div className="icon-glass flex size-10 items-center justify-center rounded-lg text-primary">
                  <Icon className="icon-3d size-5" />
                </div>
                <h3 className="mt-2.5 font-semibold tracking-tight">{name}</h3>
                <p className="mt-1.5 flex-1 text-xs leading-5 text-muted-foreground">{body}</p>
              </div>
            </SpotlightCard>
          </motion.div>
        ))}
      </div>
    </>
  );
}

function ModulesSection() {
  return (
    <section id="modules" className="relative z-10 mx-auto w-full max-w-6xl px-6 pb-8">
      <motion.div {...fadeUp} transition={{ duration: 0.5 }} className="mx-auto max-w-2xl text-center">
        <Badge
          variant="outline"
          className="mx-auto w-fit gap-2 border-primary/40 bg-primary/10 px-3 text-primary"
        >
          <Boxes className="size-3.5" />
          Everything the app offers
        </Badge>
        <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
          One workspace, every lab workflow.
        </h2>
        <p className="mt-3 text-muted-foreground">
          From a single QR scan to a slicer job, from your desk to the lab and back again offline —
          RC covers the whole inventory story.
        </p>
      </motion.div>

      <ModuleGrid title="Member workspace" items={MEMBER_MODULES} />
      <ModuleGrid title="Admin console" items={ADMIN_MODULES} offset={6} />
    </section>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   Features — bento: one wide promise card, then the supporting six.
   ══════════════════════════════════════════════════════════════════════ */

function FeaturesSection() {
  return (
    <section id="features" className="relative z-10 mx-auto w-full max-w-6xl px-6 py-20">
      <motion.div {...fadeUp} transition={{ duration: 0.5 }} className="mx-auto max-w-2xl text-center">
        <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
          Built for makers, not spreadsheets
        </h2>
        <p className="mt-3 text-muted-foreground">
          Hardware lives in storages, parts go missing, projects hoard components. RC keeps the
          whole story straight — and does it on your phone, in the lab, offline.
        </p>
      </motion.div>

      <div className="mt-12 grid gap-4 lg:grid-cols-3">
        <motion.div {...fadeUp} transition={{ duration: 0.5 }} className="lg:col-span-2">
          <SpotlightCard className="h-full">
            <div className="flex h-full flex-col justify-between gap-6 p-8">
              <div>
                <div className="icon-glass flex size-12 items-center justify-center rounded-xl text-primary">
                  <ScanLine className="icon-3d size-6" />
                </div>
                <h3 className="mt-4 text-2xl font-bold tracking-tight">
                  Point. Scan. Rented.
                </h3>
                <p className="mt-2 max-w-lg text-sm leading-6 text-muted-foreground">
                  Every shelf unit carries its own QR tag. Scan it in the lab and the rental request is
                  one tap away — no forms, no hunting through a spreadsheet, no asking which drawer
                  it's in. The admin approves from their inbox; you're back on the bench in seconds.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {["Instant request", "Email approval", "Live availability", "Zero paperwork"].map(
                  (chip) => (
                    <span
                      key={chip}
                      className="rounded-full border border-border/60 bg-background/50 px-3 py-1.5 text-xs text-muted-foreground"
                    >
                      {chip}
                    </span>
                  ),
                )}
              </div>
            </div>
          </SpotlightCard>
        </motion.div>

        <motion.div {...fadeUp} transition={stagger(1)} className="flex">
          <SpotlightCard className="h-full w-full">
            <div className="flex h-full flex-col p-6">
              <div className="icon-glass flex size-11 items-center justify-center rounded-lg text-primary">
                <Box className="icon-3d size-5" />
              </div>
              <h3 className="mt-3 font-semibold tracking-tight">Built-in 3D slicer</h3>
              <p className="mt-1.5 flex-1 text-sm leading-6 text-muted-foreground">
                Kiri:Moto runs embedded in the 3D printing tab, with the printer, material and
                filament in view. Slice, preview and export job files without leaving the lab.
              </p>
              <div className="mt-4 flex items-center gap-1.5 text-xs text-primary">
                <motion.span
                  animate={{ opacity: [0.4, 1, 0.4] }}
                  transition={{ duration: 1.8, repeat: Infinity }}
                >
                  ●●●
                </motion.span>
                slicing in-browser
              </div>
            </div>
          </SpotlightCard>
        </motion.div>

        {FEATURES.map(({ icon: Icon, title, body }, i) => (
          <motion.div key={title} {...fadeUp} transition={stagger(i + 2, 0.05)}>
            <SpotlightCard className="h-full">
              <div className="flex h-full flex-col p-6">
                <div className="icon-glass flex size-11 items-center justify-center rounded-lg text-primary">
                  <Icon className="icon-3d size-5" />
                </div>
                <h3 className="mt-3 font-semibold tracking-tight">{title}</h3>
                <p className="mt-1.5 flex-1 text-sm leading-6 text-muted-foreground">{body}</p>
              </div>
            </SpotlightCard>
          </motion.div>
        ))}
      </div>
    </section>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   Offline band — the differentiator, with a live-looking sync visual.
   ══════════════════════════════════════════════════════════════════════ */

function OfflineBand() {
  return (
    <section className="relative z-10 mx-auto w-full max-w-6xl px-6 pb-20">
      <motion.div
        {...fadeUp}
        transition={{ duration: 0.5 }}
        className="glass relative overflow-hidden rounded-2xl p-8 text-center sm:p-12"
      >
        <div
          aria-hidden
          className="absolute -right-16 -top-16 size-64 rounded-full bg-violet-500/12 blur-3xl animate-breathe"
        />
        <Badge
          variant="outline"
          className="mx-auto w-fit gap-2 border-violet-500/40 bg-violet-500/10 px-3 text-violet-400"
        >
          <CloudOff className="size-3.5" />
          Offline first
        </Badge>
        <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
          The database is always on your side.
        </h2>
        <p className="mx-auto mt-3 max-w-3xl text-muted-foreground">
          The first time you open RC, the entire database for your club is synced and stored
          locally on your device. Every page reads from that cache — nothing waits on the network, and
          your tabs stay fast even with zero signal.
        </p>
        <p className="mx-auto mt-2 max-w-3xl text-muted-foreground">
          Updates arrive only as interrupts: when another member changes something, the app is notified
          and refreshes precisely what changed. Open it again and it pulls everything since your last
          visit. Even sign-in works offline, using the session already on your device.
        </p>

        {/* device → cloud → device, with travelling pulses */}
        <div className="relative mx-auto mt-10 flex max-w-md items-center justify-center gap-3">
          <div className="icon-glass flex size-12 items-center justify-center rounded-xl text-primary">
            <Camera className="size-5" />
          </div>
          <div className="relative h-px flex-1 overflow-hidden bg-border">
            <motion.span
              className="absolute inset-y-0 w-8 rounded-full bg-primary/70"
              animate={{ x: ["-10%", "320%"] }}
              transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
            />
          </div>
          <div className="icon-glass flex size-12 items-center justify-center rounded-xl text-violet-400">
            <CloudOff className="size-5" />
          </div>
        </div>

        <div className="mt-10 grid gap-4 text-left sm:grid-cols-3">
          {OFFLINE_POINTS.map(({ icon: Icon, title, body }, i) => (
            <motion.div key={title} {...fadeUp} transition={stagger(i)}>
              <SpotlightCard className="h-full">
                <div className="flex h-full flex-col p-6">
                  <div className="icon-glass flex size-10 items-center justify-center rounded-lg text-primary">
                    <Icon className="icon-3d size-5" />
                  </div>
                  <h3 className="mt-2.5 font-semibold tracking-tight">{title}</h3>
                  <p className="mt-1.5 text-sm leading-6 text-muted-foreground">{body}</p>
                </div>
              </SpotlightCard>
            </motion.div>
          ))}
        </div>
      </motion.div>
    </section>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   How it works — timeline whose spine fills as you scroll past it.
   ══════════════════════════════════════════════════════════════════════ */

function HowItWorks() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start 0.85", "end 0.55"],
  });
  const fill = useSpring(scrollYProgress, { stiffness: 120, damping: 28, mass: 0.4 });

  return (
    <section id="how" className="relative z-10 mx-auto w-full max-w-6xl px-6 py-20">
      <motion.div {...fadeUp} transition={{ duration: 0.5 }} className="mx-auto max-w-2xl text-center">
        <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
          From shelf to robot in four steps
        </h2>
      </motion.div>

      <div ref={ref} className="relative mt-12">
        {/* spine */}
        <div className="absolute left-[19px] top-2 hidden h-[calc(100%-1rem)] w-px bg-border sm:block" />
        <motion.div
          style={{ scaleY: fill }}
          className="absolute left-[19px] top-2 hidden h-[calc(100%-1rem)] w-px origin-top bg-primary sm:block"
        />

        <div className="flex flex-col gap-6">
          {STEPS.map(({ n, title, body }, i) => (
            <motion.div
              key={n}
              {...fadeUp}
              transition={stagger(i, 0.1)}
              className="relative sm:pl-16"
            >
              <div className="icon-glass absolute left-0 top-0 hidden size-10 items-center justify-center rounded-full font-mono text-sm text-primary sm:flex">
                {n}
              </div>
              <SpotlightCard className="h-full">
                <div className="flex h-full items-start gap-4 p-6">
                  <span className="font-mono text-sm text-primary sm:hidden">{n}</span>
                  <div>
                    <h3 className="font-semibold tracking-tight">{title}</h3>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">{body}</p>
                  </div>
                </div>
              </SpotlightCard>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   Roles
   ══════════════════════════════════════════════════════════════════════ */

function RolesSection() {
  return (
    <section id="roles" className="relative z-10 mx-auto w-full max-w-6xl px-6 py-20">
      <div className="grid gap-4 md:grid-cols-2">
        {(
          [
            {
              badge: "For members",
              badgeClass: "border-primary/40 text-primary",
              title: "Find it, request it, build it",
              points: ROLE_MEMBER,
              dot: "text-primary",
            },
            {
              badge: "For the admin",
              badgeClass: "border-violet-500/40 text-violet-400",
              title: "Total oversight, zero chasing",
              points: ROLE_ADMIN,
              dot: "text-violet-400",
            },
          ] as const
        ).map((role, i) => (
          <motion.div key={role.badge} {...fadeUp} transition={stagger(i, 0.1)}>
            <SpotlightCard className="h-full">
              <div className="flex h-full flex-col gap-4 p-8">
                <Badge variant="outline" className={cn("w-fit", role.badgeClass)}>
                  {role.badge}
                </Badge>
                <h3 className="text-xl font-semibold tracking-tight">{role.title}</h3>
                <ul className="flex flex-col gap-2.5 text-sm text-muted-foreground">
                  {role.points.map((t) => (
                    <li key={t} className="flex items-start gap-2">
                      <CheckCircle2 className={cn("mt-0.5 size-4 shrink-0", role.dot)} /> {t}
                    </li>
                  ))}
                </ul>
              </div>
            </SpotlightCard>
          </motion.div>
        ))}
      </div>
    </section>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   CTA
   ══════════════════════════════════════════════════════════════════════ */

function CtaSection({ onPrimary, label }: { onPrimary: () => void; label: string }) {
  return (
    <section className="relative z-10 mx-auto w-full max-w-6xl px-6 pb-24">
      <motion.div
        {...fadeUp}
        transition={{ duration: 0.5 }}
        className="neon-ring relative overflow-hidden rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/12 via-card/60 to-violet-500/10 px-8 py-16 text-center"
      >
      {/* meshing gears — the machine room behind the open-door CTA */}
      <div
        aria-hidden
        className="pointer-events-none absolute -left-16 -top-20 hidden text-primary/15 md:block"
      >
        <Gear className="animate-gear size-52" teeth={16} />
      </div>
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-24 -right-12 hidden items-end text-primary/12 md:flex"
      >
        <Gear className="animate-gear size-44" teeth={11} />
        <Gear className="animate-gear-rev -ml-12 size-28" teeth={7} />
      </div>
        <div className="relative mx-auto flex size-16 items-center justify-center">
          <span className="absolute inset-0 animate-ping-ring rounded-2xl border border-primary/50" />
          <Boxes className="size-8 text-primary" />
        </div>
        <h2 className="relative mt-6 text-3xl font-bold tracking-tight sm:text-4xl">The lab is open</h2>
        <p className="relative mx-auto mt-2 max-w-md text-sm text-muted-foreground">
          Sign in with your club email and start scanning. Admins are set by email allow-list — and
          once you're in, the app keeps working even when the wifi doesn't.
        </p>
        <div className="relative mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          <Button
            size="lg"
            className="neon-glow press-3d relative gap-2 overflow-hidden"
            onClick={onPrimary}
          >
            <span
              aria-hidden
              className="animate-glint pointer-events-none absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-white/35 to-transparent"
            />
            {label} <ArrowRight className="size-4" />
          </Button>
          <Button size="lg" variant="outline" className="press-3d gap-2" onClick={onPrimary}>
            <ScanLine className="size-4" /> Scan a unit
          </Button>
        </div>
      </motion.div>
    </section>
  );
}