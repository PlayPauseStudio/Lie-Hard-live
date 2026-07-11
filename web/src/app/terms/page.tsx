import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Terms & Conditions — Lie Hard',
  description: 'Terms and Conditions for the Lie Hard live game show play-along.',
};

export default function TermsPage() {
  return (
    <div className="min-h-screen py-10 px-4" style={{ background: 'linear-gradient(135deg, #1a0533 0%, #0f1a3d 50%, #0a1a2e 100%)' }}>
      <div className="w-full max-w-3xl mx-auto">
        <Link href="/audience/" className="inline-block mb-6 text-orange-400 hover:text-orange-300 text-sm">
          ← Back
        </Link>

        <div className="rounded-2xl p-6 sm:p-8 text-white/80 leading-relaxed" style={{ backgroundColor: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}>
          <h1 className="text-3xl font-bold text-white mb-1">Terms &amp; Conditions</h1>
          <p className="text-white/60 text-sm mb-6"><strong>Last updated: 11 July 2026</strong></p>

          <p className="mb-4">
            Lie Hard (the &quot;Show&quot;, &quot;Game&quot;, &quot;we&quot;, &quot;our&quot;, or &quot;us&quot;) is a live,
            in-person comedy game show experience operated by Playground Comedy Studio. This play-along
            web app lets audience members join and vote during the Show.
          </p>
          <p className="mb-6">
            By signing in, registering, or using the play-along, you agree to these Terms. If you do not
            agree, please do not use the app.
          </p>

          <h2 className="text-xl font-semibold text-white mt-8 mb-3">1. Eligibility</h2>
          <p className="mb-4">
            You must be at least 13 years old (or the minimum age required where you live) to use the
            play-along. By using it, you confirm that you meet this requirement.
          </p>

          <h2 className="text-xl font-semibold text-white mt-8 mb-3">2. Signing in &amp; registration</h2>
          <p className="mb-4">
            To play along you sign in with Google or with an email and password, and provide a display
            name and phone number. You are responsible for keeping your account secure and for the
            accuracy of the information you provide. One person, one account — do not impersonate others
            or submit votes on behalf of anyone else.
          </p>

          <h2 className="text-xl font-semibold text-white mt-8 mb-3">3. Acceptable use</h2>
          <p className="mb-3">You agree not to:</p>
          <ul className="list-disc pl-6 space-y-2 mb-4">
            <li>attempt to disrupt, hack, overload, or gain unauthorised access to the app or its systems;</li>
            <li>submit fraudulent, automated, or duplicate votes, or otherwise manipulate results;</li>
            <li>upload or transmit unlawful, abusive, or infringing content;</li>
            <li>use the app for any purpose other than participating in the Show.</li>
          </ul>

          <h2 className="text-xl font-semibold text-white mt-8 mb-3">4. Gameplay, scores &amp; prizes</h2>
          <p className="mb-4">
            Scores, leaderboards, and any prizes are administered at our discretion. We may correct
            errors, disqualify participants for misuse, and make final decisions on results. Prizes (if
            any) are non-transferable and subject to any additional rules announced at the Show.
          </p>

          <h2 className="text-xl font-semibold text-white mt-8 mb-3">5. Intellectual property</h2>
          <p className="mb-4">
            The Show, its format, branding, and this app are owned by Playground Comedy Studio. You may
            not copy, reproduce, or create derivative works without permission.
          </p>

          <h2 className="text-xl font-semibold text-white mt-8 mb-3">6. Disclaimers &amp; liability</h2>
          <p className="mb-4">
            The app is provided &quot;as is&quot; for entertainment. We do not guarantee uninterrupted or
            error-free operation. To the fullest extent permitted by law, we are not liable for any
            indirect or consequential loss arising from your use of the app.
          </p>

          <h2 className="text-xl font-semibold text-white mt-8 mb-3">7. Changes</h2>
          <p className="mb-4">
            We may update these Terms from time to time. Continued use after an update means you accept
            the revised Terms.
          </p>

          <h2 className="text-xl font-semibold text-white mt-8 mb-3">8. Contact</h2>
          <p className="mb-2">
            Questions about these Terms? Email us at{' '}
            <a href="mailto:tech@playgroundcomedy.studio" className="text-orange-400 hover:text-orange-300">
              tech@playgroundcomedy.studio
            </a>.
          </p>
          <p className="mt-6">
            See also our{' '}
            <Link href="/privacy/" className="text-orange-400 hover:text-orange-300">Privacy Policy</Link>.
          </p>
        </div>
      </div>
    </div>
  );
}
