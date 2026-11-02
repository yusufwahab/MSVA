import Link from "next/link";
import { Eyebrow } from "@/components/ui";
import { HeroPhoto, PublicFooter, PublicHeader } from "@/components/Public";
import { buttonClass } from "@/components/styles";

const steps = [
  { title: "Join your assigned track", text: "The academy enrols you in a track and a cohort, such as Front-End Development or Graphic Design, and emails you a code to activate your account." },
  { title: "Watch tutor-led sessions", text: "Your tutor publishes each class as a scheduled video. Classes appear on your dashboard when they are released, and the portal remembers where you stopped." },
  { title: "Take a quiz after every session", text: "Once you have watched enough of a class, you take its individual quiz. The result comes back to your portal automatically." },
  { title: "Earn your certificate", text: "Pass every module and the final assessment, and you can download a certificate that carries your student ID and a reference anyone can check." },
];

const features = [
  { title: "Classes that remember you", text: "Pick up a video exactly where you stopped, on any device." },
  { title: "A quiz after every class", text: "Each session ends with its own quiz, so you know what stuck before you move on." },
  { title: "Always know what is next", text: "Your dashboard shows one clear next step and how far you are through your track." },
  { title: "Certificates you can verify", text: "Every certificate has a public reference, so anyone can confirm it is genuine." },
  { title: "Optional live games", text: "Tutors can add a live game for extra practice with classmates." },
  { title: "Premium courses", text: "Unlock additional courses from inside the portal when you want to go further." },
];

const hero = [
  { head: "Every class", label: "ends with its own quiz" },
  { head: "Track by track", label: "cohorts with scheduled sessions" },
  { head: "Verifiable", label: "certificates on completion" },
];

export default function Home() {
  return (
    <>
      <PublicHeader />
      <main id="main" className="flex-1">
        <div className="mx-auto w-full max-w-7xl px-3 pt-4 sm:px-6 sm:pt-6">
          <section aria-labelledby="hero-title" className="overflow-hidden rounded-[2rem] bg-hero text-white">
            <div className="relative px-6 py-10 sm:px-12 sm:py-14 lg:py-20">
              <div className="relative z-10 lg:w-[62%]">
                <p className="inline-flex rounded-full border border-accent/30 bg-[#241d08] px-4 py-1.5 text-sm font-semibold text-accent-bright">Invite-only learning platform</p>
                <h1 id="hero-title" className="mt-6 text-[2.4rem] font-extrabold leading-[1.08] tracking-[-0.03em] sm:text-[clamp(2rem,5vw,3rem)] lg:text-[clamp(2rem,3.3vw,2.8rem)]">
                  <span className="block lg:whitespace-nowrap">Learn In-Demand Skills,</span>{" "}
                  <span className="block text-accent-bright lg:whitespace-nowrap">Earn Certifications,</span>{" "}
                  <span className="relative inline-block lg:whitespace-nowrap">
                    Build Your Future.
                    <svg viewBox="0 0 300 14" preserveAspectRatio="none" className="absolute -bottom-3 left-[38%] h-3 w-[60%]" aria-hidden="true" focusable="false">
                      <path d="M2 11C60 2 150 2 298 9" fill="none" stroke="#f4bd32" strokeWidth="4" strokeLinecap="round" />
                    </svg>
                  </span>
                </h1>
                <p className="mt-8 max-w-lg text-lg text-[#afafaf] lg:max-w-[19rem] min-[1200px]:max-w-lg">
                  MS Virtual Academy gives enrolled students tutor-led classes, a quiz after every session, and a certificate on completion, with one clear next step at every point.
                </p>
                <div className="mt-8 flex flex-wrap gap-3">
                  <Link href="/sign-in" className={buttonClass("primary", "px-8 py-3.5 text-base")}>
                    Sign in <span aria-hidden="true">→</span>
                  </Link>
                  <Link href="#how" className={buttonClass("secondary", "border-white/30 px-8 py-3.5 text-base text-white hover:border-accent-bright hover:text-accent-bright")}>
                    How it works
                  </Link>
                </div>
              </div>
              <HeroPhoto priority className="mx-auto mt-8 max-w-[34rem] lg:absolute lg:right-0 lg:top-1/2 lg:mt-0 lg:w-[54%] lg:max-w-none lg:-translate-y-1/2" />
            </div>
            <dl className="grid gap-5 px-6 pb-8 sm:grid-cols-3 sm:px-12 sm:pb-9 lg:gap-0">
              {hero.map((h, i) => (
                <div key={h.head} className={`sm:px-6 ${i === 0 ? "sm:pl-0" : "sm:border-l sm:border-white/10"}`}>
                  <dt className="text-lg font-bold">{h.head}</dt>
                  <dd className="text-sm text-[#afafaf]">{h.label}</dd>
                </div>
              ))}
            </dl>
          </section>
        </div>

        <section id="how" aria-labelledby="how-title" className="mx-auto w-full max-w-7xl scroll-mt-24 px-4 py-20 sm:px-8">
          <Eyebrow>The journey</Eyebrow>
          <h2 id="how-title" className="mt-2 text-3xl sm:text-5xl">
            How the academy works
          </h2>
          <ol className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {steps.map((s, i) => (
              <li key={s.title} className="rounded-[1.25rem] border border-line bg-surface p-6 shadow-card">
                <p className="text-5xl font-extrabold text-accent-ink" aria-hidden="true">
                  {String(i + 1).padStart(2, "0")}
                </p>
                <h3 className="mt-4 text-xl">
                  <span className="sr-only">Step {i + 1}: </span>
                  {s.title}
                </h3>
                <p className="mt-2 text-muted">{s.text}</p>
              </li>
            ))}
          </ol>
        </section>

        <section id="features" aria-labelledby="features-title" className="border-y border-line bg-surface">
          <div className="mx-auto w-full max-w-7xl scroll-mt-24 px-4 py-20 sm:px-8">
            <Eyebrow>Built for learning</Eyebrow>
            <h2 id="features-title" className="mt-2 max-w-2xl text-3xl sm:text-5xl">
              Everything between your first class and your certificate
            </h2>
            <ul className="mt-10 grid gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
              {features.map((f) => (
                <li key={f.title} className="border-t border-line-strong pt-5">
                  <h3 className="text-lg">{f.title}</h3>
                  <p className="mt-2 text-muted">{f.text}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section id="invited" aria-labelledby="invited-title" className="mx-auto grid w-full max-w-7xl scroll-mt-24 gap-5 px-4 py-20 sm:px-8 md:grid-cols-2">
          <div className="rounded-[1.5rem] border border-accent/40 bg-accent-soft p-8 sm:p-10">
            <h2 id="invited-title" className="text-3xl">
              Have you been invited?
            </h2>
            <p className="mt-3 text-muted">
              Look for an email from the academy with a six-digit code. Open the activation page, enter your email address and the code, and choose a password. You will go straight to your dashboard.
            </p>
            <Link href="/activate" className={buttonClass("primary", "mt-6")}>
              Activate account <span aria-hidden="true">→</span>
            </Link>
          </div>
          <div className="rounded-[1.5rem] border border-line bg-surface p-8 sm:p-10">
            <h2 className="text-3xl">Not enrolled yet?</h2>
            <p className="mt-3 text-muted">
              Places are assigned by the academy. There is no public sign-up, so you cannot join by creating an account here. If you think you should have received an invitation, contact the academy through the details on its website.
            </p>
          </div>
        </section>
      </main>
      <PublicFooter />
    </>
  );
}
