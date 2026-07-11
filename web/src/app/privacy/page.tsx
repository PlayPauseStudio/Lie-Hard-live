import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Privacy Policy — Lie Hard',
  description: 'Privacy Policy for the Lie Hard live game show play-along.',
};

export default function PrivacyPage() {
  return (
    <div className="min-h-screen py-10 px-4" style={{ background: 'linear-gradient(135deg, #1a0533 0%, #0f1a3d 50%, #0a1a2e 100%)' }}>
      <div className="w-full max-w-3xl mx-auto">
        <Link href="/audience/" className="inline-block mb-6 text-orange-400 hover:text-orange-300 text-sm">
          ← Back
        </Link>

        <div className="rounded-2xl p-6 sm:p-8 text-white/80 leading-relaxed" style={{ backgroundColor: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}>
          <h1 className="text-3xl font-bold text-white mb-1">Privacy Policy</h1>
          <p className="text-white/60 text-sm mb-6"><strong>Last updated: 11 July 2026</strong></p>

          <p className="mb-6">
            This Privacy Policy explains how Playground Comedy Studio (&quot;we&quot;, &quot;our&quot;,
            &quot;us&quot;) collects, uses, and protects your information when you use the Lie Hard
            play-along app. By using the app, you consent to this policy.
          </p>

          <h2 className="text-xl font-semibold text-white mt-8 mb-3">1. Information we collect</h2>
          <ul className="list-disc pl-6 space-y-2 mb-4">
            <li><strong>Account information:</strong> your name/display name, phone number, and — depending on how you sign in — your email address or Google account identifier.</li>
            <li><strong>Gameplay information:</strong> the votes and answers you submit during the Show, and your resulting score/leaderboard position.</li>
            <li><strong>Technical information:</strong> basic technical data needed to run the app securely (e.g. authentication tokens and connection data), handled by our infrastructure providers.</li>
          </ul>

          <h2 className="text-xl font-semibold text-white mt-8 mb-3">2. How we use it</h2>
          <ul className="list-disc pl-6 space-y-2 mb-4">
            <li>to let you sign in and take part in the play-along;</li>
            <li>to record votes, compute scores, and display leaderboards during the Show;</li>
            <li>to contact winners or participants about the Show where relevant;</li>
            <li>to keep the app secure and prevent abuse.</li>
          </ul>

          <h2 className="text-xl font-semibold text-white mt-8 mb-3">3. Legal basis</h2>
          <p className="mb-4">
            We process your information based on your consent (given when you agree to these policies and
            register) and our legitimate interest in running the Show.
          </p>

          <h2 className="text-xl font-semibold text-white mt-8 mb-3">4. Who we share it with</h2>
          <p className="mb-4">
            We do not sell your personal information. We use trusted infrastructure providers to operate
            the app — principally <strong>Google Firebase</strong> (authentication and database) and our
            cloud hosting provider — who process data on our behalf. We may disclose information if
            required by law.
          </p>

          <h2 className="text-xl font-semibold text-white mt-8 mb-3">5. Storage &amp; security</h2>
          <p className="mb-4">
            Your registration data is stored in Google Firebase with access controls so that each user
            can access only their own record. We take reasonable measures to protect your information,
            though no system can be guaranteed to be completely secure.
          </p>

          <h2 className="text-xl font-semibold text-white mt-8 mb-3">6. Retention</h2>
          <p className="mb-4">
            We keep your registration and gameplay data only as long as needed for the Show and related
            follow-up, after which it may be deleted. You can ask us to delete your data at any time
            (see Contact).
          </p>

          <h2 className="text-xl font-semibold text-white mt-8 mb-3">7. Your rights</h2>
          <p className="mb-4">
            You may request access to, correction of, or deletion of your personal information by
            contacting us. You can also stop participating and sign out at any time.
          </p>

          <h2 className="text-xl font-semibold text-white mt-8 mb-3">8. Children</h2>
          <p className="mb-4">
            The play-along is not intended for anyone under 13. We do not knowingly collect information
            from children under 13.
          </p>

          <h2 className="text-xl font-semibold text-white mt-8 mb-3">9. Contact</h2>
          <p className="mb-2">
            For any privacy request or question, email{' '}
            <a href="mailto:tech@playgroundcomedy.studio" className="text-orange-400 hover:text-orange-300">
              tech@playgroundcomedy.studio
            </a>.
          </p>
          <p className="mt-6">
            See also our{' '}
            <Link href="/terms/" className="text-orange-400 hover:text-orange-300">Terms &amp; Conditions</Link>.
          </p>
        </div>
      </div>
    </div>
  );
}
