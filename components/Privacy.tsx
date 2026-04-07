import React from 'react';
import { Link } from 'react-router-dom';

const Privacy: React.FC = () => {
  return (
    <div className="min-h-screen w-full bg-slate-950 text-white">
      <div className="mx-auto max-w-4xl px-6 py-10">
        <header className="mb-8 flex items-center justify-between gap-4">
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight">CleanMontenegro Privacy Policy</h1>
          <Link
            to="/"
            className="shrink-0 rounded-full border border-cyan-500/40 bg-cyan-500/10 px-4 py-2 text-xs font-bold uppercase tracking-[0.18em] text-cyan-300 hover:bg-cyan-500/20 transition-all"
          >
            Back to App
          </Link>
        </header>

        <main className="space-y-6 rounded-3xl border border-white/10 bg-slate-900/60 p-6 sm:p-8">
          <section>
            <h2 className="mb-2 text-lg font-bold text-cyan-300">1. Data We Collect</h2>
            <p className="text-slate-300 leading-relaxed">
              We collect account details, mission content, location data related to missions, payment
              events, and support communications needed to operate the cleaning marketplace.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-bold text-cyan-300">2. How We Use Data</h2>
            <p className="text-slate-300 leading-relaxed">
              Your data is used to match missions, process payments, prevent fraud, improve safety, and
              provide platform support. We use security and moderation checks to protect users.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-bold text-cyan-300">3. Sharing and Security</h2>
            <p className="text-slate-300 leading-relaxed">
              We only share data with service providers and partners necessary for platform operation,
              including authentication, hosting, payments, and compliance. We apply reasonable technical
              and organizational safeguards to protect your information.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-bold text-cyan-300">4. Retention and Deletion</h2>
            <p className="text-slate-300 leading-relaxed">
              We retain data for as long as needed to provide the service, comply with legal obligations,
              and resolve disputes. You may request account-related data actions through support channels.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-bold text-cyan-300">5. Contact</h2>
            <p className="text-slate-300 leading-relaxed">
              For privacy questions or requests related to your account data, contact CleanMontenegro support
              via the official in-app support options.
            </p>
          </section>
        </main>
      </div>
    </div>
  );
};

export default Privacy;
