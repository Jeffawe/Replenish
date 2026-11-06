import Link from "next/link";

const STEPS = [
  {
    title: "Add what you buy",
    text: "Snap a receipt, forward an order email, or type it in. Every wording you confirm is remembered.",
    icon: "M4 7h16M4 12h10M4 17h6M18 14l2 2 4-4",
  },
  {
    title: "It learns your pace",
    text: "From the gaps between purchases it works out what's left, when it runs out, and how sure it is.",
    icon: "M3 17l6-6 4 4 8-8M15 7h6v6",
  },
  {
    title: "It restocks for you",
    text: "When something runs low it finds it online and asks first, or buys within the limits you set.",
    icon: "M3 4h2l2.4 10.4a1 1 0 001 .8h9.2a1 1 0 001-.8L20 8H6M9 20h.01M17 20h.01",
  },
];

/** Made-up examples for the picture beside the headline: how many days each essential should last. */
const STOCK = [
  { name: "Milk", left: "2 days left", fill: "w-[14%]", tone: "bg-red-500" },
  { name: "Toilet paper", left: "6 days left", fill: "w-[40%]", tone: "bg-amber-500" },
  { name: "Dish soap", left: "11 days left", fill: "w-[68%]", tone: "bg-emerald-500" },
  { name: "Coffee", left: "19 days left", fill: "w-[90%]", tone: "bg-emerald-500" },
];

const START =
  "inline-flex items-center gap-2 rounded-full bg-emerald-600 px-8 py-4 text-base font-medium text-white shadow-lg shadow-emerald-600/25 transition hover:bg-emerald-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600";

/** The logo, inline so it needs no request and can't be held up by the sign-in proxy. Same drawing as src/app/icon.svg. */
function Logo() {
  return (
    <svg viewBox="4 7 56 56" className="size-5" aria-hidden>
      <defs>
        <clipPath id="logo-inside">
          <path d="M17 17 H47 L43.6 55 Q43.2 59 39.2 59 H24.8 Q20.8 59 20.4 55 Z" />
        </clipPath>
        <linearGradient id="logo-water" gradientUnits="userSpaceOnUse" x1="0" y1="33" x2="0" y2="59">
          <stop offset="0" stopColor="#34d399" />
          <stop offset="1" stopColor="#059669" />
        </linearGradient>
      </defs>
      <path clipPath="url(#logo-inside)" d="M0 38 Q8 34 16 38 T32 38 T48 38 T64 38 V64 H0 Z" fill="url(#logo-water)" />
      <path d="M32 9 C32 9 27.6 15.4 27.6 18.6 A4.4 4.4 0 0 0 36.4 18.6 C36.4 15.4 32 9 32 9 Z" fill="#10b981" />
      <path d="M17 17 L20.4 55 Q20.8 59 24.8 59 H39.2 Q43.2 59 43.6 55 L47 17" fill="none" stroke="#059669" strokeWidth="3.6" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function Arrow() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

/** The front door. Static: "Get started" goes to the dashboard, and the proxy sends anyone signed out on to /login. */
export default function Home() {
  return (
    <div className="relative flex-1 overflow-hidden">
      {/* Soft colour behind the page; decoration only. */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[40rem] bg-[radial-gradient(60rem_30rem_at_70%_-10%,rgba(16,185,129,0.18),transparent),radial-gradient(40rem_25rem_at_0%_20%,rgba(20,184,166,0.12),transparent)]" />

      <main className="mx-auto flex w-full max-w-6xl flex-col gap-24 px-5 pb-20 sm:px-8">
        <section className="grid min-h-[calc(100svh-4rem)] items-center gap-12 pt-10 lg:grid-cols-2">
          <div className="flex flex-col items-start gap-6">
            <span className="inline-flex items-center gap-2 rounded-full border border-emerald-600/30 bg-emerald-600/10 py-1 pl-2 pr-3 text-sm font-medium text-emerald-700 dark:text-emerald-400">
              <Logo />
              Replenish
            </span>
            <h1 className="text-5xl font-semibold leading-[1.05] tracking-tight sm:text-6xl">
              Replenish keeps track of your <span className="text-emerald-600 dark:text-emerald-400">essentials</span>.
            </h1>
            <p className="max-w-lg text-lg text-zinc-600 dark:text-zinc-400">
              It learns how fast your household uses things up, knows when each one will run out, and restocks it before it does.
            </p>
            <Link href="/dashboard" className={START}>
              Get started <Arrow />
            </Link>
          </div>

          {/* An example of the dashboard, drawn here rather than a screenshot. */}
          <div aria-hidden className="relative mx-auto w-full max-w-md">
            <div className="rounded-3xl border border-zinc-200 bg-white/80 p-5 shadow-2xl shadow-emerald-900/10 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/70">
              <div className="mb-4 flex items-center justify-between">
                <p className="text-sm font-medium">At home</p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">Example</p>
              </div>
              <ul className="flex flex-col gap-4">
                {STOCK.map((item) => (
                  <li key={item.name} className="flex flex-col gap-1.5">
                    <div className="flex justify-between text-sm">
                      <span className="font-medium">{item.name}</span>
                      <span className="text-zinc-500 dark:text-zinc-400">{item.left}</span>
                    </div>
                    <div className="h-2 rounded-full bg-zinc-200 dark:bg-zinc-800">
                      <div className={`h-2 rounded-full ${item.fill} ${item.tone}`} />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
            <div className="mt-4 rounded-2xl border border-emerald-600/30 bg-emerald-50 p-4 shadow-lg dark:bg-emerald-950">
              <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">Running low</p>
              <p className="mt-1 text-sm font-medium">Milk, 1 gallon. Same one you usually buy.</p>
              <div className="mt-3 flex gap-2 text-xs font-medium">
                <span className="rounded-full bg-emerald-600 px-3 py-1.5 text-white">Buy for me</span>
                <span className="rounded-full border border-zinc-300 px-3 py-1.5 dark:border-zinc-700">I just bought this</span>
              </div>
            </div>
          </div>
        </section>

        <section className="flex flex-col gap-8">
          <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">Three steps, and then it runs itself.</h2>
          <ol className="grid gap-5 md:grid-cols-3">
            {STEPS.map((step, i) => (
              <li key={step.title} className="flex flex-col gap-3 rounded-2xl border border-zinc-200 bg-white/60 p-6 dark:border-zinc-800 dark:bg-zinc-900/40">
                <div className="flex items-center justify-between">
                  <span className="flex size-11 items-center justify-center rounded-xl bg-emerald-600/10 text-emerald-700 dark:text-emerald-400">
                    <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d={step.icon} />
                    </svg>
                  </span>
                  <span className="text-sm font-medium text-zinc-400">0{i + 1}</span>
                </div>
                <h3 className="text-lg font-medium">{step.title}</h3>
                <p className="text-sm text-zinc-600 dark:text-zinc-400">{step.text}</p>
              </li>
            ))}
          </ol>
        </section>
      </main>
    </div>
  );
}
