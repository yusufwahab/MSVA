import Link from "next/link";
import { PublicFooter, PublicHeader } from "@/components/Public";
import { buttonClass } from "@/components/styles";

const steps = [
  { title: "Join your assigned track", text: "The academy enrols you in a track and a cohort, such as Front-End Development or Graphic Design, and sends you a private activation link." },
  { title: "Watch tutor-led sessions", text: "Your tutor publishes each class as a scheduled video. Classes appear on your dashboard when they are released, and the portal remembers where you stopped." },
  { title: "Take a quiz after every session", text: "Once you have watched enough of a class, you take its individual quiz. The result comes back to your portal automatically." },
  { title: "Earn your certificate", text: "Pass every module and the final assessment, and you can download a certificate that carries your student ID and a reference anyone can check." },
];

export default function Home() {
  return (
    <>
      <PublicHeader />
      <main id="main" className="flex-1">
        <section className="mx-auto w-full max-w-6xl px-4 pb-14 pt-12 sm:pt-20">
          <p className="mb-4 text-sm font-semibold uppercase tracking-[0.18em] text-clay">Invite-only learning</p>
          <h1 className="max-w-3xl text-4xl sm:text-6xl">Learn with your tutors. Prove it with a quiz. Finish with a certificate.</h1>
          <p className="mt-6 max-w-2xl text-lg text-muted">
            MS Virtual Academy is where enrolled students watch their classes, take the quiz that follows each one, and see exactly what to do next.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/sign-in" className={buttonClass("primary", "px-7 text-base")}>
              Student sign in
            </Link>
            <Link href="/activate" className={buttonClass("secondary", "px-7 text-base")}>
              Activate account
            </Link>
          </div>
        </section>

        <section aria-labelledby="how" className="border-y border-line bg-card">
          <div className="mx-auto w-full max-w-6xl px-4 py-14">
            <h2 id="how" className="text-3xl sm:text-4xl">
              How the academy works
            </h2>
            <ol className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {steps.map((s, i) => (
                <li key={s.title} className="border-t-4 border-navy pt-4">
                  <p className="font-serif text-3xl text-clay" aria-hidden="true">
                    {i + 1}
                  </p>
                  <h3 className="mt-1 text-xl">
                    <span className="sr-only">Step {i + 1}: </span>
                    {s.title}
                  </h3>
                  <p className="mt-2 text-muted">{s.text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section aria-labelledby="invited" className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-14 md:grid-cols-2">
          <div>
            <h2 id="invited" className="text-3xl">
              Have you been invited?
            </h2>
            <p className="mt-3 text-muted">
              Look for an email from the academy with your activation link. Open it, check that your email address is right, and choose a password. You will go straight to your dashboard.
            </p>
            <p className="mt-4">
              <Link href="/activate" className="font-semibold text-navy underline underline-offset-4">
                Activate account
              </Link>
            </p>
          </div>
          <div>
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
